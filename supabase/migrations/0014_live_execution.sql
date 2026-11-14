-- Live execution on Diana testnet. Extends the approval workflow in 0003 so a payment can be executed on chain.
--
-- Who can do what:
--   * Finance roles request a live payment (request_live_payment) and administrators decide it (decide_live_payment),
--     both as themselves (auth.uid()), with separation of duties inherited from decide_payment.
--   * Only the server, using the service role, moves an operation through READY -> SUBMITTED -> CONFIRMED or FAILED
--     (live_* functions below). Signed-in users cannot reach those functions, and cannot write transactions directly.
--   * Every operation carries the exact fields that make up the on-chain payment hash. A decision is bound to that hash,
--     so changing the recipient, amount, token, purpose, nonce or expiry creates a different operation that needs its own approvals.

alter table transactions
  add column kind text not null default 'payment' check (kind in ('payment', 'escrow_fund')),
  add column agent_account text check (agent_account ~ '^0x[0-9a-fA-F]{40}$'),
  add column purpose_hash text check (purpose_hash ~ '^0x[0-9a-fA-F]{64}$'),
  add column nonce numeric(78,0),
  add column calldata_hash text check (calldata_hash ~ '^0x[0-9a-fA-F]{64}$'),
  add column project_id numeric(78,0),
  add column onchain_approval_tx text,
  add column block_number bigint,
  add column failure_reason text,
  add column submitted_at timestamptz,
  add column confirmed_at timestamptz;

create table security_alerts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null,
  transaction_id uuid references transactions(id) on delete set null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index security_alerts_org_idx on security_alerts(organization_id, created_at desc);
alter table security_alerts enable row level security;
create policy security_alerts_read on security_alerts for select using (has_role(organization_id, security_roles()));

