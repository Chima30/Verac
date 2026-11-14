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
