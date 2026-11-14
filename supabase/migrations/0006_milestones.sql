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
