-- Payroll: a batch is submitted through one audited function, which also opens an approval request bound to the batch hash.
-- Approving or rejecting that request (decide_payment) updates the batch. Nothing here moves QOR: payment execution is not wired.

drop policy payroll_batches_wr on payroll_batches;   -- no more direct writes; state changes only through the functions

create function submit_payroll_batch(p_org uuid, p_period text, p_items jsonb, p_total numeric, p_hash text, p_required int, p_expires timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); b uuid; existing payroll_batches%rowtype; tx uuid;
  zero constant text := '0x0000000000000000000000000000000000000000';
begin
  if me is null or not has_role(p_org, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'period must look like 2026-11'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'a batch needs 1 to 200 lines'; end if;
  if p_total <= 0 then raise exception 'total must be positive'; end if;

  select * into existing from payroll_batches where organization_id = p_org and period = p_period for update;
  if found then
    if existing.status <> 'failed' then raise exception 'a payroll for % already exists (%)', p_period, existing.status; end if;
    update payroll_batches set items = p_items, total = p_total, status = 'awaiting_approval', created_by = me where id = existing.id;
    b := existing.id;
  else
    insert into payroll_batches(organization_id, period, items, total, token, status, created_by) values (p_org, p_period, p_items, p_total, zero, 'awaiting_approval', me) returning id into b;
  end if;

  begin
    tx := request_payment_approval(p_org, 'payroll-' || gen_random_uuid(), 'PayrollAgent', p_hash, zero, 'payroll:' || p_period, p_total, 1, p_expires, p_required,
      jsonb_build_object('payroll', jsonb_build_object('period', p_period, 'items', p_items), 'payroll_batch_id', b, 'purpose', 'Payroll ' || p_period));
  exception when unique_violation then raise exception 'an identical batch was already submitted for approval';
  end;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p_org, me::text, 'payroll.submitted', b::text, jsonb_build_object('period', p_period, 'lines', jsonb_array_length(p_items), 'transaction', tx));
  return tx;
end $$;

-- decide_payment as in 0003, plus: a decision on a payroll request updates the batch.
create or replace function decide_payment(p_tx uuid, p_decision text, p_note text default null) returns text language plpgsql security definer set search_path = public as $$
declare t transactions%rowtype; me uuid := auth.uid(); n int; new_state text; batch uuid;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'decision must be approve or reject'; end if;
  select * into t from transactions where id = p_tx for update;
  if not found then raise exception 'unknown request'; end if;
  if me is null or not has_role(t.organization_id, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if t.state <> 'AWAITING_APPROVAL' then raise exception 'this request is already %', t.state; end if;
  if t.requested_by = me then raise exception 'separation of duties: you cannot decide a request you made'; end if;
  batch := nullif(t.evaluation->>'payroll_batch_id', '')::uuid;

  if t.expires_at <= now() then
    update transactions set state = 'CANCELLED', updated_at = now(), history = history || jsonb_build_object('state', 'CANCELLED', 'at', now(), 'reason', 'expired') where id = t.id;
    update agent_tasks set state = 'FAILED', error = 'Approval expired', updated_at = now() where organization_id = t.organization_id and result->>'transaction_id' = t.id::text;
    if batch is not null then update payroll_batches set status = 'failed' where id = batch; end if;
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
    if batch is not null then update payroll_batches set status = 'approved' where id = batch; end if;
  elsif new_state = 'REJECTED' then
    update agent_tasks set state = 'FAILED', error = 'Rejected by an approver', updated_at = now() where organization_id = t.organization_id and result->>'transaction_id' = t.id::text;
    if batch is not null then update payroll_batches set status = 'failed' where id = batch; end if;
  end if;
  insert into audit_events(organization_id, actor, action, subject, detail)
  values (t.organization_id, me::text, 'payment.' || p_decision, t.id::text, jsonb_build_object('state', new_state, 'payment_hash', t.payment_hash));
  return new_state;
end $$;

revoke all on function submit_payroll_batch(uuid, text, jsonb, numeric, text, int, timestamptz) from public;
grant execute on function submit_payroll_batch(uuid, text, jsonb, numeric, text, int, timestamptz) to authenticated;
