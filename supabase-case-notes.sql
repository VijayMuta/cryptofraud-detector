-- Manual migration. Prerequisites: supabase-phase5-schema.sql, then supabase-case-activity.sql.
begin;
-- Retain all existing event types while adding the database-only note event.
alter table public.case_activity_events drop constraint if exists case_activity_events_event_type_check;
alter table public.case_activity_events add constraint case_activity_events_event_type_check check (event_type in (
  'CASE_CREATED','CASE_STATUS_CHANGED','WALLET_ADDED','WALLET_REMOVED',
  'BLOCKCHAIN_EVIDENCE_REFRESHED','TRANSACTION_VIEWED','EVIDENCE_PACKAGE_GENERATED',
  'EVIDENCE_INTEGRITY_VERIFIED','EVIDENCE_INTEGRITY_MISMATCH','FREEZE_HOLD_PACKAGE_PREPARED','CASE_NOTE_CREATED'
));
create table if not exists public.case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.investigation_cases(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  note_text text not null check (char_length(note_text) between 1 and 5000 and note_text ~ '[^[:space:]]'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists case_notes_chronology_idx on public.case_notes(case_id, created_at desc, id desc);
alter table public.case_notes enable row level security;
revoke all on public.case_notes from public, anon, authenticated;
grant select on public.case_notes to authenticated;
grant select, insert on public.case_notes to service_role;
create or replace function public.validate_case_note_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Defense in depth even for a server insert: author must be the current case owner.
  perform 1 from public.investigation_cases where id = new.case_id and created_by = new.author_user_id for share;
  if not found then raise exception 'Case note author must own the case'; end if;
  if tg_op = 'INSERT' then
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
  else
    new.updated_at := clock_timestamp();
  end if;
  return new;
end; $$;
create or replace function public.record_case_note_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.case_activity_events(case_id,actor_user_id,event_type,metadata,origin)
  values(new.case_id,new.author_user_id,'CASE_NOTE_CREATED',jsonb_build_object('noteId',new.id),'database');
  return new;
end; $$;
revoke all on function public.validate_case_note_write() from public, anon, authenticated;
revoke all on function public.record_case_note_activity() from public, anon, authenticated;
drop policy if exists "Owners read case notes" on public.case_notes;
create policy "Owners read case notes" on public.case_notes for select to authenticated
using (exists (select 1 from public.investigation_cases c where c.id = case_id and c.created_by = auth.uid()));
-- No client write policy; authenticated application routes perform ownership checks.
drop trigger if exists case_note_validate on public.case_notes;
create trigger case_note_validate before insert or update on public.case_notes for each row execute function public.validate_case_note_write();
drop trigger if exists case_note_activity on public.case_notes;
create trigger case_note_activity after insert on public.case_notes for each row execute function public.record_case_note_activity();
commit;
