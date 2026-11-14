
-- ===== 0004_procurement.sql =====
-- Procurement: tenders, sealed bids, award with milestone plan.
-- Bids are QoreSeal envelopes (ML-KEM-1024 + X25519, AES-GCM) created in the vendor's browser and sealed to the reviewers'
-- PUBLIC keys. The database stores ciphertext only. Private keys never reach the server.
-- All state changes go through SECURITY DEFINER functions; direct writes to these tables are removed.

alter table documents add column envelope text;

create table org_seal_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null,
  mlkem_public text not null check (length(mlkem_public) = 3136 and mlkem_public ~ '^[0-9a-f]+$'),   -- ML-KEM-1024 encapsulation key, 1568 bytes
  x25519_public text not null check (x25519_public ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
alter table org_seal_keys enable row level security;
alter table org_seal_keys force row level security;
create policy org_seal_keys_sel on org_seal_keys for select using (is_internal(organization_id));

-- Tighten tables that previously allowed direct writes.
drop policy procurements_wr on procurements;
create policy procurements_ins on procurements for insert with check (
  has_role(organization_id, procurement_roles()) and status = 'draft' and created_by = auth.uid() and award_bid_id is null and escrow_project_id is null
);
-- Vendors may read tenders that are no longer drafts (so they can bid on them).
create policy procurements_vendor_sel on procurements for select using (status <> 'draft' and has_role(organization_id, array['vendor']::org_role[]));
drop policy bids_ins on bids;
drop policy milestones_wr on milestones;

-- A reviewer publishes the public half of their reading key. Never replaced: replacing it would lock them out of existing bids.
create function publish_seal_key(p_org uuid, p_mlkem text, p_x25519 text) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not has_role(p_org, procurement_roles()) then raise exception 'not allowed: procurement role required'; end if;
  begin
    insert into org_seal_keys(organization_id, user_id, mlkem_public, x25519_public) values (p_org, auth.uid(), lower(p_mlkem), lower(p_x25519));
  exception when unique_violation then raise exception 'you already published a reading key; it cannot be replaced';
  end;
  insert into audit_events(organization_id, actor, action) values (p_org, auth.uid()::text, 'procurement.seal_key_published');
end $$;

-- Public keys a vendor must seal to: active procurement-role members who published one.
create function procurement_reviewer_keys(p_proc uuid) returns table(user_id uuid, mlkem_public text, x25519_public text)
language plpgsql stable security definer set search_path = public as $$
declare p procurements%rowtype;
begin
  select * into p from procurements where id = p_proc;
  if not found or auth.uid() is null or not is_member(p.organization_id) then raise exception 'unknown tender'; end if;
  return query
    select k.user_id, k.mlkem_public, k.x25519_public from org_seal_keys k
    where k.organization_id = p.organization_id
      and exists (select 1 from memberships m where m.organization_id = k.organization_id and m.user_id = k.user_id and m.status = 'active' and m.role = any(procurement_roles()))
    order by k.created_at;
end $$;

create function open_tender(p_proc uuid, p_deadline timestamptz default null) returns void language plpgsql security definer set search_path = public as $$
declare p procurements%rowtype;
begin
  select * into p from procurements where id = p_proc for update;
  if not found or auth.uid() is null or not has_role(p.organization_id, procurement_roles()) then raise exception 'not allowed: procurement role required'; end if;
  if p.status <> 'draft' then raise exception 'tender is already %', p.status; end if;
  if p_deadline is not null and p_deadline <= now() then raise exception 'deadline must be in the future'; end if;
  if not exists (select 1 from org_seal_keys k join memberships m on m.organization_id = k.organization_id and m.user_id = k.user_id and m.status = 'active' and m.role = any(procurement_roles()) where k.organization_id = p.organization_id)
    then raise exception 'publish at least one reviewer reading key first, otherwise bids cannot be sealed to anyone'; end if;
  update procurements set status = 'open', bids_open_at = p_deadline where id = p.id;
  insert into audit_events(organization_id, actor, action, subject) values (p.organization_id, auth.uid()::text, 'procurement.opened', p.id::text);
end $$;

create function submit_bid(p_proc uuid, p_vendor_name text, p_envelope text, p_sha256 text) returns uuid language plpgsql security definer set search_path = public as $$
declare p procurements%rowtype; me uuid := auth.uid(); v uuid; d uuid; b uuid;
begin
  select * into p from procurements where id = p_proc;
  if not found or me is null or not has_role(p.organization_id, array['vendor']::org_role[]) then raise exception 'not allowed: vendor role required'; end if;
  if p.status <> 'open' then raise exception 'this tender is not open for bids'; end if;
  if p.bids_open_at is not null and p.bids_open_at <= now() then raise exception 'the bid deadline has passed'; end if;
  if length(coalesce(p_envelope, '')) < 200 or length(p_envelope) > 400000 then raise exception 'the sealed bid has an invalid size'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid checksum'; end if;
  if length(trim(coalesce(p_vendor_name, ''))) not between 1 and 120 then raise exception 'vendor name must be 1 to 120 characters'; end if;
  if exists (select 1 from bids where procurement_id = p.id and submitted_by = me) then raise exception 'you have already submitted a bid for this tender'; end if;

  select id into v from vendors where organization_id = p.organization_id and user_id = me limit 1;
  if v is null then insert into vendors(organization_id, user_id, name) values (p.organization_id, me, trim(p_vendor_name)) returning id into v; end if;
  insert into documents(organization_id, purpose, storage_path, ciphertext_sha256, envelope_bytes, uploaded_by, envelope)
  values (p.organization_id, 'bid', 'db:envelope', p_sha256, length(p_envelope), me, p_envelope) returning id into d;
  insert into bids(organization_id, procurement_id, vendor_id, submitted_by, document_id) values (p.organization_id, p.id, v, me, d) returning id into b;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p.organization_id, me::text, 'procurement.bid_submitted', p.id::text, jsonb_build_object('bid', b, 'envelope_sha256', p_sha256));
  return b;
end $$;

create function close_bidding(p_proc uuid) returns int language plpgsql security definer set search_path = public as $$
declare p procurements%rowtype; n int;
begin
  select * into p from procurements where id = p_proc for update;
  if not found or auth.uid() is null or not has_role(p.organization_id, procurement_roles()) then raise exception 'not allowed: procurement role required'; end if;
  if p.status <> 'open' then raise exception 'tender is %, not open', p.status; end if;
  select count(*) into n from bids where procurement_id = p.id;
  if n < 1 then raise exception 'there are no bids to review'; end if;
  update procurements set status = 'review' where id = p.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p.organization_id, auth.uid()::text, 'procurement.bidding_closed', p.id::text, jsonb_build_object('bids', n));
  return n;
