-- Manual migration AFTER supabase-case-bookmarks.sql. Do not reapply earlier migrations.
begin;
alter table public.case_activity_events drop constraint if exists case_activity_events_event_type_check;
alter table public.case_activity_events add constraint case_activity_events_event_type_check check (event_type in (
  'CASE_CREATED','CASE_STATUS_CHANGED','WALLET_ADDED','WALLET_REMOVED',
  'BLOCKCHAIN_EVIDENCE_REFRESHED','TRANSACTION_VIEWED','EVIDENCE_PACKAGE_GENERATED',
  'EVIDENCE_INTEGRITY_VERIFIED','EVIDENCE_INTEGRITY_MISMATCH','FREEZE_HOLD_PACKAGE_PREPARED','CASE_NOTE_CREATED',
  'EVIDENCE_BOOKMARK_CREATED','EVIDENCE_BOOKMARK_REMOVED','EVIDENCE_TAG_ADDED','EVIDENCE_TAG_REMOVED'
));
-- One row per controlled classification; no evidence or provider payload is copied.
create table public.case_evidence_tags (
  bookmark_id uuid not null references public.case_evidence_bookmarks(id) on delete cascade,
  tag_id text not null check (tag_id in (
    'exchange','bridge','mixer','victim_transfer','suspect_transfer','funding_source',
    'destination','intermediate_wallet','high_value','review_required'
  )),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (bookmark_id, tag_id)
);
alter table public.case_evidence_tags enable row level security;
revoke all on public.case_evidence_tags from public, anon, authenticated;
revoke all on public.case_evidence_tags from service_role;
grant select on public.case_evidence_tags to authenticated;
grant select, insert, delete on public.case_evidence_tags to service_role;
create policy "Owners read evidence tags" on public.case_evidence_tags for select to authenticated
using (exists (
  select 1 from public.case_evidence_bookmarks b
  join public.investigation_cases c on c.id = b.case_id
  where b.id = bookmark_id and c.created_by = auth.uid()
));
-- No direct browser write policies; API verifies user, case and bookmark ownership.
create function public.validate_case_evidence_tag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.case_evidence_bookmarks b
  join public.investigation_cases c on c.id = b.case_id
  where b.id = new.bookmark_id and c.created_by = new.created_by for share of b, c;
  if not found then raise exception 'Tag creator must own the bookmarked case'; end if;
  new.created_at := clock_timestamp();
  return new;
end; $$;
create function public.record_case_evidence_tag_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare row_data public.case_evidence_tags; parent_case uuid; owner_id uuid; actor uuid;
begin
  if tg_op = 'DELETE' then row_data := old; else row_data := new; end if;
  select c.id, c.created_by into parent_case, owner_id
  from public.case_evidence_bookmarks b join public.investigation_cases c on c.id = b.case_id
  where b.id = row_data.bookmark_id;
  -- Bookmark/case cascades need no synthetic tag removals; bookmark audit covers deletion.
  if parent_case is null then return row_data; end if;
  actor := case when auth.role() = 'service_role' then owner_id else auth.uid() end;
  insert into public.case_activity_events(case_id,actor_user_id,event_type,metadata,origin)
  values(parent_case,actor,case when tg_op = 'DELETE' then 'EVIDENCE_TAG_REMOVED' else 'EVIDENCE_TAG_ADDED' end,
    jsonb_build_object('bookmarkId',row_data.bookmark_id,'tagId',row_data.tag_id),'database');
  return row_data;
end; $$;
revoke all on function public.validate_case_evidence_tag() from public, anon, authenticated;
revoke all on function public.record_case_evidence_tag_activity() from public, anon, authenticated;
create trigger case_evidence_tag_validate before insert on public.case_evidence_tags
for each row execute function public.validate_case_evidence_tag();
-- Trigger failure aborts the tag mutation: no separate best-effort audit request.
create trigger case_evidence_tag_activity after insert or delete on public.case_evidence_tags
for each row execute function public.record_case_evidence_tag_activity();
commit;
