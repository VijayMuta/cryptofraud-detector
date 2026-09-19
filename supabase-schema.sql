-- CryptoFraud Detector — Phase 2 database
-- Run this in Supabase SQL Editor.

-- Phase 4 schema. Run this file in the Supabase SQL Editor; the application
-- does not create database tables automatically at runtime.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'analyst' check (role in ('analyst','reviewer','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
-- Intentionally no client INSERT or UPDATE profile policy. The auth trigger
-- below creates profiles, and only trusted server-side administration may edit
-- them. This prevents a user assigning themself an elevated role.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Phase 4: real-time Ethereum wallet monitoring.
-- The browser can only read its own monitoring records. All writes are made by
-- authenticated server routes with the Supabase service-role key.
create extension if not exists pgcrypto;

create table if not exists public.wallet_monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null check (address ~ '^0x[0-9a-f]{40}$'),
  network text not null default 'ethereum' check (network = 'ethereum'),
  is_active boolean not null default true,
  last_checked_at timestamptz,
  last_successful_check_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, address, network)
);

create table if not exists public.monitor_transactions (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.wallet_monitors(id) on delete cascade,
  transaction_hash text not null,
  block_number bigint,
  occurred_at timestamptz,
  from_address text not null,
  to_address text,
  value_wei numeric(78, 0) not null,
  status text not null check (status in ('success', 'failed', 'unknown')),
  analysis jsonb,
  detected_at timestamptz not null default now(),
  unique (monitor_id, transaction_hash)
);

create table if not exists public.monitor_alerts (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.wallet_monitors(id) on delete cascade,
  source_transaction_hash text not null,
  alert_type text not null check (alert_type in ('fund_splitting', 'unusual_movement')),
  severity text not null check (severity in ('high', 'critical')),
  title text not null,
  description text not null,
  risk_score integer,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new', 'reviewing', 'closed')),
  created_at timestamptz not null default now(),
  unique (monitor_id, source_transaction_hash, alert_type)
);

create index if not exists wallet_monitors_active_check_idx
on public.wallet_monitors (last_checked_at asc)
where is_active;

create index if not exists monitor_transactions_monitor_occurred_idx
on public.monitor_transactions (monitor_id, occurred_at desc);

create index if not exists monitor_alerts_monitor_created_idx
on public.monitor_alerts (monitor_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists wallet_monitors_set_updated_at on public.wallet_monitors;
create trigger wallet_monitors_set_updated_at
before update on public.wallet_monitors
for each row execute procedure public.set_updated_at();

alter table public.wallet_monitors enable row level security;
alter table public.monitor_transactions enable row level security;
alter table public.monitor_alerts enable row level security;

drop policy if exists "Users can read their own wallet monitors" on public.wallet_monitors;
create policy "Users can read their own wallet monitors"
on public.wallet_monitors for select
using (auth.uid() = user_id);

drop policy if exists "Users can read their own monitored transactions" on public.monitor_transactions;
create policy "Users can read their own monitored transactions"
on public.monitor_transactions for select
using (
  exists (
    select 1 from public.wallet_monitors
    where wallet_monitors.id = monitor_transactions.monitor_id
      and wallet_monitors.user_id = auth.uid()
  )
);

drop policy if exists "Users can read their own monitoring alerts" on public.monitor_alerts;
create policy "Users can read their own monitoring alerts"
on public.monitor_alerts for select
using (
  exists (
    select 1 from public.wallet_monitors
    where wallet_monitors.id = monitor_alerts.monitor_id
      and wallet_monitors.user_id = auth.uid()
  )
);
