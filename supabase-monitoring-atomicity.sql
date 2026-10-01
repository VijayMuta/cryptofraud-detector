-- STAB-01. Apply manually AFTER supabase-schema.sql, BEFORE using the updated monitor.
-- No historical backfill, table changes, RLS changes, or alert threshold changes.
begin;

create function public.persist_wallet_monitor_check(
  p_monitor_id uuid,
  p_user_id uuid,
  p_address text,
  p_checked_at timestamptz,
  p_transactions jsonb,
  p_analysis jsonb,
  p_alerts jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  inserted_hashes text[];
  inserted_alert_count integer;
begin
  if p_checked_at is null
    or jsonb_typeof(p_transactions) is distinct from 'array'
    or jsonb_typeof(p_analysis) is distinct from 'object'
    or jsonb_typeof(p_alerts) is distinct from 'array' then
    raise exception 'Invalid monitoring persistence payload';
  end if;

  -- Server-supplied identity must still match the active monitor. Serialize checks
  -- for this monitor; ON CONFLICT also protects against baseline/concurrent inserts.
  perform 1 from public.wallet_monitors
  where id = p_monitor_id and user_id = p_user_id and address = p_address
    and network = 'ethereum' and is_active
  for update;
  if not found then raise exception 'Active wallet monitor not found'; end if;

  -- Analysis is stored with each new transaction, never in a later request.
  with inserted as (
    insert into public.monitor_transactions (
      monitor_id, transaction_hash, block_number, occurred_at, from_address,
      to_address, value_wei, status, analysis
    )
    select p_monitor_id, t.transaction_hash, t.block_number, t.occurred_at,
      t.from_address, t.to_address, t.value_wei, t.status, p_analysis
    from jsonb_to_recordset(p_transactions) as t(
      transaction_hash text, block_number bigint, occurred_at timestamptz,
      from_address text, to_address text, value_wei numeric(78, 0), status text
    )
    where true
    on conflict (monitor_id, transaction_hash) do nothing
    returning transaction_hash
  )
  select coalesce(array_agg(transaction_hash), array[]::text[])
  into inserted_hashes from inserted;

  -- Candidates come only from the existing server-side detectors. Old/baseline
  -- transactions cannot generate new alerts, even when candidates mention them.
  insert into public.monitor_alerts (
    monitor_id, source_transaction_hash, alert_type, severity,
    title, description, risk_score, details
  )
  select p_monitor_id, a.source_transaction_hash, a.alert_type, a.severity,
    a.title, a.description, a.risk_score, a.details
  from jsonb_to_recordset(p_alerts) as a(
    source_transaction_hash text, alert_type text, severity text,
    title text, description text, risk_score integer, details jsonb
  )
  where a.source_transaction_hash = any(inserted_hashes)
  on conflict (monitor_id, source_transaction_hash, alert_type) do nothing;
  get diagnostics inserted_alert_count = row_count;

  update public.wallet_monitors
  set last_checked_at = p_checked_at, last_successful_check_at = p_checked_at,
    last_error = null
  where id = p_monitor_id;

  return jsonb_build_object(
    'newTransactionCount', cardinality(inserted_hashes),
    'newAlertCount', inserted_alert_count
  );
  -- No exception handler: any failure rolls back all writes in this RPC.
end;
$$;

-- PostgreSQL grants PUBLIC function execution by default. Revoke it in the
-- same migration transaction; browser sessions must never call this write RPC.
revoke all on function public.persist_wallet_monitor_check(uuid, uuid, text, timestamptz, jsonb, jsonb, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.persist_wallet_monitor_check(uuid, uuid, text, timestamptz, jsonb, jsonb, jsonb)
to service_role;

commit;
