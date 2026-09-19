-- CryptoFraud Detector — Phase 5: Case merge and cross-wallet investigation
-- Prerequisite: run supabase-schema.sql (Phase 4) first.
-- Run this entire file in the Supabase SQL Editor. The application does not
-- create these tables automatically at runtime.

begin;

create extension if not exists pgcrypto;

-- This migration intentionally depends on the Phase 4 profile table. Raise a
-- clear error instead of failing later with an unclear missing-table error.
do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Missing public.profiles. Run supabase-schema.sql (Phase 4) before supabase-phase5-schema.sql.';
  end if;
end;
$$;

-- Reassert the profile protection introduced in Phase 4. Profiles are created
-- by the auth trigger; clients must not be able to change their own role.
alter table public.profiles enable row level security;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

create table if not exists public.investigation_cases (
  id uuid primary key default gen_random_uuid(),
  case_code text not null unique default (
    'CF-' || to_char(timezone('utc', now()), 'YYYY') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  title text not null check (char_length(trim(title)) between 2 and 160),
  description text not null default '' check (char_length(description) <= 5000),
  status text not null default 'open' check (status in ('open', 'investigating', 'closed', 'archived')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.case_wallets (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.investigation_cases(id) on delete cascade,
  address text not null check (address ~ '^0x[0-9a-f]{40}$'),
  network text not null default 'ethereum' check (network = 'ethereum'),
  added_by uuid not null references auth.users(id) on delete restrict,
  added_at timestamptz not null default now(),
  unique (case_id, address)
);

-- A merge review preserves the live Etherscan evidence returned when an
-- analyst compares two of their cases. It does not merge or delete either case.
create table if not exists public.case_connection_reviews (
  id uuid primary key default gen_random_uuid(),
  case_a_id uuid not null references public.investigation_cases(id) on delete cascade,
  case_b_id uuid not null references public.investigation_cases(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  analysis jsonb not null,
  source text not null default 'etherscan' check (source = 'etherscan'),
  generated_at timestamptz not null default now(),
  check (case_a_id <> case_b_id),
  unique (created_by, case_a_id, case_b_id)
);

create index if not exists investigation_cases_owner_updated_idx
on public.investigation_cases (created_by, updated_at desc);

create index if not exists investigation_cases_owner_status_idx
on public.investigation_cases (created_by, status);

create index if not exists case_wallets_case_added_idx
on public.case_wallets (case_id, added_at asc);

create index if not exists case_wallets_address_idx
on public.case_wallets (address);

create index if not exists case_connection_reviews_owner_generated_idx
on public.case_connection_reviews (created_by, generated_at desc);

create or replace function public.set_investigation_case_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists investigation_cases_set_updated_at on public.investigation_cases;
create trigger investigation_cases_set_updated_at
before update on public.investigation_cases
for each row execute procedure public.set_investigation_case_updated_at();

alter table public.investigation_cases enable row level security;
alter table public.case_wallets enable row level security;
alter table public.case_connection_reviews enable row level security;

-- Case records are private. Writes occur only in authenticated server routes
-- using the service role after ownership checks; no browser write policy exists.
drop policy if exists "Users can read their own investigation cases" on public.investigation_cases;
create policy "Users can read their own investigation cases"
on public.investigation_cases for select
using (auth.uid() = created_by);

drop policy if exists "Users can read wallets in their own cases" on public.case_wallets;
create policy "Users can read wallets in their own cases"
on public.case_wallets for select
using (
  exists (
    select 1 from public.investigation_cases
    where investigation_cases.id = case_wallets.case_id
      and investigation_cases.created_by = auth.uid()
  )
);

drop policy if exists "Users can read their own case connection reviews" on public.case_connection_reviews;
create policy "Users can read their own case connection reviews"
on public.case_connection_reviews for select
using (auth.uid() = created_by);

commit;
