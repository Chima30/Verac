-- TreasuryVault V2: payments approved by administrators' own ML-DSA-87 signatures instead of a password check plus a
-- server-held approver key. Safe to re-run.
--
-- * V2 payments live in the same `transactions` table as other live payments (same approvals list, invoice links,
--   audit trail and receipts), marked vault_version = 2. Their payment_hash is the V2 digest the administrators sign.
-- * An approval is a signature row in v2_signatures. The server verifies each signature against the administrator's key
--   registered on QoreChain before recording it; the vault verifies every signature again on chain when paying. This
--   table is a record, not the authority: a row added by a compromised server cannot make the vault pay.
-- * A V2 payment can NOT be approved with a password (decide_live_payment refuses), only rejected.
-- * admin_signers maps an organisation's people to their administrator addresses, so the person who requested a payment
--   cannot approve it with their own key.

alter table transactions
  add column if not exists vault_version smallint not null default 1,
  add column if not exists vault_address text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_vault_version_check') then
    alter table transactions add constraint transactions_vault_version_check check (vault_version in (1, 2));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_vault_address_check') then
    alter table transactions add constraint transactions_vault_address_check check (vault_address is null or vault_address ~ '^0x[0-9a-fA-F]{40}$');
  end if;
end $$;

create table if not exists admin_signers (
  organization_id uuid not null references organizations(id) on delete cascade,
  address text not null check (address ~ '^0x[0-9a-f]{40}$'), -- lower case
  user_id uuid not null,
  label text check (label is null or length(label) <= 80),
  added_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, address)
);
alter table admin_signers enable row level security;
drop policy if exists admin_signers_read on admin_signers;
create policy admin_signers_read on admin_signers for select using (has_role(organization_id, finance_roles()) or has_role(organization_id, security_roles()));

create table if not exists v2_signatures (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  transaction_id uuid not null references transactions(id) on delete cascade,
  signer_address text not null check (signer_address ~ '^0x[0-9a-f]{40}$'),
  digest text not null check (digest ~ '^0x[0-9a-f]{64}$'),
  signature text not null check (signature ~ '^0x[0-9a-f]+$' and length(signature) = 2 + 2 * 4627),
  submitted_by uuid,
  created_at timestamptz not null default now(),
  unique (transaction_id, signer_address)
);
create index if not exists v2_signatures_tx_idx on v2_signatures(transaction_id);
alter table v2_signatures enable row level security;
drop policy if exists v2_signatures_read on v2_signatures;
create policy v2_signatures_read on v2_signatures for select using (has_role(organization_id, finance_roles()) or has_role(organization_id, security_roles()));

-- ------------------------------------------------------------------ administrator addresses (owner or administrator)
create or replace function set_admin_signer(p_org uuid, p_address text, p_user uuid, p_label text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); a text := lower(p_address);
begin
  if me is null or not has_role(p_org, admin_roles()) then raise exception 'not allowed: only an owner or administrator can register administrator keys'; end if;
  if a !~ '^0x[0-9a-f]{40}$' then raise exception 'address must be 20-byte hex'; end if;
  if p_enabled then
    if not exists (select 1 from memberships where organization_id = p_org and user_id = p_user and role in ('owner', 'administrator')) then
      raise exception 'that person is not an owner or administrator of this organisation';
    end if;
    insert into admin_signers(organization_id, address, user_id, label, added_by) values (p_org, a, p_user, p_label, me)
    on conflict (organization_id, address) do update set user_id = excluded.user_id, label = excluded.label, added_by = me, created_at = now();
  else
    delete from admin_signers where organization_id = p_org and address = a;
  end if;
  insert into audit_events(organization_id, actor, action, subject, detail)
  values (p_org, me::text, case when p_enabled then 'admin_signer.set' else 'admin_signer.removed' end, a, jsonb_build_object('user', p_user, 'label', p_label));
end $$;

