-- Manual migration AFTER supabase-evidence-tags.sql. Do not reapply earlier migrations.
begin;
alter table public.case_activity_events drop constraint if exists case_activity_events_event_type_check;
alter table public.case_activity_events add constraint case_activity_events_event_type_check check (event_type in (
  'CASE_CREATED','CASE_STATUS_CHANGED','WALLET_ADDED','WALLET_REMOVED',
  'BLOCKCHAIN_EVIDENCE_REFRESHED','TRANSACTION_VIEWED','EVIDENCE_PACKAGE_GENERATED',
  'EVIDENCE_INTEGRITY_VERIFIED','EVIDENCE_INTEGRITY_MISMATCH','FREEZE_HOLD_PACKAGE_PREPARED','CASE_NOTE_CREATED',
  'EVIDENCE_BOOKMARK_CREATED','EVIDENCE_BOOKMARK_REMOVED','EVIDENCE_TAG_ADDED','EVIDENCE_TAG_REMOVED',
  'EVIDENCE_BOOKMARK_NOTE_CREATED'
));
-- The composite foreign key below makes case/bookmark mismatches impossible.
alter table public.case_evidence_bookmarks add constraint case_bookmarks_id_case_unique unique (id, case_id);
create table public.case_evidence_bookmark_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.investigation_cases(id) on delete cascade,
  bookmark_id uuid not null,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  note_text text not null check (char_length(note_text) between 1 and 2000 and note_text ~ '[^[:space:]]'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (bookmark_id, case_id) references public.case_evidence_bookmarks(id, case_id) on delete cascade
);
create index case_bookmark_notes_chronology_idx on public.case_evidence_bookmark_notes(case_id, bookmark_id, created_at desc, id desc);
alter table public.case_evidence_bookmark_notes enable row level security;
revoke all on public.case_evidence_bookmark_notes from public, anon, authenticated, service_role;
grant select on public.case_evidence_bookmark_notes to authenticated;
grant select, insert on public.case_evidence_bookmark_notes to service_role;
create policy "Owners read bookmark notes" on public.case_evidence_bookmark_notes for select to authenticated
using (exists (
  select 1 from public.investigation_cases c
  where c.id = case_id and c.created_by = auth.uid()
));
-- No direct client write policies. API supplies the verified author.
create function public.validate_case_bookmark_note() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.case_evidence_bookmarks b
  join public.investigation_cases c on c.id = b.case_id
  where b.id = new.bookmark_id and b.case_id = new.case_id
    and c.created_by = new.author_user_id for share of b, c;
  if not found then raise exception 'Bookmark note author must own the bookmarked case'; end if;
  new.created_at := clock_timestamp();
  return new;
end; $$;
create function public.record_case_bookmark_note_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.case_activity_events(case_id,actor_user_id,event_type,metadata,origin)
  values(new.case_id,new.author_user_id,'EVIDENCE_BOOKMARK_NOTE_CREATED',
    jsonb_build_object('bookmarkId',new.bookmark_id,'noteId',new.id),'database');
  return new;
end; $$;
revoke all on function public.validate_case_bookmark_note() from public, anon, authenticated;
revoke all on function public.record_case_bookmark_note_activity() from public, anon, authenticated;
create trigger case_bookmark_note_validate before insert on public.case_evidence_bookmark_notes
for each row execute function public.validate_case_bookmark_note();
-- Audit failure aborts note creation; no best-effort or browser audit write.
create trigger case_bookmark_note_activity after insert on public.case_evidence_bookmark_notes
for each row execute function public.record_case_bookmark_note_activity();
commit;
