-- Approval workflow. Payment requests and decisions go only through the two SECURITY DEFINER functions below,
-- so the state machine, the separation of duties and the audit trail cannot be bypassed with direct writes.
-- Everything created here is a SIMULATION record: approving does not execute anything on chain.

alter table transactions add column requested_by uuid;

-- Previously finance roles could insert/update these tables directly (e.g. set state = 'APPROVED' themselves).
drop policy transactions_wr on transactions;
drop policy approvals_ins on approvals;

create function request_payment_approval(
  p_org uuid, p_idempotency_key text, p_agent_id text, p_payment_hash text, p_token text, p_recipient text,
  p_amount numeric, p_policy_version int, p_expires_at timestamptz, p_required int, p_evaluation jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare tx uuid; me uuid := auth.uid();
begin
  if me is null or not has_role(p_org, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if p_required < 1 or p_required > 10 then raise exception 'required approvals must be 1 to 10'; end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '7 days' then raise exception 'expiry must be within the next 7 days'; end if;
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;

  insert into transactions(organization_id, idempotency_key, agent_id, state, payment_hash, token, recipient, amount, policy_version,
                           expires_at, required_approvals, evaluation, source, requested_by, history)
  values (p_org, p_idempotency_key, p_agent_id, 'AWAITING_APPROVAL', p_payment_hash, p_token, p_recipient, p_amount, p_policy_version,
          p_expires_at, p_required, p_evaluation, 'SIMULATION', me,
          jsonb_build_array(jsonb_build_object('state', 'AWAITING_APPROVAL', 'at', now(), 'by', me)))
  returning id into tx;

  insert into agent_tasks(organization_id, requested_by, agent_id, intent, state, result)
  values (p_org, me, p_agent_id, 'Payment awaiting human approval', 'AWAITING_HUMAN', jsonb_build_object('transaction_id', tx));

  insert into audit_events(organization_id, actor, action, subject, detail)
  values (p_org, me::text, 'payment.approval_requested', tx::text, jsonb_build_object('payment_hash', p_payment_hash, 'required', p_required, 'source', 'SIMULATION'));
  return tx;
end $$;

create function decide_payment(p_tx uuid, p_decision text, p_note text default null) returns text language plpgsql security definer set search_path = public as $$
declare t transactions%rowtype; me uuid := auth.uid(); n int; new_state text;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'decision must be approve or reject'; end if;
  select * into t from transactions where id = p_tx for update;
  if not found then raise exception 'unknown request'; end if;
  if me is null or not has_role(t.organization_id, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if t.state <> 'AWAITING_APPROVAL' then raise exception 'this request is already %', t.state; end if;
  if t.requested_by = me then raise exception 'separation of duties: you cannot decide a request you made'; end if;

  if t.expires_at <= now() then
    update transactions set state = 'CANCELLED', updated_at = now(), history = history || jsonb_build_object('state', 'CANCELLED', 'at', now(), 'reason', 'expired') where id = t.id;
    update agent_tasks set state = 'FAILED', error = 'Approval expired', updated_at = now() where organization_id = t.organization_id and result->>'transaction_id' = t.id::text;
    insert into audit_events(organization_id, actor, action, subject) values (t.organization_id, 'system', 'payment.approval_expired', t.id::text);
    return 'CANCELLED';
  end if;

  begin
    insert into approvals(organization_id, subject_type, subject_id, payment_hash, approver, decision, evidence)
    values (t.organization_id, 'transaction', t.id, t.payment_hash, me, p_decision, jsonb_build_object('note', p_note));
  exception when unique_violation then raise exception 'you have already decided this request';
  end;

  new_state := 'AWAITING_APPROVAL';
  if p_decision = 'reject' then
    new_state := 'REJECTED';
  else
    select count(*) into n from approvals where subject_type = 'transaction' and subject_id = t.id and decision = 'approve';
    if n >= t.required_approvals then new_state := 'APPROVED'; end if;
  end if;

  update transactions set state = new_state, updated_at = now(),
    history = history || jsonb_build_object('state', new_state, 'at', now(), 'by', me, 'decision', p_decision) where id = t.id;
  if new_state = 'APPROVED' then
    update agent_tasks set state = 'COMPLETED', updated_at = now() where organization_id = t.organization_id and result->>'transaction_id' = t.id::text;
  elsif new_state = 'REJECTED' then
    update agent_tasks set state = 'FAILED', error = 'Rejected by an approver', updated_at = now() where organization_id = t.organization_id and result->>'transaction_id' = t.id::text;
  end if;
  insert into audit_events(organization_id, actor, action, subject, detail)
  values (t.organization_id, me::text, 'payment.' || p_decision, t.id::text, jsonb_build_object('state', new_state, 'payment_hash', t.payment_hash));
  return new_state;
end $$;

revoke all on function request_payment_approval(uuid, text, text, text, text, text, numeric, int, timestamptz, int, jsonb) from public;
revoke all on function decide_payment(uuid, text, text) from public;
grant execute on function request_payment_approval(uuid, text, text, text, text, text, numeric, int, timestamptz, int, jsonb) to authenticated;
grant execute on function decide_payment(uuid, text, text) to authenticated;