-- ------------------------------------------------------------------ requesting a V2 payment (as a signed-in finance user)
create or replace function request_live_payment_v2(
  p_org uuid, p_idempotency_key text, p_agent_account text, p_vault text, p_digest text, p_token text, p_recipient text,
  p_amount numeric, p_purpose_hash text, p_policy_version int, p_nonce numeric, p_expires_at timestamptz, p_required int, p_evaluation jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare tx uuid; me uuid := auth.uid();
begin
  if me is null or not has_role(p_org, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if p_required < 2 or p_required > 10 then raise exception 'a V2 payment needs 2 to 10 administrator signatures'; end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '24 hours' then raise exception 'a live payment must expire within the next 24 hours'; end if;
  if p_amount <= 0 or p_amount > 10000000000000000000 then raise exception 'live operations are limited to 10 QOR each'; end if;
  if p_digest !~ '^0x[0-9a-fA-F]{64}$' or p_purpose_hash !~ '^0x[0-9a-fA-F]{64}$' then raise exception 'hashes must be 32-byte hex'; end if;
  if p_recipient !~ '^0x[0-9a-fA-F]{40}$' or p_token !~ '^0x[0-9a-fA-F]{40}$' or p_agent_account !~ '^0x[0-9a-fA-F]{40}$' or p_vault !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception 'addresses must be 20-byte hex';
  end if;
  -- calldata_hash carries the digest too, so every existing live-operation guard treats this row as a live payment.
  insert into transactions(organization_id, idempotency_key, agent_id, state, payment_hash, token, recipient, amount, policy_version,
                           expires_at, required_approvals, evaluation, source, requested_by, history,
                           kind, agent_account, purpose_hash, nonce, calldata_hash, vault_version, vault_address)
  values (p_org, p_idempotency_key, 'PaymentAgent', 'AWAITING_APPROVAL', lower(p_digest), p_token, p_recipient, p_amount, p_policy_version,
          p_expires_at, p_required, p_evaluation, 'LIVE_TESTNET', me,
          jsonb_build_array(jsonb_build_object('state', 'AWAITING_APPROVAL', 'at', now(), 'by', me, 'vault', 'v2')),
          'payment', p_agent_account, p_purpose_hash, p_nonce, lower(p_digest), 2, p_vault)
  returning id into tx;
  insert into audit_events(organization_id, actor, action, subject, detail)
  values (p_org, me::text, 'live_payment_v2.requested', tx::text,
          jsonb_build_object('digest', lower(p_digest), 'vault', p_vault, 'recipient', p_recipient, 'amount', p_amount::text, 'required', p_required));
  return tx;
end $$;

-- ------------------------------------------------------------------ recording a verified signature (server only)
create or replace function v2_record_signature(p_tx uuid, p_signer text, p_digest text, p_signature text, p_submitted_by uuid) returns int
language plpgsql security definer set search_path = public as $$
declare t transactions%rowtype; s text := lower(p_signer); n int;
begin
  select * into t from transactions where id = p_tx for update;
  if not found or t.vault_version <> 2 then raise exception 'not a V2 payment'; end if;
  if t.state <> 'AWAITING_APPROVAL' then raise exception 'payment is % and takes no more signatures', t.state; end if;
  if t.expires_at <= now() then raise exception 'payment has expired'; end if;
  if lower(p_digest) <> t.payment_hash then raise exception 'the signature is for a different payment'; end if;
  if exists (select 1 from admin_signers where organization_id = t.organization_id and address = s and user_id = t.requested_by) then
    raise exception 'separation of duties: the person who requested this payment cannot approve it with their own key';
  end if;
  insert into v2_signatures(organization_id, transaction_id, signer_address, digest, signature, submitted_by)
  values (t.organization_id, t.id, s, lower(p_digest), lower(p_signature), p_submitted_by);
  select count(*) into n from v2_signatures where transaction_id = t.id and digest = t.payment_hash;
  insert into audit_events(organization_id, actor, action, subject, detail)
  values (t.organization_id, coalesce(p_submitted_by::text, 'server'), 'live_payment_v2.signature_recorded', t.id::text,
          jsonb_build_object('signer', s, 'signatures', n, 'required', t.required_approvals, 'verified', 'ML-DSA-87 against the key registered on QoreChain'));
  if n >= t.required_approvals then
    update transactions set state = 'APPROVED', updated_at = now(),
      history = history || jsonb_build_object('state', 'APPROVED', 'at', now(), 'by', 'administrator signatures', 'signatures', n)
     where id = t.id;
  end if;
  return n;
end $$;

-- ------------------------------------------------------------------ password approval is refused for V2
create or replace function decide_live_payment(p_tx uuid, p_decision text, p_note text, p_auth_method text) returns text
language plpgsql security definer set search_path = public as $$
declare t transactions%rowtype; me uuid := auth.uid(); s text;
begin
  select * into t from transactions where id = p_tx;
  if not found then raise exception 'unknown request'; end if;
  if t.source <> 'LIVE_TESTNET' or t.calldata_hash is null then raise exception 'this is not a live operation'; end if;
  if me is null or not has_role(t.organization_id, admin_roles()) then raise exception 'not allowed: only an owner or administrator can decide a live payment'; end if;
  if p_auth_method is null or length(p_auth_method) < 3 then raise exception 'the way you were re-authenticated must be recorded'; end if;
  if t.vault_version = 2 and p_decision = 'approve' then
    raise exception 'this payment uses TreasuryVault V2: it is approved only by administrators'' own ML-DSA-87 signatures, not by a password';
  end if;
  s := decide_payment_core(p_tx, p_decision, p_note);
  update approvals set evidence = evidence || jsonb_build_object('auth_method', p_auth_method, 'decided_at', now(), 'payment_hash', t.payment_hash)
   where subject_type = 'transaction' and subject_id = p_tx and approver = me;
  return s;
end $$;

-- ------------------------------------------------------------------ claiming counts signatures for V2
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
  if t.vault_version = 2 then
    select count(*) into n from v2_signatures where transaction_id = t.id and digest = t.payment_hash;
    if n < t.required_approvals then raise exception 'not enough administrator signatures for this payment (% of %)', n, t.required_approvals; end if;
  else
    select count(*) into n from approvals where subject_type = 'transaction' and subject_id = t.id and decision = 'approve' and payment_hash = t.payment_hash;
    if n < t.required_approvals then raise exception 'not enough approvals bound to this payment hash (% of %)', n, t.required_approvals; end if;
  end if;
  update transactions set state = 'READY', updated_at = now(), history = history || jsonb_build_object('state', 'READY', 'at', now(), 'by', 'server') where id = t.id
  returning * into t;
  insert into audit_events(organization_id, actor, action, subject, detail)
  values (t.organization_id, 'server-relay', 'live_payment.claimed', t.id::text, jsonb_build_object('payment_hash', t.payment_hash, 'approvals', n, 'vault_version', t.vault_version));
  return t;
end $$;

-- ------------------------------------------------------------------ permissions
revoke all on function set_admin_signer(uuid, text, uuid, text, boolean) from public;
revoke all on function request_live_payment_v2(uuid, text, text, text, text, text, text, numeric, text, int, numeric, timestamptz, int, jsonb) from public;
revoke all on function v2_record_signature(uuid, text, text, text, uuid) from public;
grant execute on function set_admin_signer(uuid, text, uuid, text, boolean) to authenticated;
grant execute on function request_live_payment_v2(uuid, text, text, text, text, text, text, numeric, text, int, numeric, timestamptz, int, jsonb) to authenticated;
do $$ declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function v2_record_signature(uuid, text, text, text, uuid) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function set_admin_signer(uuid, text, uuid, text, boolean) from anon';
    execute 'revoke all on function request_live_payment_v2(uuid, text, text, text, text, text, text, numeric, text, int, numeric, timestamptz, int, jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function v2_record_signature(uuid, text, text, text, uuid) to service_role;
  end if;
end $$;
