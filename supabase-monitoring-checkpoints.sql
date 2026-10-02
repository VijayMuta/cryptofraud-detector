-- STAB-02. Manual migration AFTER supabase-monitoring-atomicity.sql.
-- Stop old monitoring workers before switching code. No historical backfill.
begin;

create table public.wallet_monitor_cursors (
  monitor_id uuid primary key references public.wallet_monitors(id) on delete cascade,
  confirmed_block bigint not null check (confirmed_block >= 0),
  scan_from bigint not null check (scan_from >= 0),
  scan_to bigint check (scan_to >= 0),
  next_page integer not null default 1 check (next_page > 0),
  revision bigint not null default 0 check (revision >= 0)
);
alter table public.wallet_monitor_cursors enable row level security;
revoke all on public.wallet_monitor_cursors from public, anon, authenticated, service_role;
grant select, insert, update on public.wallet_monitor_cursors to service_role;
-- No browser access or policies: server-owned retrieval progress only.

create function public.get_wallet_monitor_cursor(
  p_monitor_id uuid, p_user_id uuid, p_address text, p_reset boolean default false
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  m public.wallet_monitors%rowtype;
  c public.wallet_monitor_cursors%rowtype;
  boundary bigint;
  context_rows jsonb;
begin
  select * into m from public.wallet_monitors
  where id = p_monitor_id and user_id = p_user_id and address = p_address and network = 'ethereum'
  for update;
  if not found then raise exception 'Wallet monitor not found'; end if;
  if (p_reset and m.is_active) or (not p_reset and not m.is_active) then
    raise exception 'Invalid monitor state for checkpoint operation';
  end if;

  select * into c from public.wallet_monitor_cursors where monitor_id = p_monitor_id for update;
  if not found or p_reset then
    -- Existing stored history is the baseline on first use. Never infer a new
    -- boundary from the current provider head: that would skip unobserved activity.
    select coalesce(max(block_number), 0) into boundary
    from public.monitor_transactions where monitor_id = p_monitor_id;
    insert into public.wallet_monitor_cursors(monitor_id, confirmed_block, scan_from)
    values(p_monitor_id, boundary, boundary + 1)
    on conflict (monitor_id) do update set confirmed_block = excluded.confirmed_block,
      scan_from = excluded.scan_from, scan_to = null, next_page = 1,
      revision = public.wallet_monitor_cursors.revision + 1
    returning * into c;
  end if;

  -- Retain bounded recent context for the unchanged detectors across page edges.
  select coalesce(jsonb_agg(jsonb_build_object(
    'hash', t.transaction_hash, 'blockNumber', t.block_number::text,
    'timestamp', t.occurred_at, 'from', t.from_address, 'to', t.to_address,
    'value', t.value_wei::text, 'status', t.status
  ) order by t.block_number, t.transaction_hash), '[]'::jsonb) into context_rows
  from (select * from public.monitor_transactions where monitor_id = p_monitor_id
    order by block_number desc, transaction_hash desc limit 100) t;

  return jsonb_build_object('confirmedBlock', c.confirmed_block, 'scanFrom', c.scan_from,
    'scanTo', c.scan_to, 'nextPage', c.next_page, 'revision', c.revision, 'context', context_rows);
end;
$$;

create function public.persist_wallet_monitor_page(
  p_monitor_id uuid, p_user_id uuid, p_address text, p_checked_at timestamptz,
  p_expected_revision bigint, p_scan_from bigint, p_scan_to bigint, p_page integer,
  p_complete boolean, p_transactions jsonb, p_analysis jsonb, p_alerts jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_cursor jsonb;
  previous_success timestamptz;
  last_block bigint;
  result jsonb;
  row_count integer;
begin
  -- Same lock order as initialization and STAB-01: monitor first, then cursor.
  current_cursor := public.get_wallet_monitor_cursor(p_monitor_id, p_user_id, p_address);
  if p_expected_revision is distinct from (current_cursor->>'revision')::bigint
    or p_scan_from is distinct from (current_cursor->>'scanFrom')::bigint
    or p_page is distinct from (current_cursor->>'nextPage')::integer
    or p_scan_to is null or p_scan_to < (current_cursor->>'confirmedBlock')::bigint
    or (current_cursor->>'scanTo' is not null and p_scan_to is distinct from (current_cursor->>'scanTo')::bigint) then
    raise exception 'Stale or invalid monitoring page; reload checkpoint';
  end if;
  if jsonb_typeof(p_transactions) is distinct from 'array' or p_complete is null then
    raise exception 'Invalid monitoring page';
  end if;
  row_count := jsonb_array_length(p_transactions);
  if row_count > 100 or p_complete is distinct from (row_count < 100) then
    raise exception 'Invalid monitoring page completion';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_transactions) as t(block_number bigint)
    where t.block_number is null or t.block_number < p_scan_from or t.block_number > p_scan_to) then
    raise exception 'Transaction outside monitoring range';
  end if;
  select last_successful_check_at into previous_success from public.wallet_monitors where id = p_monitor_id;

  -- Nested function execution is part of this SAME transaction. A cursor update
  -- failure therefore rolls back STAB-01's transactions, analysis, alerts and status.
  result := public.persist_wallet_monitor_check(p_monitor_id, p_user_id, p_address,
    p_checked_at, p_transactions, p_analysis, p_alerts);

  if p_complete then
    -- A short/empty provider page cannot confirm a range whose witnessed head
    -- transaction was never persisted. Raising here rolls back the whole page.
    if p_scan_to > (current_cursor->>'confirmedBlock')::bigint and not exists (
      select 1 from public.monitor_transactions
      where monitor_id = p_monitor_id and block_number = p_scan_to
    ) then
      raise exception 'Monitoring range ended before its witnessed head';
    end if;
    update public.wallet_monitor_cursors set confirmed_block = p_scan_to,
      scan_from = p_scan_to + 1, scan_to = null, next_page = 1, revision = revision + 1
    where monitor_id = p_monitor_id;
  else
    select max(block_number) into last_block from jsonb_to_recordset(p_transactions) as t(block_number bigint);
    -- Restart inclusively at the last block to avoid provider total-result caps.
    -- If a page is entirely within one block, continue paging that block instead.
    -- Repeated rows are harmless through STAB-01's existing unique constraints.
    update public.wallet_monitor_cursors set scan_to = p_scan_to,
      scan_from = last_block,
      next_page = case when last_block > p_scan_from then 1 else p_page + 1 end,
      revision = revision + 1
    where monitor_id = p_monitor_id;
    update public.wallet_monitors set last_successful_check_at = previous_success,
      last_error = 'Monitoring coverage is incomplete. Saved progress will resume on the next check.'
    where id = p_monitor_id;
  end if;
  return result || jsonb_build_object('cursor', public.get_wallet_monitor_cursor(p_monitor_id, p_user_id, p_address));
end;
$$;

revoke all on function public.get_wallet_monitor_cursor(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.get_wallet_monitor_cursor(uuid, uuid, text, boolean) to service_role;
revoke all on function public.persist_wallet_monitor_page(uuid, uuid, text, timestamptz, bigint, bigint, bigint, integer, boolean, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.persist_wallet_monitor_page(uuid, uuid, text, timestamptz, bigint, bigint, bigint, integer, boolean, jsonb, jsonb, jsonb) to service_role;

commit;