end $$;

-- Ciphertext is released to reviewers only after bidding closes.
create function procurement_bids(p_proc uuid) returns table(bid_id uuid, vendor_name text, submitted_at timestamptz, envelope text, envelope_sha256 text)
language plpgsql stable security definer set search_path = public as $$
declare p procurements%rowtype;
begin
  select * into p from procurements where id = p_proc;
  if not found or auth.uid() is null or not has_role(p.organization_id, procurement_roles()) then raise exception 'not allowed: procurement role required'; end if;
  if p.status not in ('review', 'awarded', 'closed') then raise exception 'bids stay sealed until bidding is closed'; end if;
  return query select b.id, v.name, b.created_at, d.envelope, d.ciphertext_sha256
    from bids b join vendors v on v.id = b.vendor_id join documents d on d.id = b.document_id where b.procurement_id = p.id order by b.created_at;
end $$;

create function award_procurement(p_proc uuid, p_bid uuid, p_milestones jsonb) returns int language plpgsql security definer set search_path = public as $$
declare p procurements%rowtype; m jsonb; i int := 0; total numeric := 0; amt numeric;
begin
  select * into p from procurements where id = p_proc for update;
  if not found or auth.uid() is null or not has_role(p.organization_id, procurement_roles()) then raise exception 'not allowed: procurement role required'; end if;
  if p.status <> 'review' then raise exception 'tender must be in review to award (it is %)', p.status; end if;
  if not exists (select 1 from bids where id = p_bid and procurement_id = p.id) then raise exception 'that bid does not belong to this tender'; end if;
  if jsonb_typeof(p_milestones) <> 'array' or jsonb_array_length(p_milestones) not between 1 and 10 then raise exception 'provide 1 to 10 milestones'; end if;
  for m in select * from jsonb_array_elements(p_milestones) loop
    if length(trim(coalesce(m->>'title', ''))) not between 1 and 120 then raise exception 'each milestone needs a title of 1 to 120 characters'; end if;
    if coalesce(m->>'amount', '') !~ '^[0-9]{1,40}$' then raise exception 'each milestone amount must be a whole number of base units'; end if;
    amt := (m->>'amount')::numeric;
    if amt <= 0 then raise exception 'milestone amounts must be positive'; end if;
    total := total + amt; i := i + 1;
    insert into milestones(organization_id, parent_type, parent_id, idx, title, amount) values (p.organization_id, 'procurement', p.id, i, trim(m->>'title'), amt);
  end loop;
  if total > p.budget then raise exception 'milestones total more than the tender budget'; end if;
  update procurements set status = 'awarded', award_bid_id = p_bid where id = p.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p.organization_id, auth.uid()::text, 'procurement.awarded', p.id::text, jsonb_build_object('bid', p_bid, 'milestones', i, 'total', total::text));
  return i;
end $$;

revoke all on function publish_seal_key(uuid, text, text), procurement_reviewer_keys(uuid), open_tender(uuid, timestamptz), submit_bid(uuid, text, text, text),
  close_bidding(uuid), procurement_bids(uuid), award_procurement(uuid, uuid, jsonb) from public;
grant execute on function publish_seal_key(uuid, text, text), procurement_reviewer_keys(uuid), open_tender(uuid, timestamptz), submit_bid(uuid, text, text, text),
  close_bidding(uuid), procurement_bids(uuid), award_procurement(uuid, uuid, jsonb) to authenticated;

-- ===== 0005_payroll.sql =====
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

-- ===== 0006_milestones.sql =====
-- Milestones: the awarded vendor submits sealed evidence (a QoreSeal envelope, like a bid), reviewers accept or reject it,
-- and an accepted milestone can open a payment request in the approvals flow. No QOR moves: payment execution is not wired.

drop policy milestones_sel on milestones;
create policy milestones_sel on milestones for select using (
  is_internal(organization_id)
  or exists (select 1 from procurements p join bids b on b.id = p.award_bid_id
             where parent_type = 'procurement' and p.id = milestones.parent_id and b.submitted_by = auth.uid())
  or exists (select 1 from grant_applications g where parent_type = 'grant' and g.grant_id = milestones.parent_id and g.applicant_user_id = auth.uid())
);

-- A vendor sets where they want to be paid. Every change is kept in vendor_address_history.
create function set_my_payout_address(p_org uuid, p_addr text) returns void language plpgsql security definer set search_path = public as $$
declare v uuid; me uuid := auth.uid(); old text;
begin
  if me is null or not has_role(p_org, array['vendor']::org_role[]) then raise exception 'not allowed: vendor role required'; end if;
  if p_addr !~ '^0x[0-9a-fA-F]{40}$' then raise exception 'payout address must be 0x followed by 40 hex characters'; end if;
  select id, payout_address into v, old from vendors where organization_id = p_org and user_id = me limit 1;
  if v is null then raise exception 'submit a bid first: you have no vendor record yet'; end if;
  if lower(coalesce(old, '')) = lower(p_addr) then return; end if;
  update vendors set payout_address = lower(p_addr) where id = v;
  insert into vendor_address_history(organization_id, vendor_id, payout_address) values (p_org, v, lower(p_addr));
  insert into audit_events(organization_id, actor, action, subject, detail) values (p_org, me::text, 'vendor.payout_address_set', v::text, jsonb_build_object('previous', old, 'new', lower(p_addr)));
end $$;

create function submit_milestone_evidence(p_ms uuid, p_envelope text, p_sha256 text) returns void language plpgsql security definer set search_path = public as $$
declare m milestones%rowtype; p procurements%rowtype; b bids%rowtype; me uuid := auth.uid(); d uuid; prev text;
begin
  select * into m from milestones where id = p_ms for update;
  if not found or me is null or m.parent_type <> 'procurement' then raise exception 'unknown milestone'; end if;
  select * into p from procurements where id = m.parent_id;
  select * into b from bids where id = p.award_bid_id;
  if not found or b.submitted_by <> me then raise exception 'only the awarded vendor can submit evidence'; end if;
  if m.status <> 'pending' then raise exception 'this milestone is %, not pending', m.status; end if;
  if m.idx > 1 then
    select status into prev from milestones where parent_type = 'procurement' and parent_id = m.parent_id and idx = m.idx - 1;
    if prev not in ('approved', 'released') then raise exception 'milestone % must be accepted first', m.idx - 1; end if;
  end if;
  if length(coalesce(p_envelope, '')) < 200 or length(p_envelope) > 400000 then raise exception 'the sealed evidence has an invalid size'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid checksum'; end if;
  insert into documents(organization_id, purpose, storage_path, ciphertext_sha256, envelope_bytes, uploaded_by, envelope)
  values (m.organization_id, 'evidence', 'db:envelope', p_sha256, length(p_envelope), me, p_envelope) returning id into d;
  update milestones set status = 'evidence_submitted', evidence_document_id = d where id = m.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (m.organization_id, me::text, 'milestone.evidence_submitted', m.id::text, jsonb_build_object('envelope_sha256', p_sha256));
