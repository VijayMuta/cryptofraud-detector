-- CHAINTRACE private allegation intake. Apply manually in Supabase SQL Editor.
-- No existing case/report records are rewritten or migrated by this file.
begin;
create extension if not exists pgcrypto;
create table if not exists public.victim_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  suspect_wallet text not null check (suspect_wallet ~ '^0x[0-9a-f]{40}$'),
  network text not null default 'ethereum' check (network = 'ethereum'),
  incident_type text not null check (incident_type in ('Investment scam','Impersonation scam','Phishing','Romance scam','Fake exchange/platform','Wallet compromise','Fraudulent payment','Other')),
  -- Preserve the victim's decimal claim exactly, without JSON floating-point rounding.
  approximate_loss text not null check (approximate_loss ~ '^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$'),
  loss_currency text not null check (loss_currency ~ '^[A-Z][A-Z0-9]{1,11}$'),
  incident_date date not null check (incident_date >= date '2009-01-01'),
  transaction_hash text not null default '' check (transaction_hash = '' or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  reported_service text not null default '' check (char_length(reported_service) <= 200),
  description text not null check (char_length(trim(description)) between 10 and 5000),
  reference text not null default '' check (char_length(reference) <= 200),
  additional_notes text not null default '' check (char_length(additional_notes) <= 2000),
  status text not null default 'submitted' check (status in ('submitted','under_review','investigating','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists victim_reports_owner_created_idx on public.victim_reports (user_id, created_at desc, id desc);
create index if not exists victim_reports_owner_wallet_idx on public.victim_reports (user_id, network, suspect_wallet);
create index if not exists victim_reports_owner_status_idx on public.victim_reports (user_id, status);
create or replace function public.set_victim_report_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists victim_reports_updated_at on public.victim_reports;
create trigger victim_reports_updated_at before update on public.victim_reports for each row execute function public.set_victim_report_updated_at();
alter table public.victim_reports enable row level security;
drop policy if exists "Owners can read private victim reports" on public.victim_reports;
create policy "Owners can read private victim reports" on public.victim_reports for select to authenticated using ((select auth.uid()) = user_id);
-- Same architecture as existing Cases: no browser mutation privileges/policies.
-- Authenticated server routes use service_role with explicit ownership filters.
revoke all on public.victim_reports from anon, authenticated;
grant select on public.victim_reports to authenticated;
grant select, insert, update on public.victim_reports to service_role;
commit;
