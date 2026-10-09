-- AUD-M02. Apply manually after supabase-schema.sql and supabase-phase5-schema.sql.
-- Existing case activity triggers, if installed, participate in this transaction.
-- Drain old case-creation requests before releasing the matching API/client.
begin;

create table public.case_creation_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  case_id uuid references public.investigation_cases(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);
-- Keep the key after case deletion: a stale retry must not recreate the case.
alter table public.case_creation_requests enable row level security;
revoke all on public.case_creation_requests from public, anon, authenticated, service_role;
grant select, insert, update on public.case_creation_requests to service_role;

create function public.create_case_atomic(
  p_user_id uuid, p_idempotency_key uuid, p_title text,
  p_description text, p_status text, p_wallets text[]
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  addresses text[];
  payload jsonb;
  attempt public.case_creation_requests%rowtype;
  created_case public.investigation_cases%rowtype;
  is_new boolean;
  wallets jsonb;
begin
  -- Only the authenticated server route may supply the verified owner. The
  -- ledger's auth.users foreign key also rejects nonexistent owner identities.
  if p_user_id is null or p_idempotency_key is null
    or p_title is null or char_length(btrim(p_title)) not between 2 and 160
    or p_description is null or char_length(btrim(p_description)) > 5000
    or p_status is null or p_status not in ('open', 'investigating', 'closed', 'archived')
    or p_wallets is null then
    raise exception 'Invalid case creation input' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_wallets) as w(address)
             where address is null or lower(btrim(address)) !~ '^0x[0-9a-f]{40}$') then
    raise exception 'Invalid case wallet' using errcode = '22023';
  end if;
  select coalesce(array_agg(address order by address), array[]::text[]) into addresses
  from (select distinct lower(btrim(address)) as address from unnest(p_wallets) as w(address)) as normalized;
  if cardinality(addresses) > 8 then
    raise exception 'Case wallet limit exceeded' using errcode = '22023';
  end if;
  payload := jsonb_build_object('title', btrim(p_title), 'description', btrim(p_description),
                                'status', p_status, 'wallets', to_jsonb(addresses));

  -- The unique owner/key arbitrates concurrent calls. ON CONFLICT waits for
  -- the winning transaction; rollback lets a waiter create the complete case.
  insert into public.case_creation_requests(user_id, idempotency_key, request_payload)
  values (p_user_id, p_idempotency_key, payload)
  on conflict (user_id, idempotency_key) do nothing;
  is_new := found;
  select * into strict attempt from public.case_creation_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key for update;
  if attempt.request_payload is distinct from payload then
    raise exception 'Creation key already used for different details' using errcode = 'PT409';
  end if;

  if is_new then
    insert into public.investigation_cases(title, description, status, created_by)
    values (btrim(p_title), btrim(p_description), p_status, p_user_id)
    returning * into created_case;
    insert into public.case_wallets(case_id, address, network, added_by)
    select created_case.id, address, 'ethereum', p_user_id from unnest(addresses) as w(address);
    update public.case_creation_requests set case_id = created_case.id
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
  else
    select * into created_case from public.investigation_cases
    where id = attempt.case_id and created_by = p_user_id for share;
    if not found then
      raise exception 'Previously created case is no longer available' using errcode = 'PT410';
    end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(w) order by w.added_at, w.id), '[]'::jsonb) into wallets
  from public.case_wallets w where w.case_id = created_case.id;
  return jsonb_build_object('case', to_jsonb(created_case) || jsonb_build_object('wallets', wallets), 'created', is_new);
  -- No exception handler or sequential fallback: case, wallets, activity
  -- triggers and the idempotency record commit together or all roll back.
end;
$$;

revoke all on function public.create_case_atomic(uuid, uuid, text, text, text, text[])
from public, anon, authenticated, service_role;
grant execute on function public.create_case_atomic(uuid, uuid, text, text, text, text[])
to service_role;

commit;
