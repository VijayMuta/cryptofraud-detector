-- Manual migration, after supabase-case-activity.sql and supabase-case-notes.sql.
begin;
alter table public.case_activity_events drop constraint if exists case_activity_events_event_type_check;
alter table public.case_activity_events add constraint case_activity_events_event_type_check check (event_type in (
  'CASE_CREATED','CASE_STATUS_CHANGED','WALLET_ADDED','WALLET_REMOVED',
  'BLOCKCHAIN_EVIDENCE_REFRESHED','TRANSACTION_VIEWED','EVIDENCE_PACKAGE_GENERATED',
  'EVIDENCE_INTEGRITY_VERIFIED','EVIDENCE_INTEGRITY_MISMATCH','FREEZE_HOLD_PACKAGE_PREPARED','CASE_NOTE_CREATED',
  'EVIDENCE_BOOKMARK_CREATED','EVIDENCE_BOOKMARK_REMOVED'
));
create table if not exists public.case_evidence_bookmarks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.investigation_cases(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  network text not null check (network = 'ethereum'),
  label text check (label in ('Review','Key transfer','Follow up')),
  created_at timestamptz not null default clock_timestamp(),
  unique(case_id, network, transaction_hash)
);
create index if not exists case_bookmarks_chronology_idx on public.case_evidence_bookmarks(case_id, created_at desc, id desc);
alter table public.case_evidence_bookmarks enable row level security;
revoke all on public.case_evidence_bookmarks from public, anon, authenticated;
grant select on public.case_evidence_bookmarks to authenticated;
grant select, insert, delete on public.case_evidence_bookmarks to service_role;
drop policy if exists "Owners read case bookmarks" on public.case_evidence_bookmarks;
create policy "Owners read case bookmarks" on public.case_evidence_bookmarks for select to authenticated
using (exists (select 1 from public.investigation_cases c where c.id = case_id and c.created_by = auth.uid()));
-- No direct browser write policies. API routes verify the acting case owner.
create or replace function public.validate_case_bookmark() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.investigation_cases where id = new.case_id and created_by = new.created_by for share;
  if not found then raise exception 'Bookmark creator must own the case'; end if;
  new.created_at := clock_timestamp();
  return new;
end; $$;
create or replace function public.record_case_bookmark_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare row_data public.case_evidence_bookmarks; owner_id uuid; actor uuid;
begin
  if tg_op = 'DELETE' then row_data := old; else row_data := new; end if;
  select created_by into owner_id from public.investigation_cases where id = row_data.case_id;
  -- A deleted parent cascades its bookmarks and activity; no synthetic removals.
  if owner_id is null then return row_data; end if;
  actor := case when auth.role() = 'service_role' then owner_id else auth.uid() end;
  insert into public.case_activity_events(case_id,actor_user_id,event_type,metadata,origin)
  values(row_data.case_id,actor,case when tg_op = 'DELETE' then 'EVIDENCE_BOOKMARK_REMOVED' else 'EVIDENCE_BOOKMARK_CREATED' end,
    jsonb_build_object('bookmarkId',row_data.id,'transactionHash',row_data.transaction_hash,'network',row_data.network),'database');
  return row_data;
end; $$;
revoke all on function public.validate_case_bookmark() from public, anon, authenticated;
revoke all on function public.record_case_bookmark_activity() from public, anon, authenticated;
drop trigger if exists case_bookmark_validate on public.case_evidence_bookmarks;
create trigger case_bookmark_validate before insert on public.case_evidence_bookmarks for each row execute function public.validate_case_bookmark();
drop trigger if exists case_bookmark_activity on public.case_evidence_bookmarks;
create trigger case_bookmark_activity after insert or delete on public.case_evidence_bookmarks for each row execute function public.record_case_bookmark_activity();
commit;