end $$;

create function milestone_evidence(p_ms uuid) returns table(envelope text, envelope_sha256 text) language plpgsql stable security definer set search_path = public as $$
declare m milestones%rowtype;
begin
  select * into m from milestones where id = p_ms;
  if not found or auth.uid() is null or not has_role(m.organization_id, procurement_roles()) then raise exception 'not allowed: procurement role required'; end if;
  if m.evidence_document_id is null then raise exception 'no evidence has been submitted'; end if;
  return query select d.envelope, d.ciphertext_sha256 from documents d where d.id = m.evidence_document_id;
end $$;

create function decide_milestone(p_ms uuid, p_decision text, p_note text default null) returns text language plpgsql security definer set search_path = public as $$
declare m milestones%rowtype; me uuid := auth.uid(); new_status text;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'decision must be approve or reject'; end if;
  select * into m from milestones where id = p_ms for update;
  if not found or me is null or not has_role(m.organization_id, procurement_roles()) then raise exception 'not allowed: procurement role required'; end if;
  if m.status <> 'evidence_submitted' then raise exception 'this milestone is %, not awaiting review', m.status; end if;
  new_status := case p_decision when 'approve' then 'approved' else 'pending' end;
  update milestones set status = new_status, evidence_document_id = case when p_decision = 'reject' then null else evidence_document_id end,
    review = jsonb_build_object('decision', p_decision, 'by', me, 'at', now(), 'note', left(coalesce(p_note, ''), 500)) where id = m.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (m.organization_id, me::text, 'milestone.' || p_decision, m.id::text, jsonb_build_object('status', new_status));
  return new_status;
end $$;