-- ------------------------------------------------------------------ requesting (as a signed-in finance user)
create function request_live_payment(
  p_org uuid, p_idempotency_key text, p_kind text, p_agent_account text, p_payment_hash text, p_token text, p_recipient text,
  p_amount numeric, p_purpose_hash text, p_policy_version int, p_nonce numeric, p_expires_at timestamptz, p_required int,
  p_calldata_hash text, p_project_id numeric, p_evaluation jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare tx uuid; me uuid := auth.uid();
begin
  if me is null or not has_role(p_org, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if p_kind not in ('payment', 'escrow_fund') then raise exception 'unsupported operation kind'; end if;
  if p_required < 1 or p_required > 10 then raise exception 'required approvals must be 1 to 10'; end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '24 hours' then raise exception 'a live payment must expire within the next 24 hours'; end if;
  -- A second guard on top of the vault's own caps: the website never proposes more than 10 QOR in one live operation.
  if p_amount <= 0 or p_amount > 10000000000000000000 then raise exception 'live operations are limited to 10 QOR each'; end if;
  if p_payment_hash !~ '^0x[0-9a-fA-F]{64}$' or p_purpose_hash !~ '^0x[0-9a-fA-F]{64}$' or p_calldata_hash !~ '^0x[0-9a-fA-F]{64}$' then raise exception 'hashes must be 32-byte hex'; end if;
  if p_recipient !~ '^0x[0-9a-fA-F]{40}$' or p_token !~ '^0x[0-9a-fA-F]{40}$' or p_agent_account !~ '^0x[0-9a-fA-F]{40}$' then raise exception 'addresses must be 20-byte hex'; end if;
  if p_kind = 'escrow_fund' and p_project_id is null then raise exception 'escrow funding needs a project id'; end if;

  insert into transactions(organization_id, idempotency_key, agent_id, state, payment_hash, token, recipient, amount, policy_version,
                           expires_at, required_approvals, evaluation, source, requested_by, history,
                           kind, agent_account, purpose_hash, nonce, calldata_hash, project_id)
  values (p_org, p_idempotency_key, 'PaymentAgent', 'AWAITING_APPROVAL', p_payment_hash, p_token, p_recipient, p_amount, p_policy_version,
          p_expires_at, p_required, p_evaluation, 'LIVE_TESTNET', me,
          jsonb_build_array(jsonb_build_object('state', 'AWAITING_APPROVAL', 'at', now(), 'by', me)),
          p_kind, p_agent_account, p_purpose_hash, p_nonce, p_calldata_hash, p_project_id)
  returning id into tx;

  insert into audit_events(organization_id, actor, action, subject, detail)
  values (p_org, me::text, 'live_payment.requested', tx::text, jsonb_build_object('payment_hash', p_payment_hash, 'kind', p_kind, 'recipient', p_recipient, 'amount', p_amount::text, 'required', p_required));
  return tx;
end $$;

-- ------------------------------------------------------------------ deciding (as a signed-in administrator)
-- Wraps decide_payment (separation of duties, one decision each, expiry) and records how the administrator was authenticated.
create function decide_live_payment(p_tx uuid, p_decision text, p_note text, p_auth_method text) returns text
language plpgsql security definer set search_path = public as $$
declare t transactions%rowtype; me uuid := auth.uid(); s text;
begin
  select * into t from transactions where id = p_tx;
  if not found then raise exception 'unknown request'; end if;
  if t.source <> 'LIVE_TESTNET' then raise exception 'this is not a live operation'; end if;
  if me is null or not has_role(t.organization_id, admin_roles()) then raise exception 'not allowed: only an owner or administrator can decide a live payment'; end if;
  if p_auth_method is null or length(p_auth_method) < 3 then raise exception 'the way you were re-authenticated must be recorded'; end if;
  s := decide_payment(p_tx, p_decision, p_note);
  update approvals set evidence = evidence || jsonb_build_object('auth_method', p_auth_method, 'decided_at', now(), 'payment_hash', t.payment_hash)
   where subject_type = 'transaction' and subject_id = p_tx and approver = me;
  return s;
end $$;

-- ------------------------------------------------------------------ server only (service role)
create function live_claim_execution(p_tx uuid) returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions%rowtype; n int;
begin
  select * into t from transactions where id = p_tx for update;
  if not found then raise exception 'unknown operation'; end if;
  if t.source <> 'LIVE_TESTNET' then raise exception 'not a live operation'; end if;
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

create function live_record_relay(p_tx uuid, p_hash text) returns void language plpgsql security definer set search_path = public as $$
declare t transactions%rowtype;
begin
  select * into t from transactions where id = p_tx for update;
  if not found or t.state <> 'READY' then raise exception 'operation is not ready'; end if;
  update transactions set onchain_approval_tx = p_hash, updated_at = now() where id = p_tx;
  insert into audit_events(organization_id, actor, action, subject, detail)
  values (t.organization_id, 'server-relay', 'live_payment.approval_relayed', t.id::text, jsonb_build_object('tx_hash', p_hash, 'submitted_by', 'server relay on behalf of the approving administrators'));
end $$;

create function live_record_submitted(p_tx uuid, p_hash text) returns void language plpgsql security definer set search_path = public as $$
declare t transactions%rowtype;
begin
  select * into t from transactions where id = p_tx for update;
  if not found or t.state <> 'READY' then raise exception 'operation is not ready'; end if;
  update transactions set state = 'SUBMITTED', tx_hash = p_hash, submitted_at = now(), updated_at = now(),
    history = history || jsonb_build_object('state', 'SUBMITTED', 'at', now(), 'tx', p_hash) where id = p_tx;
  insert into audit_events(organization_id, actor, action, subject, detail)
  values (t.organization_id, 'server-relay', 'live_payment.submitted', t.id::text, jsonb_build_object('tx_hash', p_hash));
end $$;

-- Only called after the receipt (and the matching contract event) has been read back from the chain.
create function live_record_outcome(p_tx uuid, p_ok boolean, p_block bigint, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare t transactions%rowtype; ns text;
begin
  select * into t from transactions where id = p_tx for update;
  if not found or t.state <> 'SUBMITTED' then raise exception 'operation is not submitted'; end if;
  ns := case when p_ok then 'CONFIRMED' else 'FAILED' end;
  update transactions set state = ns, block_number = p_block, failure_reason = case when p_ok then null else p_reason end,
    confirmed_at = case when p_ok then now() else null end, updated_at = now(),
    history = history || jsonb_build_object('state', ns, 'at', now(), 'block', p_block, 'reason', p_reason) where id = p_tx;
  insert into audit_events(organization_id, actor, action, subject, detail)
  values (t.organization_id, 'server-relay', 'live_payment.' || lower(ns), t.id::text, jsonb_build_object('tx_hash', t.tx_hash, 'block', p_block, 'reason', p_reason));
end $$;

-- A failure before anything was sent (simulation rejected, signer refused, window could not open).
create function live_record_failure(p_tx uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare t transactions%rowtype;
begin
  select * into t from transactions where id = p_tx for update;
  if not found or t.state not in ('APPROVED', 'READY') then raise exception 'operation cannot fail from %', coalesce(t.state, 'unknown'); end if;
  update transactions set state = 'FAILED', failure_reason = p_reason, updated_at = now(),
    history = history || jsonb_build_object('state', 'FAILED', 'at', now(), 'reason', p_reason) where id = p_tx;
  insert into audit_events(organization_id, actor, action, subject, detail)
  values (t.organization_id, 'server-relay', 'live_payment.failed_before_submission', t.id::text, jsonb_build_object('reason', p_reason));
end $$;

create function live_raise_alert(p_org uuid, p_kind text, p_tx uuid, p_detail jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into security_alerts(organization_id, kind, transaction_id, detail) values (p_org, p_kind, p_tx, coalesce(p_detail, '{}'));
  insert into audit_events(organization_id, actor, action, subject, detail) values (p_org, 'server-relay', 'security_alert.' || p_kind, p_tx::text, coalesce(p_detail, '{}'));
end $$;

-- ------------------------------------------------------------------ permissions
revoke all on function request_live_payment(uuid, text, text, text, text, text, text, numeric, text, int, numeric, timestamptz, int, text, numeric, jsonb) from public;
revoke all on function decide_live_payment(uuid, text, text, text) from public;
revoke all on function live_claim_execution(uuid) from public;
revoke all on function live_record_relay(uuid, text) from public;
revoke all on function live_record_submitted(uuid, text) from public;
revoke all on function live_record_outcome(uuid, boolean, bigint, text) from public;
revoke all on function live_record_failure(uuid, text) from public;
revoke all on function live_raise_alert(uuid, text, uuid, jsonb) from public;
grant execute on function request_live_payment(uuid, text, text, text, text, text, text, numeric, text, int, numeric, timestamptz, int, text, numeric, jsonb) to authenticated;
grant execute on function decide_live_payment(uuid, text, text, text) to authenticated;
-- Server-only functions: the service role (Supabase) is the only grantee. Browser and signed-in users cannot call them.
-- Supabase grants every new function to anon, authenticated and service_role by default, so revoking from public is not
-- enough: take the grant away from the browser-facing roles explicitly.
do $$ declare r text; f text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach f in array array[
        'live_claim_execution(uuid)', 'live_record_relay(uuid, text)', 'live_record_submitted(uuid, text)',
        'live_record_outcome(uuid, boolean, bigint, text)', 'live_record_failure(uuid, text)', 'live_raise_alert(uuid, text, uuid, jsonb)'
      ] loop
        execute format('revoke all on function %s from %I', f, r);
      end loop;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function live_claim_execution(uuid) to service_role;
    grant execute on function live_record_relay(uuid, text) to service_role;
    grant execute on function live_record_submitted(uuid, text) to service_role;
    grant execute on function live_record_outcome(uuid, boolean, bigint, text) to service_role;
    grant execute on function live_record_failure(uuid, text) to service_role;
    grant execute on function live_raise_alert(uuid, text, uuid, jsonb) to service_role;
  end if;
end $$;
