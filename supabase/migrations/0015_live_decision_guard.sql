-- Closes a gap in 0014: the generic decide_payment (0003/0005) works on every row in `transactions`, including live ones, and is
-- executable by any signed-in finance user. That would let a live payment be approved or rejected without the administrator-only
-- rule and without the password re-entry that decide_live_payment records. Live operations (those carrying a calldata hash) can
-- now be decided ONLY through decide_live_payment.
--
-- decide_payment keeps its name, arguments and behaviour for ordinary (simulation, payroll) requests, so the Approvals page and
-- existing callers are unchanged. The real logic moves, unchanged, to decide_payment_core, which browsers cannot call.

-- Re-runnable: rename only when the core does not exist yet (renaming the wrapper onto the core would make it call itself).
do $$ begin
  if to_regprocedure('public.decide_payment_core(uuid,text,text)') is null then
    alter function decide_payment(uuid, text, text) rename to decide_payment_core;
  end if;
end $$;
revoke all on function decide_payment_core(uuid, text, text) from public, anon, authenticated;

create or replace function decide_payment(p_tx uuid, p_decision text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from transactions where id = p_tx and calldata_hash is not null) then
    raise exception 'this is a live payment: it can only be decided as an administrator with re-authentication (decide_live_payment)';
  end if;
  return decide_payment_core(p_tx, p_decision, p_note);
end $$;
revoke all on function decide_payment(uuid, text, text) from public, anon;
grant execute on function decide_payment(uuid, text, text) to authenticated;

-- decide_live_payment now calls the core directly (the wrapper would refuse live rows), and only accepts real live operations.
create or replace function decide_live_payment(p_tx uuid, p_decision text, p_note text, p_auth_method text) returns text
language plpgsql security definer set search_path = public as $$
declare t transactions%rowtype; me uuid := auth.uid(); s text;
begin
  select * into t from transactions where id = p_tx;
  if not found then raise exception 'unknown request'; end if;
  if t.source <> 'LIVE_TESTNET' or t.calldata_hash is null then raise exception 'this is not a live operation'; end if;
  if me is null or not has_role(t.organization_id, admin_roles()) then raise exception 'not allowed: only an owner or administrator can decide a live payment'; end if;
  if p_auth_method is null or length(p_auth_method) < 3 then raise exception 'the way you were re-authenticated must be recorded'; end if;
  s := decide_payment_core(p_tx, p_decision, p_note);
  update approvals set evidence = evidence || jsonb_build_object('auth_method', p_auth_method, 'decided_at', now(), 'payment_hash', t.payment_hash)
   where subject_type = 'transaction' and subject_id = p_tx and approver = me;
  return s;
end $$;

-- Defence in depth: the server will not claim a row that is not a fully described live operation.
create or replace function live_claim_execution(p_tx uuid) returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions%rowtype; n int;
begin
  select * into t from transactions where id = p_tx for update;
  if not found then raise exception 'unknown operation'; end if;
  if t.source <> 'LIVE_TESTNET' or t.calldata_hash is null then raise exception 'not a live operation'; end if;
  if t.state <> 'APPROVED' then raise exception 'operation is % and cannot be executed', t.state; end if;
  if t.expires_at <= now() then
    update transactions set state = 'CANCELLED', updated_at = now(), failure_reason = 'expired before execution',
      history = history || jsonb_build_object('state', 'CANCELLED', 'at', now(), 'reason', 'expired') where id = t.id;
    raise exception 'operation expired';
  end if;
  select count(*) into n from approvals where subject_type = 'transaction' and subject_id = t.id and decision = 'approve' and payment_hash = t.payment_hash;
  if n < t.required_approvals then raise exception 'not enough approvals bound to this payment hash (% of %)', n, t.required_approvals; end if;
  update transactions set state = 'READY', updated_at = now(), history = history || jsonb_build_object('state', 'READY', 'at', now(), 'by', 'server') where id = t.id
  returning * into t;
  insert into audit_events(organization_id, actor, action, subject, detail)
  values (t.organization_id, 'server-relay', 'live_payment.claimed', t.id::text, jsonb_build_object('payment_hash', t.payment_hash, 'approvals', n));
  return t;
end $$;