-- An accepted milestone opens a payment request. The recipient must be the vendor's recorded payout address.
create function request_milestone_payment(p_ms uuid, p_hash text, p_required int, p_expires timestamptz, p_evaluation jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare m milestones%rowtype; p procurements%rowtype; b bids%rowtype; v vendors%rowtype; tx uuid; me uuid := auth.uid();
  zero constant text := '0x0000000000000000000000000000000000000000';
begin
  select * into m from milestones where id = p_ms for update;
  if not found or me is null or not has_role(m.organization_id, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if m.status <> 'approved' then raise exception 'the milestone must be accepted before payment is requested'; end if;
  select * into p from procurements where id = m.parent_id;
  select * into b from bids where id = p.award_bid_id;
  select * into v from vendors where id = b.vendor_id;
  if v.payout_address is null then raise exception 'the vendor has not set a payout address'; end if;
  if lower(coalesce(p_evaluation->'proposal'->>'to', '')) <> lower(v.payout_address) then raise exception 'the request does not pay the vendor''s recorded payout address'; end if;
  if coalesce(p_evaluation->'proposal'->>'amount', '') <> m.amount::text then raise exception 'the request amount does not match the milestone'; end if;
  if exists (select 1 from transactions t where t.organization_id = m.organization_id and t.evaluation->>'milestone_id' = m.id::text and t.state in ('AWAITING_APPROVAL', 'APPROVED'))
    then raise exception 'a payment request for this milestone already exists'; end if;
  tx := request_payment_approval(m.organization_id, 'milestone-' || gen_random_uuid(), 'PaymentAgent', p_hash, zero, lower(v.payout_address), m.amount, 1, p_expires, p_required,
          p_evaluation || jsonb_build_object('milestone_id', m.id, 'purpose', 'Milestone ' || m.idx || ': ' || m.title));
  insert into audit_events(organization_id, actor, action, subject, detail) values (m.organization_id, me::text, 'milestone.payment_requested', m.id::text, jsonb_build_object('transaction', tx));
  return tx;
end $$;

revoke all on function set_my_payout_address(uuid, text), submit_milestone_evidence(uuid, text, text), milestone_evidence(uuid), decide_milestone(uuid, text, text),
  request_milestone_payment(uuid, text, int, timestamptz, jsonb) from public;
grant execute on function set_my_payout_address(uuid, text), submit_milestone_evidence(uuid, text, text), milestone_evidence(uuid), decide_milestone(uuid, text, text),
  request_milestone_payment(uuid, text, int, timestamptz, jsonb) to authenticated;

-- Finance cannot read bids, so this is the controlled way to learn who a milestone pays.
create function milestone_payout_info(p_ms uuid) returns table(payout_address text, amount numeric, title text, idx int, vendor_name text, status text)
language plpgsql stable security definer set search_path = public as $$
declare m milestones%rowtype;
begin
  select * into m from milestones where id = p_ms;
  if not found or auth.uid() is null or not (has_role(m.organization_id, finance_roles()) or has_role(m.organization_id, procurement_roles())) then raise exception 'not allowed'; end if;
  return query select v.payout_address, m.amount, m.title, m.idx, v.name, m.status
    from procurements p join bids b on b.id = p.award_bid_id join vendors v on v.id = b.vendor_id where p.id = m.parent_id;
end $$;
revoke all on function milestone_payout_info(uuid) from public;
grant execute on function milestone_payout_info(uuid) to authenticated;

-- ===== 0007_governance.sql =====
-- Governance: application-level proposals and votes. These are NOT on-chain governance votes and nothing here executes anything.
-- Creating, opening, voting and finalising go only through the functions below; direct writes are removed.

alter table governance_proposals add column quorum int not null default 1 check (quorum between 1 and 1000);
alter table governance_proposals add column pass_pct int not null default 50 check (pass_pct between 50 and 99);
alter table governance_proposals add column voting_ends_at timestamptz;
alter table governance_proposals add column result jsonb;

drop policy governance_proposals_wr on governance_proposals;
-- Members who can vote must be able to read the proposals.
create policy governance_proposals_dao_sel on governance_proposals for select using (has_role(organization_id, array['dao_member']::org_role[]));
drop policy votes_ins on votes;

create function create_proposal(p_org uuid, p_title text, p_body text, p_quorum int, p_pass_pct int) returns uuid language plpgsql security definer set search_path = public as $$
declare id uuid; me uuid := auth.uid();
begin
  if me is null or not has_role(p_org, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  if length(trim(coalesce(p_title, ''))) not between 3 and 160 then raise exception 'title must be 3 to 160 characters'; end if;
  if length(trim(coalesce(p_body, ''))) not between 10 and 8000 then raise exception 'the proposal text must be 10 to 8000 characters'; end if;
  insert into governance_proposals(organization_id, title, body, kind, status, created_by, quorum, pass_pct)
  values (p_org, trim(p_title), trim(p_body), 'application_vote', 'discussion', me, p_quorum, p_pass_pct) returning governance_proposals.id into id;
  insert into audit_events(organization_id, actor, action, subject) values (p_org, me::text, 'governance.proposal_created', id::text);
  return id;
end $$;

create function save_proposal_analysis(p_id uuid, p_analysis jsonb) returns void language plpgsql security definer set search_path = public as $$
declare p governance_proposals%rowtype;
begin
  select * into p from governance_proposals where id = p_id for update;
  if not found or auth.uid() is null or not has_role(p.organization_id, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  if p.status not in ('discussion', 'voting') then raise exception 'the proposal is already %', p.status; end if;
  update governance_proposals set analysis = p_analysis where id = p.id;
  insert into audit_events(organization_id, actor, action, subject) values (p.organization_id, auth.uid()::text, 'governance.analysis_saved', p.id::text);
end $$;

create function open_voting(p_id uuid, p_hours int) returns void language plpgsql security definer set search_path = public as $$
declare p governance_proposals%rowtype;
begin
  select * into p from governance_proposals where id = p_id for update;
  if not found or auth.uid() is null or not has_role(p.organization_id, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  if p.status <> 'discussion' then raise exception 'voting can only open from discussion (it is %)', p.status; end if;
  if p_hours not between 1 and 720 then raise exception 'voting must last 1 to 720 hours'; end if;
  update governance_proposals set status = 'voting', voting_ends_at = now() + make_interval(hours => p_hours) where id = p.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p.organization_id, auth.uid()::text, 'governance.voting_opened', p.id::text, jsonb_build_object('hours', p_hours));
end $$;

create function cast_vote(p_id uuid, p_choice text) returns void language plpgsql security definer set search_path = public as $$
declare p governance_proposals%rowtype; me uuid := auth.uid();
begin
  if p_choice not in ('for', 'against', 'abstain') then raise exception 'choice must be for, against or abstain'; end if;
  select * into p from governance_proposals where id = p_id;
  if not found or me is null or not has_role(p.organization_id, array['dao_member', 'owner', 'administrator']::org_role[]) then raise exception 'not allowed: only DAO members, owners and administrators can vote'; end if;
  if p.status <> 'voting' or p.voting_ends_at <= now() then raise exception 'voting is not open for this proposal'; end if;
  begin
    insert into votes(organization_id, proposal_id, voter, choice) values (p.organization_id, p.id, me, p_choice);
  exception when unique_violation then raise exception 'you have already voted on this proposal';
  end;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p.organization_id, me::text, 'governance.vote_cast', p.id::text, jsonb_build_object('choice', p_choice));
end $$;

-- After the deadline anyone who can see the proposal may close it. Passes when quorum is met and 'for' is strictly above pass_pct of for+against.
create function finalize_proposal(p_id uuid) returns text language plpgsql security definer set search_path = public as $$
declare p governance_proposals%rowtype; f int; a int; ab int; total int; quorum_met boolean; passed boolean; new_status text;
begin
  select * into p from governance_proposals where id = p_id for update;
  if not found or auth.uid() is null or not (is_internal(p.organization_id) or has_role(p.organization_id, array['dao_member']::org_role[])) then raise exception 'not allowed'; end if;
  if p.status <> 'voting' then raise exception 'the proposal is %, not in voting', p.status; end if;
  if p.voting_ends_at > now() then raise exception 'voting is still open until %', p.voting_ends_at; end if;
  select count(*) filter (where choice = 'for'), count(*) filter (where choice = 'against'), count(*) filter (where choice = 'abstain') into f, a, ab from votes where proposal_id = p.id;
  total := f + a + ab;
  quorum_met := total >= p.quorum;
  passed := quorum_met and (f + a) > 0 and f * 100 > p.pass_pct * (f + a);
  new_status := case when passed then 'passed' else 'failed' end;
  update governance_proposals set status = new_status, result = jsonb_build_object('for', f, 'against', a, 'abstain', ab, 'quorum', p.quorum, 'quorum_met', quorum_met, 'pass_pct', p.pass_pct, 'at', now()) where id = p.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p.organization_id, auth.uid()::text, 'governance.finalized', p.id::text, jsonb_build_object('status', new_status, 'for', f, 'against', a, 'abstain', ab));
  return new_status;
end $$;

revoke all on function create_proposal(uuid, text, text, int, int), save_proposal_analysis(uuid, jsonb), open_voting(uuid, int), cast_vote(uuid, text), finalize_proposal(uuid) from public;
grant execute on function create_proposal(uuid, text, text, int, int), save_proposal_analysis(uuid, jsonb), open_voting(uuid, int), cast_vote(uuid, text), finalize_proposal(uuid) to authenticated;

-- ===== 0008_disputes.sql =====
-- Disputes over a milestone. Opening one freezes the milestone ('disputed'); an owner or administrator who did not open it
-- resolves it by sending the milestone back to accepted or back to waiting for evidence. No QOR moves and nothing on-chain is called.
-- Statements here are plain text, NOT encrypted. Use sealed evidence on the Milestones page for anything sensitive.

alter table disputes add column reason text;
alter table disputes add column previous_status text;
alter table disputes add column resolved_by uuid;
alter table disputes add column resolved_at timestamptz;

create table dispute_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  dispute_id uuid not null references disputes(id) on delete cascade,
  author uuid not null, author_role text not null, body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table dispute_notes enable row level security;
create policy dispute_notes_sel on dispute_notes for select using (
  is_internal(organization_id) or exists (select 1 from disputes d where d.id = dispute_id and d.opened_by = auth.uid())
);

drop policy disputes_ins on disputes;
drop policy disputes_upd on disputes;
drop policy evidence_ins on dispute_evidence;

create function open_dispute(p_ms uuid, p_reason text) returns uuid language plpgsql security definer set search_path = public as $$
declare m milestones%rowtype; p procurements%rowtype; b bids%rowtype; me uuid := auth.uid(); did uuid; r text;
begin
  select * into m from milestones where id = p_ms for update;
  if not found or me is null or m.parent_type <> 'procurement' then raise exception 'unknown milestone'; end if;
  select * into p from procurements where id = m.parent_id;
  select * into b from bids where id = p.award_bid_id;
  if b.submitted_by = me then r := 'vendor';
  elsif has_role(m.organization_id, procurement_roles()) then r := 'reviewer';
  else raise exception 'not allowed: only the awarded vendor or a procurement reviewer can open a dispute'; end if;
  if m.status not in ('pending', 'evidence_submitted', 'approved') then raise exception 'a % milestone cannot be disputed', m.status; end if;
  if length(trim(coalesce(p_reason, ''))) not between 10 and 2000 then raise exception 'explain the dispute in 10 to 2000 characters'; end if;
  insert into disputes(organization_id, milestone_id, opened_by, reason, previous_status) values (m.organization_id, m.id, me, trim(p_reason), m.status) returning disputes.id into did;
  insert into dispute_notes(organization_id, dispute_id, author, author_role, body) values (m.organization_id, did, me, r, trim(p_reason));
  update milestones set status = 'disputed' where id = m.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (m.organization_id, me::text, 'dispute.opened', did::text, jsonb_build_object('milestone', m.id, 'by', r));
  return did;
end $$;

create function add_dispute_note(p_id uuid, p_body text) returns void language plpgsql security definer set search_path = public as $$
declare d disputes%rowtype; me uuid := auth.uid(); r text;
begin
  select * into d from disputes where id = p_id;
  if not found or me is null then raise exception 'unknown dispute'; end if;
  if d.opened_by = me then r := 'opener';
  elsif has_role(d.organization_id, procurement_roles()) or has_role(d.organization_id, admin_roles()) then r := 'reviewer';
  else raise exception 'not allowed'; end if;
  if d.status = 'resolved' then raise exception 'this dispute is resolved'; end if;
  if length(trim(coalesce(p_body, ''))) not between 1 and 2000 then raise exception 'a statement must be 1 to 2000 characters'; end if;
  insert into dispute_notes(organization_id, dispute_id, author, author_role, body) values (d.organization_id, d.id, me, r, trim(p_body));
  insert into audit_events(organization_id, actor, action, subject) values (d.organization_id, me::text, 'dispute.note_added', d.id::text);
end $$;

create function save_dispute_summary(p_id uuid, p_summary jsonb) returns void language plpgsql security definer set search_path = public as $$
declare d disputes%rowtype;
begin
  select * into d from disputes where id = p_id for update;
  if not found or auth.uid() is null or not has_role(d.organization_id, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  if d.status = 'resolved' then raise exception 'this dispute is resolved'; end if;
  update disputes set summary = p_summary where id = d.id;
  insert into audit_events(organization_id, actor, action, subject) values (d.organization_id, auth.uid()::text, 'dispute.summary_saved', d.id::text);
end $$;

-- outcome 'accept_work': milestone becomes accepted (finance may then request payment through Approvals).
-- outcome 'reject_work': milestone goes back to waiting for new evidence. The resolver cannot be the person who opened the dispute.
create function resolve_dispute(p_id uuid, p_outcome text, p_note text) returns void language plpgsql security definer set search_path = public as $$
declare d disputes%rowtype; me uuid := auth.uid(); new_status text;
begin
  if p_outcome not in ('accept_work', 'reject_work') then raise exception 'outcome must be accept_work or reject_work'; end if;
  select * into d from disputes where id = p_id for update;
  if not found or me is null or not has_role(d.organization_id, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  if d.status = 'resolved' then raise exception 'this dispute is already resolved'; end if;
  if d.opened_by = me then raise exception 'you opened this dispute, so someone else must resolve it'; end if;
  if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'write a short reason for the decision'; end if;
  new_status := case p_outcome when 'accept_work' then 'approved' else 'pending' end;
  update milestones set status = new_status, evidence_document_id = case when p_outcome = 'reject_work' then null else evidence_document_id end where id = d.milestone_id and status = 'disputed';
  update disputes set status = 'resolved', resolved_by = me, resolved_at = now(),
    resolution = jsonb_build_object('outcome', p_outcome, 'note', left(trim(p_note), 1000), 'milestone_status', new_status, 'on_chain', false) where id = d.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (d.organization_id, me::text, 'dispute.resolved', d.id::text, jsonb_build_object('outcome', p_outcome));
end $$;

revoke all on function open_dispute(uuid, text), add_dispute_note(uuid, text), save_dispute_summary(uuid, jsonb), resolve_dispute(uuid, text, text) from public;
grant execute on function open_dispute(uuid, text), add_dispute_note(uuid, text), save_dispute_summary(uuid, jsonb), resolve_dispute(uuid, text, text) to authenticated;

-- ===== 0009_grants.sql =====
-- Grants: owners/administrators open a grant round, applicants apply, a reviewer recommends, a DIFFERENT administrator awards
-- with a milestone plan that adds up exactly to the request, and the total awarded can never pass the round's budget.
-- Applications are plain text (not encrypted). Milestone evidence and payment for grant milestones are NOT wired yet.

alter table grant_applications add column pitch text;
alter table grant_applications add column recommended_by uuid;
create unique index grant_applications_one_each on grant_applications(grant_id, applicant_user_id);

drop policy grants_wr on grants;
drop policy apps_ins on grant_applications;
drop policy apps_upd on grant_applications;
create policy grants_applicant_sel on grants for select using (status = 'open' and has_role(organization_id, array['grant_applicant']::org_role[]));

-- Grant milestones hang off the application (one award per application), not the round.
drop policy milestones_sel on milestones;
create policy milestones_sel on milestones for select using (
  is_internal(organization_id)
  or exists (select 1 from procurements p join bids b on b.id = p.award_bid_id
             where parent_type = 'procurement' and p.id = milestones.parent_id and b.submitted_by = auth.uid())
  or exists (select 1 from grant_applications g where parent_type = 'grant' and g.id = milestones.parent_id and g.applicant_user_id = auth.uid())
);

create function create_grant(p_org uuid, p_title text, p_budget numeric, p_token text) returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid; me uuid := auth.uid();
begin
  if me is null or not has_role(p_org, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  if length(trim(coalesce(p_title, ''))) not between 3 and 160 then raise exception 'title must be 3 to 160 characters'; end if;
  if p_budget is null or p_budget <= 0 or p_budget <> trunc(p_budget) then raise exception 'budget must be a positive whole number of base units'; end if;
  if p_token !~ '^0x[0-9a-fA-F]{40}$' then raise exception 'token must be an address (the zero address for native QOR)'; end if;
  insert into grants(organization_id, title, budget, token, status, created_by) values (p_org, trim(p_title), p_budget, lower(p_token), 'open', me) returning grants.id into gid;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p_org, me::text, 'grant.created', gid::text, jsonb_build_object('budget', p_budget::text));
  return gid;
end $$;

create function close_grant(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare g grants%rowtype;
begin
  select * into g from grants where id = p_id for update;
  if not found or auth.uid() is null or not has_role(g.organization_id, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  if g.status <> 'open' then raise exception 'the round is already %', g.status; end if;
  update grants set status = 'closed' where id = g.id;
  insert into audit_events(organization_id, actor, action, subject) values (g.organization_id, auth.uid()::text, 'grant.closed', g.id::text);
end $$;

create function apply_to_grant(p_grant uuid, p_name text, p_amount numeric, p_pitch text) returns uuid language plpgsql security definer set search_path = public as $$
declare g grants%rowtype; me uuid := auth.uid(); aid uuid;
begin
  select * into g from grants where id = p_grant;
  if not found or me is null or not has_role(g.organization_id, array['grant_applicant']::org_role[]) then raise exception 'not allowed: grant applicant role required'; end if;
  if g.status <> 'open' then raise exception 'this grant round is not open'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'name must be 1 to 120 characters'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) then raise exception 'the requested amount must be a positive whole number of base units'; end if;
  if p_amount > g.budget then raise exception 'you cannot request more than the whole round budget'; end if;
  if length(trim(coalesce(p_pitch, ''))) not between 20 and 6000 then raise exception 'the pitch must be 20 to 6000 characters'; end if;
  begin
    insert into grant_applications(organization_id, grant_id, applicant_user_id, applicant_name, requested_amount, pitch)
    values (g.organization_id, g.id, me, trim(p_name), p_amount, trim(p_pitch)) returning grant_applications.id into aid;
  exception when unique_violation then raise exception 'you have already applied to this round';
  end;
  insert into audit_events(organization_id, actor, action, subject, detail) values (g.organization_id, me::text, 'grant.applied', aid::text, jsonb_build_object('grant', g.id, 'requested', p_amount::text));
  return aid;
end $$;

create function save_application_review(p_app uuid, p_ai jsonb) returns void language plpgsql security definer set search_path = public as $$
declare a grant_applications%rowtype;
begin
  select * into a from grant_applications where id = p_app for update;
  if not found or auth.uid() is null or not has_role(a.organization_id, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  if a.status not in ('submitted', 'under_review', 'recommended') then raise exception 'the application is already %', a.status; end if;
  update grant_applications set review = coalesce(review, '{}'::jsonb) || jsonb_build_object('ai', p_ai), status = case when status = 'submitted' then 'under_review' else status end where id = a.id;
  insert into audit_events(organization_id, actor, action, subject) values (a.organization_id, auth.uid()::text, 'grant.ai_review_saved', a.id::text);
end $$;

create function decide_application(p_app uuid, p_decision text, p_note text) returns text language plpgsql security definer set search_path = public as $$
declare a grant_applications%rowtype; me uuid := auth.uid(); s text;
begin
  if p_decision not in ('recommend', 'reject') then raise exception 'decision must be recommend or reject'; end if;
  select * into a from grant_applications where id = p_app for update;
  if not found or me is null or not has_role(a.organization_id, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  if a.status not in ('submitted', 'under_review') then raise exception 'the application is %, not awaiting a decision', a.status; end if;
  if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'write a short reason'; end if;
  s := case p_decision when 'recommend' then 'recommended' else 'rejected' end;
  update grant_applications set status = s, recommended_by = case when p_decision = 'recommend' then me else null end,
    review = coalesce(review, '{}'::jsonb) || jsonb_build_object('decision', p_decision, 'by', me, 'at', now(), 'note', left(trim(p_note), 500)) where id = a.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (a.organization_id, me::text, 'grant.' || p_decision, a.id::text, jsonb_build_object('status', s));
  return s;
end $$;

-- The awarding administrator must not be the one who recommended. Milestones must add up exactly to the request,
-- and the sum of everything awarded in the round (including this) must stay within the round budget.
create function award_application(p_app uuid, p_milestones jsonb) returns int language plpgsql security definer set search_path = public as $$
declare a grant_applications%rowtype; g grants%rowtype; me uuid := auth.uid(); m jsonb; i int := 0; total numeric := 0; amt numeric; awarded numeric;
begin
  select * into a from grant_applications where id = p_app for update;
  if not found or me is null or not has_role(a.organization_id, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  select * into g from grants where id = a.grant_id for update;
  if a.status <> 'recommended' then raise exception 'only a recommended application can be awarded (it is %)', a.status; end if;
  if a.recommended_by = me then raise exception 'you recommended this application, so a different administrator must award it'; end if;
  if g.status <> 'open' then raise exception 'this grant round is not open'; end if;
  if jsonb_typeof(p_milestones) <> 'array' or jsonb_array_length(p_milestones) not between 1 and 10 then raise exception 'provide 1 to 10 milestones'; end if;
  for m in select * from jsonb_array_elements(p_milestones) loop
    if length(trim(coalesce(m->>'title', ''))) not between 1 and 120 then raise exception 'each milestone needs a title of 1 to 120 characters'; end if;
    if coalesce(m->>'amount', '') !~ '^[0-9]{1,40}$' then raise exception 'each milestone amount must be a whole number of base units'; end if;
    amt := (m->>'amount')::numeric;
    if amt <= 0 then raise exception 'milestone amounts must be positive'; end if;
    total := total + amt; i := i + 1;
    insert into milestones(organization_id, parent_type, parent_id, idx, title, amount) values (a.organization_id, 'grant', a.id, i, trim(m->>'title'), amt);
  end loop;
  if total <> a.requested_amount then raise exception 'milestones must add up exactly to the requested amount'; end if;
  select coalesce(sum(requested_amount), 0) into awarded from grant_applications where grant_id = g.id and status = 'awarded';
  if awarded + total > g.budget then raise exception 'awarding this would pass the round budget'; end if;
  update grant_applications set status = 'awarded' where id = a.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (a.organization_id, me::text, 'grant.awarded', a.id::text, jsonb_build_object('milestones', i, 'total', total::text));
  return i;
end $$;

revoke all on function create_grant(uuid, text, numeric, text), close_grant(uuid), apply_to_grant(uuid, text, numeric, text), save_application_review(uuid, jsonb),
  decide_application(uuid, text, text), award_application(uuid, jsonb) from public;
grant execute on function create_grant(uuid, text, numeric, text), close_grant(uuid), apply_to_grant(uuid, text, numeric, text), save_application_review(uuid, jsonb),
  decide_application(uuid, text, text), award_application(uuid, jsonb) to authenticated;

-- ===== 0010_revenue.sql =====
-- Revenue: money owed TO the organisation. Finance records what customers owe and later records which on-chain transaction paid it.
-- The database only stores the claim. Whether that transaction really paid the treasury is re-checked live against the chain on the page
-- (VERIFIED / NOT VERIFIED), never taken on trust. "Overdue" is computed from the due date when read, not stored.

alter table revenue_records add column description text;
alter table revenue_records add column created_by uuid;
alter table revenue_records add column marked_by uuid;
alter table revenue_records add column paid_at timestamptz;
alter table revenue_records add column void_reason text;
create unique index revenue_one_payment_per_tx on revenue_records(organization_id, matched_tx_hash) where matched_tx_hash is not null;

drop policy revenue_records_wr on revenue_records;

create function create_revenue_record(p_org uuid, p_customer text, p_reference text, p_amount numeric, p_due date, p_description text) returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid; me uuid := auth.uid();
begin
  if me is null or not has_role(p_org, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if length(trim(coalesce(p_customer, ''))) not between 1 and 160 then raise exception 'customer must be 1 to 160 characters'; end if;
  if length(trim(coalesce(p_reference, ''))) not between 1 and 80 then raise exception 'reference must be 1 to 80 characters'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) then raise exception 'amount must be a positive whole number of base units'; end if;
  if p_due is null then raise exception 'a due date is required'; end if;
  if length(coalesce(p_description, '')) > 500 then raise exception 'description is limited to 500 characters'; end if;
  begin
    insert into revenue_records(organization_id, customer, reference, amount, token, due_date, description, created_by)
    values (p_org, trim(p_customer), trim(p_reference), p_amount, '0x0000000000000000000000000000000000000000', p_due, nullif(trim(coalesce(p_description, '')), ''), me) returning revenue_records.id into rid;
  exception when unique_violation then raise exception 'reference % already exists', trim(p_reference);
  end;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p_org, me::text, 'revenue.recorded', rid::text, jsonb_build_object('amount', p_amount::text, 'due', p_due));
  return rid;
end $$;

-- Records the claim that a transaction paid this record. One transaction can pay only one record.
create function mark_revenue_paid(p_id uuid, p_tx text) returns void language plpgsql security definer set search_path = public as $$
declare r revenue_records%rowtype; me uuid := auth.uid();
begin
  select * into r from revenue_records where id = p_id for update;
  if not found or me is null or not has_role(r.organization_id, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if r.status not in ('issued', 'overdue') then raise exception 'this record is %', r.status; end if;
  if lower(coalesce(p_tx, '')) !~ '^0x[0-9a-f]{64}$' then raise exception 'a transaction hash is 0x followed by 64 hex characters'; end if;
  begin
    update revenue_records set status = 'paid', matched_tx_hash = lower(p_tx), marked_by = me, paid_at = now() where id = r.id;
  exception when unique_violation then raise exception 'that transaction is already recorded against another record';
  end;
  insert into audit_events(organization_id, actor, action, subject, detail) values (r.organization_id, me::text, 'revenue.marked_paid', r.id::text, jsonb_build_object('tx', lower(p_tx)));
end $$;

create function void_revenue_record(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare r revenue_records%rowtype; me uuid := auth.uid();
begin
  select * into r from revenue_records where id = p_id for update;
  if not found or me is null or not has_role(r.organization_id, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if r.status not in ('issued', 'overdue') then raise exception 'this record is %', r.status; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'write a short reason'; end if;
  update revenue_records set status = 'void', void_reason = left(trim(p_reason), 300) where id = r.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (r.organization_id, me::text, 'revenue.voided', r.id::text, jsonb_build_object('reason', left(trim(p_reason), 300)));
end $$;

revoke all on function create_revenue_record(uuid, text, text, numeric, date, text), mark_revenue_paid(uuid, text), void_revenue_record(uuid, text) from public;
grant execute on function create_revenue_record(uuid, text, text, numeric, date, text), mark_revenue_paid(uuid, text), void_revenue_record(uuid, text) to authenticated;

-- ===== 0011_vault.sql =====
-- Document Vault: documents sealed in the uploader's browser (QoreSeal, ML-KEM-1024 + X25519, AES-GCM) to chosen organisation members.
-- The database stores ciphertext only. document_access decides who is shown a document; the encryption decides who can read it.
-- Adding a reader later means uploading a new sealed copy: the server cannot re-seal because it never sees the plaintext.
-- Anchoring a document's checksum on-chain is NOT implemented.

alter table documents add column title text;

drop policy docs_ins on documents;
drop policy docacc_ins on document_access;

-- Any internal member (not only procurement roles) may publish their public reading key. Same key table and same key as procurement.
create function publish_my_seal_key(p_org uuid, p_mlkem text, p_x25519 text) returns void language plpgsql security definer set search_path = public as $$
declare k org_seal_keys%rowtype;
begin
  if auth.uid() is null or not is_internal(p_org) then raise exception 'not allowed: organisation members only'; end if;
  if length(coalesce(p_mlkem, '')) <> 3136 or p_mlkem !~ '^[0-9a-fA-F]+$' or p_x25519 !~ '^[0-9a-fA-F]{64}$' then raise exception 'invalid public key'; end if;
  select * into k from org_seal_keys where organization_id = p_org and user_id = auth.uid();
  if found then
    if k.mlkem_public = lower(p_mlkem) and k.x25519_public = lower(p_x25519) then return; end if;
    raise exception 'you already published a reading key; it cannot be replaced';
  end if;
  insert into org_seal_keys(organization_id, user_id, mlkem_public, x25519_public) values (p_org, auth.uid(), lower(p_mlkem), lower(p_x25519));
  insert into audit_events(organization_id, actor, action) values (p_org, auth.uid()::text, 'vault.seal_key_published');
end $$;

-- Members who can be chosen as readers: active internal members who have published a key.
create function vault_recipients(p_org uuid) returns table(user_id uuid, role org_role, mlkem_public text, x25519_public text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_internal(p_org) then raise exception 'not allowed: organisation members only'; end if;
  return query
    select k.user_id, m.role, k.mlkem_public, k.x25519_public from org_seal_keys k
    join memberships m on m.organization_id = k.organization_id and m.user_id = k.user_id and m.status = 'active'
    where k.organization_id = p_org and is_internal(p_org) and m.role not in ('vendor', 'grant_applicant')
    order by k.created_at;
end $$;

-- The id is chosen by the browser because it is bound into the encryption (purpose vault:<id>).
create function upload_vault_document(p_org uuid, p_id uuid, p_title text, p_envelope text, p_sha256 text, p_recipients uuid[]) returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r uuid;
begin
  if me is null or not is_internal(p_org) then raise exception 'not allowed: organisation members only'; end if;
  if length(trim(coalesce(p_title, ''))) not between 1 and 160 then raise exception 'title must be 1 to 160 characters'; end if;
  if length(coalesce(p_envelope, '')) < 200 or length(p_envelope) > 4000000 then raise exception 'the sealed document has an invalid size'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid checksum'; end if;
  if p_recipients is null or array_length(p_recipients, 1) is null or array_length(p_recipients, 1) > 50 then raise exception 'choose 1 to 50 readers'; end if;
  if not (me = any(p_recipients)) then raise exception 'you must be one of the readers, or you could never open it again'; end if;
  foreach r in array p_recipients loop
    if not exists (select 1 from org_seal_keys k join memberships m on m.organization_id = k.organization_id and m.user_id = k.user_id and m.status = 'active'
                   where k.organization_id = p_org and k.user_id = r and m.role not in ('vendor', 'grant_applicant'))
      then raise exception 'every reader must be an active member who has published a reading key'; end if;
  end loop;
  insert into documents(id, organization_id, purpose, storage_path, ciphertext_sha256, envelope_bytes, uploaded_by, envelope, title, recipients)
  values (p_id, p_org, 'vault', 'db:envelope', p_sha256, length(p_envelope), me, p_envelope, trim(p_title), to_jsonb(p_recipients));
  insert into document_access(organization_id, document_id, user_id, granted_by) select p_org, p_id, x, me from (select distinct unnest(p_recipients) as x) s;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p_org, me::text, 'vault.uploaded', p_id::text, jsonb_build_object('readers', array_length(p_recipients, 1), 'sha256', p_sha256));
end $$;

create function vault_document_envelope(p_id uuid) returns table(envelope text, envelope_sha256 text) language plpgsql security definer set search_path = public as $$
declare d documents%rowtype;
begin
  select * into d from documents where id = p_id and purpose = 'vault';
  if not found or auth.uid() is null or not exists (select 1 from document_access a where a.document_id = d.id and a.user_id = auth.uid())
    then raise exception 'not allowed: you are not a reader of this document'; end if;
  insert into audit_events(organization_id, actor, action, subject) values (d.organization_id, auth.uid()::text, 'vault.fetched', d.id::text);
  return query select d.envelope, d.ciphertext_sha256;
end $$;

-- The uploader or an owner/administrator may delete. Deleting removes the ciphertext; copies anyone already downloaded are unaffected.
create function delete_vault_document(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare d documents%rowtype; me uuid := auth.uid();
begin
  select * into d from documents where id = p_id and purpose = 'vault' for update;
  if not found or me is null or not (d.uploaded_by = me or has_role(d.organization_id, admin_roles())) then raise exception 'not allowed'; end if;
  delete from documents where id = d.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (d.organization_id, me::text, 'vault.deleted', d.id::text, jsonb_build_object('title', d.title));
end $$;

revoke all on function publish_my_seal_key(uuid, text, text), vault_recipients(uuid), upload_vault_document(uuid, uuid, text, text, text, uuid[]), vault_document_envelope(uuid), delete_vault_document(uuid) from public;
grant execute on function publish_my_seal_key(uuid, text, text), vault_recipients(uuid), upload_vault_document(uuid, uuid, text, text, text, uuid[]), vault_document_envelope(uuid), delete_vault_document(uuid) to authenticated;

-- ===== 0012_activity.sql =====
-- Activity: every member can read the audit events they caused themselves (the existing policy lets only owners, administrators,
-- security reviewers and auditors read all of them). Nobody gains write access: audit_events stays append-only.

create policy audit_own on audit_events for select using (actor = auth.uid()::text and is_member(organization_id));

-- ===== 0013_strategies.sql =====
-- Strategies: saved simulation inputs (DCA, rebalancing, arbitrage). Always SIMULATION and always paused: there is no venue, so nothing
-- is ever executed. A saved strategy is only the numbers someone typed in. Direct writes are removed; the mode cannot be changed.

drop policy strategies_wr on strategies;

create function save_strategy(p_org uuid, p_kind text, p_config jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; me uuid := auth.uid();
begin
  if me is null or not has_role(p_org, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if p_kind not in ('dca', 'rebalance', 'arbitrage') then raise exception 'kind must be dca, rebalance or arbitrage'; end if;
  if jsonb_typeof(p_config) <> 'object' or length(p_config::text) > 8000 then raise exception 'invalid configuration'; end if;
  if length(trim(coalesce(p_config->>'name', ''))) not between 1 and 80 then raise exception 'a name of 1 to 80 characters is required'; end if;
  insert into strategies(organization_id, kind, config, mode, status, created_by) values (p_org, p_kind, p_config, 'SIMULATION', 'paused', me) returning strategies.id into sid;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p_org, me::text, 'strategy.saved', sid::text, jsonb_build_object('kind', p_kind, 'mode', 'SIMULATION'));
  return sid;
end $$;

create function cancel_strategy(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare s strategies%rowtype; me uuid := auth.uid();
begin
  select * into s from strategies where id = p_id for update;
  if not found or me is null or not has_role(s.organization_id, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if s.status = 'cancelled' then raise exception 'already cancelled'; end if;
  update strategies set status = 'cancelled' where id = s.id;
  insert into audit_events(organization_id, actor, action, subject) values (s.organization_id, me::text, 'strategy.cancelled', s.id::text);
end $$;

revoke all on function save_strategy(uuid, text, jsonb), cancel_strategy(uuid) from public;
grant execute on function save_strategy(uuid, text, jsonb), cancel_strategy(uuid) to authenticated;
