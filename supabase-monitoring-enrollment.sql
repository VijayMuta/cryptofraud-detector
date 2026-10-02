-- AUD-H01. Apply manually AFTER supabase-monitoring-checkpoints.sql.
-- Drain old enrollment requests before releasing matching application code.
-- Additive migration: no historical backfill or changes to STAB-01/STAB-02 RPCs.
begin;

create function public.enroll_wallet_monitor(
  p_monitor_id uuid, p_user_id uuid, p_address text,
  p_expected_updated_at timestamptz, p_checked_at timestamptz, p_transactions jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  m public.wallet_monitors%rowtype;
begin
  if p_user_id is null or p_address is null or p_address !~ '^0x[0-9a-f]{40}$'
    or p_checked_at is null or jsonb_typeof(p_transactions) is distinct from 'array' then
    raise exception 'Invalid enrollment payload';
  end if;
  if jsonb_array_length(p_transactions) > 100 then
    raise exception 'Invalid baseline size';
  end if;

  if p_monitor_id is null then
    if p_expected_updated_at is not null then raise exception 'Invalid enrollment identity'; end if;
    -- Unique owner/address/network constraint arbitrates competing first enrollments.
    -- A loser must not reuse the winner's row with its later baseline snapshot.
    insert into public.wallet_monitors(user_id, address, network, is_active)
    values(p_user_id, p_address, 'ethereum', false)
    on conflict (user_id, address, network) do nothing
    returning * into m;
    if not found then
      raise exception 'Stale enrollment; reload monitor' using errcode = '40001';
    end if;
  else
    -- Same lock order as STAB-01/STAB-02: monitor first, cursor second.
    select * into m from public.wallet_monitors
    where id = p_monitor_id and user_id = p_user_id and address = p_address and network = 'ethereum'
    for update;
    if not found then raise exception 'Wallet monitor not found'; end if;
  end if;

  -- This check precedes ALL baseline writes. The row lock lasts until commit.
  if m.is_active or (p_monitor_id is not null and
      (p_expected_updated_at is null or m.updated_at is distinct from p_expected_updated_at)) then
    raise exception 'Stale enrollment; reload monitor' using errcode = '40001';
  end if;

  insert into public.monitor_transactions (
    monitor_id, transaction_hash, block_number, occurred_at, from_address,
    to_address, value_wei, status
  )
  select m.id, t.transaction_hash, t.block_number, t.occurred_at,
    t.from_address, t.to_address, t.value_wei, t.status
  from jsonb_to_recordset(p_transactions) as t(
    transaction_hash text, block_number bigint, occurred_at timestamptz,
    from_address text, to_address text, value_wei numeric(78, 0), status text
  )
  where true
  on conflict (monitor_id, transaction_hash) do nothing;

  -- Nested call participates in this transaction and preserves existing baseline
  -- block semantics and revision invalidation. It requires the row still inactive.
  perform public.get_wallet_monitor_cursor(m.id, p_user_id, p_address, true);

  update public.wallet_monitors
  set is_active = true, last_checked_at = p_checked_at,
    last_successful_check_at = p_checked_at, last_error = null
  where id = m.id
  returning * into m;

  return jsonb_build_object('monitor', to_jsonb(m),
    'baselineTransactionCount', jsonb_array_length(p_transactions));
  -- No exception handler: baseline, cursor, activation and first-row creation
  -- all roll back together. A lost response never authorizes sequential retries.
end;
$$;

revoke all on function public.enroll_wallet_monitor(uuid, uuid, text, timestamptz, timestamptz, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.enroll_wallet_monitor(uuid, uuid, text, timestamptz, timestamptz, jsonb)
to service_role;

commit;
