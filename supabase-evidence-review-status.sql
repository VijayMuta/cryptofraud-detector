-- Manual migration AFTER supabase-evidence-bookmark-notes.sql. Do not reapply earlier migrations.
begin;
alter table public.case_activity_events drop constraint if exists case_activity_events_event_type_check;
alter table public.case_activity_events add constraint case_activity_events_event_type_check check (event_type in (
  'CASE_CREATED','CASE_STATUS_CHANGED','WALLET_ADDED','WALLET_REMOVED',
  'BLOCKCHAIN_EVIDENCE_REFRESHED','TRANSACTION_VIEWED','EVIDENCE_PACKAGE_GENERATED',
  'EVIDENCE_INTEGRITY_VERIFIED','EVIDENCE_INTEGRITY_MISMATCH','FREEZE_HOLD_PACKAGE_PREPARED','CASE_NOTE_CREATED',
  'EVIDENCE_BOOKMARK_CREATED','EVIDENCE_BOOKMARK_REMOVED','EVIDENCE_TAG_ADDED','EVIDENCE_TAG_REMOVED',
  'EVIDENCE_BOOKMARK_NOTE_CREATED','EVIDENCE_REVIEW_STATUS_CHANGED'
));
-- No row means Unreviewed. No backfill or synthetic events for existing bookmarks.
create table public.case_evidence_review_statuses (
  bookmark_id uuid primary key,
  case_id uuid not null references public.investigation_cases(id) on delete cascade,
  status text not null default 'unreviewed' check (status in ('unreviewed','in_review','verified','needs_follow_up')),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (bookmark_id, case_id) references public.case_evidence_bookmarks(id, case_id) on delete cascade
);
create index case_evidence_review_case_idx on public.case_evidence_review_statuses(case_id);
alter table public.case_evidence_review_statuses enable row level security;
revoke all on public.case_evidence_review_statuses from public, anon, authenticated, service_role;
grant select on public.case_evidence_review_statuses to authenticated;
grant select, insert, update on public.case_evidence_review_statuses to service_role;
create policy "Owners read evidence review status" on public.case_evidence_review_statuses for select to authenticated
using (exists (select 1 from public.investigation_cases c where c.id = case_id and c.created_by = auth.uid()));
-- No direct client writes. The API supplies the authenticated updater.
create function public.validate_case_evidence_review_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.bookmark_id is distinct from old.bookmark_id or new.case_id is distinct from old.case_id then
      raise exception 'Review status membership cannot change';
    end if;
  end if;
  perform 1 from public.case_evidence_bookmarks b
  join public.investigation_cases c on c.id = b.case_id
  where b.id = new.bookmark_id and b.case_id = new.case_id and c.created_by = new.updated_by
  for share of b, c;
  if not found then raise exception 'Review status updater must own the bookmarked case'; end if;
  if tg_op = 'UPDATE' then
    -- ON CONFLICT locks the existing row; repeated same-status requests preserve attribution/time.
    if new.status is not distinct from old.status then return old; end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end; $$;
create function public.record_case_evidence_review_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare previous_status text;
begin
  if tg_op = 'INSERT' then previous_status := 'unreviewed'; else previous_status := old.status; end if;
  if new.status is not distinct from previous_status then return new; end if;
  insert into public.case_activity_events(case_id,actor_user_id,event_type,metadata,origin)
  values(new.case_id,new.updated_by,'EVIDENCE_REVIEW_STATUS_CHANGED',
    jsonb_build_object('bookmarkId',new.bookmark_id,'previousStatus',previous_status,'status',new.status),'database');
  return new;
end; $$;
revoke all on function public.validate_case_evidence_review_status() from public, anon, authenticated;
revoke all on function public.record_case_evidence_review_activity() from public, anon, authenticated;
create trigger case_evidence_review_validate before insert or update on public.case_evidence_review_statuses
for each row execute function public.validate_case_evidence_review_status();
-- An audit failure rolls back the status mutation. No swallowed errors or separate audit write.
create trigger case_evidence_review_activity after insert or update on public.case_evidence_review_statuses
for each row execute function public.record_case_evidence_review_activity();
commit;
