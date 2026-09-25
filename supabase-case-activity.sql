-- Run manually in Supabase SQL Editor after supabase-phase5-schema.sql.
-- No backfill: triggers only observe future committed changes.
begin;
create table if not exists public.case_activity_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.investigation_cases(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'CASE_CREATED','CASE_STATUS_CHANGED','WALLET_ADDED','WALLET_REMOVED',
    'BLOCKCHAIN_EVIDENCE_REFRESHED','TRANSACTION_VIEWED','EVIDENCE_PACKAGE_GENERATED',
    'EVIDENCE_INTEGRITY_VERIFIED','EVIDENCE_INTEGRITY_MISMATCH','FREEZE_HOLD_PACKAGE_PREPARED'
  )),
  event_timestamp timestamptz not null default clock_timestamp(),
  metadata jsonb not null check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4096),
  origin text not null check (origin in ('database','browser-reported')),
  operation_id uuid not null default gen_random_uuid(),
  unique (case_id, operation_id)
);
create index if not exists case_activity_chronology_idx on public.case_activity_events (case_id, event_timestamp desc, id desc);
alter table public.case_activity_events enable row level security;
revoke all on public.case_activity_events from anon, authenticated;
revoke all on public.case_activity_events from public;
grant select on public.case_activity_events to authenticated;
grant select, insert on public.case_activity_events to service_role;
drop policy if exists "Owners read case activity" on public.case_activity_events;
create policy "Owners read case activity" on public.case_activity_events for select to authenticated
using (exists (select 1 from public.investigation_cases c where c.id = case_id and c.created_by = auth.uid()));
-- No browser INSERT/UPDATE/DELETE policy. Server routes verify ownership.
-- These functions run atomically with the primary write: audit failure rolls it back.
-- Actor attribution uses the existing owner-only case write model. Privileged
-- maintenance writes have no independently verified human actor and use NULL.
create or replace function public.record_case_row_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid;
begin
  -- Existing server routes use service_role after checking the case owner.
  actor := case when auth.role() = 'service_role' then new.created_by else auth.uid() end;
  if tg_op = 'INSERT' then
    insert into public.case_activity_events(case_id,actor_user_id,event_type,metadata,origin)
    values(new.id,actor,'CASE_CREATED',jsonb_build_object('status',new.status),'database');
  elsif old.status is distinct from new.status then
    insert into public.case_activity_events(case_id,actor_user_id,event_type,metadata,origin)
    values(new.id,actor,'CASE_STATUS_CHANGED',jsonb_build_object('previousStatus',old.status,'status',new.status),'database');
  end if;
  return new;
end; $$;
create or replace function public.record_case_wallet_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare row_data public.case_wallets; owner_id uuid; actor uuid;
begin
  if tg_op = 'DELETE' then row_data := old; else row_data := new; end if;
  select created_by into owner_id from public.investigation_cases where id = row_data.case_id;
  -- Parent deletion cascades; do not try to recreate a deleted case's log.
  if owner_id is null then return row_data; end if;
  actor := case when auth.role() = 'service_role' then owner_id else auth.uid() end;
  insert into public.case_activity_events(case_id,actor_user_id,event_type,metadata,origin)
  values(row_data.case_id,actor,case when tg_op = 'DELETE' then 'WALLET_REMOVED' else 'WALLET_ADDED' end,
    jsonb_build_object('network',row_data.network,'walletAddress',row_data.address),'database');
  return row_data;
end; $$;
revoke all on function public.record_case_row_activity() from public, anon, authenticated;
revoke all on function public.record_case_wallet_activity() from public, anon, authenticated;
drop trigger if exists case_activity_row on public.investigation_cases;
create trigger case_activity_row after insert or update of status on public.investigation_cases for each row execute function public.record_case_row_activity();
drop trigger if exists case_activity_wallet on public.case_wallets;
create trigger case_activity_wallet after insert or delete on public.case_wallets for each row execute function public.record_case_wallet_activity();
commit;
