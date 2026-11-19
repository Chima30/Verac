-- Grants, phase 6: milestone evidence, review, and funding records. Safe to re-run.
--
-- * The applicant of an awarded application submits evidence for its next milestone (a description, links, transaction
--   hashes). Each submission is kept; a rejected milestone goes back to pending and can be resubmitted.
-- * Agents may check the submitted links (grant_evidence rows with milestone_id). They never approve.
-- * An owner or administrator approves or rejects the milestone with a reason. A declared conflict blocks it.
-- * Funding is recorded in grant_funding_records. A payment request goes through the existing live-payment pipeline when
--   the treasury's real limits allow it; otherwise the record says "awaiting an authorised funding path" with the reasons.
--   Large awards are never split to fit an agent's cap.
-- * A milestone becomes 'released' only when its linked payment is CONFIRMED on chain (trigger), with the transaction hash.

alter table grant_evidence add column if not exists milestone_id uuid references milestones(id) on delete cascade;
create index if not exists grant_evidence_ms_idx on grant_evidence(milestone_id) where milestone_id is not null;

create table if not exists grant_milestone_submissions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  milestone_id uuid not null references milestones(id) on delete cascade,
  application_id uuid not null references grant_applications(id) on delete cascade,
  attempt int not null,
  description text not null check (length(description) between 20 and 6000),
  links jsonb not null default '[]',
  transactions jsonb not null default '[]',
  submitted_by uuid not null,
  created_at timestamptz not null default now(),
  unique (milestone_id, attempt)
);
alter table grant_milestone_submissions enable row level security;
drop policy if exists grant_ms_sub_read on grant_milestone_submissions;
create policy grant_ms_sub_read on grant_milestone_submissions for select using (
  has_role(organization_id, admin_roles()) or has_role(organization_id, finance_roles()) or has_role(organization_id, security_roles())
  or exists (select 1 from grant_applications a where a.id = application_id and a.applicant_user_id = auth.uid())
);

create table if not exists grant_funding_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references grant_applications(id) on delete cascade,
  milestone_id uuid references milestones(id) on delete cascade,
  amount numeric(78,0) not null check (amount > 0),
  status text not null check (status in ('awaiting_authorised_path', 'requested', 'confirmed', 'failed', 'cancelled')),
  route text not null check (route in ('treasury_v2', 'treasury_v1', 'none')),
  reasons jsonb not null default '[]',
  transaction_id uuid references transactions(id) on delete set null,
  tx_hash text, block_number bigint,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists grant_funding_app_idx on grant_funding_records(application_id, created_at desc);
alter table grant_funding_records enable row level security;
drop policy if exists grant_funding_read on grant_funding_records;
create policy grant_funding_read on grant_funding_records for select using (
  has_role(organization_id, admin_roles()) or has_role(organization_id, finance_roles()) or has_role(organization_id, security_roles())
  or exists (select 1 from grant_applications a where a.id = application_id and a.applicant_user_id = auth.uid())
);

-- ------------------------------------------------------------------ evidence from the applicant
create or replace function submit_grant_milestone_evidence(p_ms uuid, p_description text, p_links jsonb, p_txs jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare m milestones%rowtype; a grant_applications%rowtype; me uuid := auth.uid(); prev text; n int; x text;
begin
  select * into m from milestones where id = p_ms for update;
  if not found or m.parent_type <> 'grant' then raise exception 'unknown grant milestone'; end if;
  select * into a from grant_applications where id = m.parent_id;
  if me is null or a.applicant_user_id <> me then raise exception 'only the grant recipient can submit evidence'; end if;
  if a.status <> 'awarded' then raise exception 'the application is not awarded'; end if;
  if m.status <> 'pending' then raise exception 'this milestone is %, not waiting for evidence', m.status; end if;
  if m.idx > 1 then
    select status into prev from milestones where parent_type = 'grant' and parent_id = m.parent_id and idx = m.idx - 1;
    if prev not in ('approved', 'released') then raise exception 'milestone % must be approved first', m.idx - 1; end if;
  end if;
  if length(trim(coalesce(p_description, ''))) not between 20 and 6000 then raise exception 'describe what was delivered (20 to 6000 characters)'; end if;
  if jsonb_typeof(coalesce(p_links, '[]')) <> 'array' or jsonb_array_length(coalesce(p_links, '[]')) > 10 then raise exception 'at most 10 links'; end if;
  for x in select * from jsonb_array_elements_text(coalesce(p_links, '[]')) loop
    if x !~ '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[^[:space:]]*)?$' or length(x) > 400 then raise exception 'links must be https:// URLs'; end if;
  end loop;
  if jsonb_typeof(coalesce(p_txs, '[]')) <> 'array' or jsonb_array_length(coalesce(p_txs, '[]')) > 10
     or exists (select 1 from jsonb_array_elements_text(coalesce(p_txs, '[]')) y where y !~ '^(0x)?[0-9a-fA-F]{64}$') then raise exception 'transaction hashes must be 32-byte hex (at most 10)'; end if;
  select coalesce(max(attempt), 0) + 1 into n from grant_milestone_submissions where milestone_id = m.id;
  insert into grant_milestone_submissions(organization_id, milestone_id, application_id, attempt, description, links, transactions, submitted_by)
  values (m.organization_id, m.id, a.id, n, trim(p_description), coalesce(p_links, '[]'), coalesce(p_txs, '[]'), me);
  update milestones set status = 'evidence_submitted' where id = m.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (m.organization_id, me::text, 'grant.milestone_evidence_submitted', m.id::text, jsonb_build_object('attempt', n, 'application', a.id));
  return n;
end $$;

-- ------------------------------------------------------------------ the human decision
create or replace function decide_grant_milestone(p_ms uuid, p_decision text, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare m milestones%rowtype; a grant_applications%rowtype; me uuid := auth.uid(); s text;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'decision must be approve or reject'; end if;
  select * into m from milestones where id = p_ms for update;
  if not found or m.parent_type <> 'grant' then raise exception 'unknown grant milestone'; end if;
  if me is null or not has_role(m.organization_id, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  select * into a from grant_applications where id = m.parent_id;
  if grant_has_conflict(a.id, me) then raise exception 'you declared a conflict of interest on this application'; end if;
  if a.applicant_user_id = me then raise exception 'you cannot approve your own milestone'; end if;
  if m.status <> 'evidence_submitted' then raise exception 'this milestone is %, not awaiting review', m.status; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'give a reason (at least 5 characters)'; end if;
  s := case p_decision when 'approve' then 'approved' else 'pending' end;
  update milestones set status = s, review = jsonb_build_object('decision', p_decision, 'by', me, 'at', now(), 'note', left(trim(p_reason), 500)) where id = m.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (m.organization_id, me::text, 'grant.milestone_' || p_decision, m.id::text, jsonb_build_object('reason', left(trim(p_reason), 200), 'application', a.id));
  return s;
end $$;

-- ------------------------------------------------------------------ funding records (written by the server after it checked the treasury)
create or replace function record_grant_funding(p_ms uuid, p_status text, p_route text, p_reasons jsonb, p_transaction uuid, p_by uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare m milestones%rowtype; r uuid;
begin
  select * into m from milestones where id = p_ms for update;
  if not found or m.parent_type <> 'grant' then raise exception 'unknown grant milestone'; end if;
  if m.status <> 'approved' then raise exception 'only an approved milestone can be funded'; end if;
  if p_status not in ('awaiting_authorised_path', 'requested') then raise exception 'unsupported status'; end if;
  if exists (select 1 from grant_funding_records where milestone_id = m.id and status in ('requested', 'confirmed')) then raise exception 'a payment for this milestone is already requested or confirmed'; end if;
  insert into grant_funding_records(organization_id, application_id, milestone_id, amount, status, route, reasons, transaction_id, created_by)
  values (m.organization_id, m.parent_id, m.id, m.amount, p_status, p_route, coalesce(p_reasons, '[]'), p_transaction, p_by) returning id into r;
  insert into audit_events(organization_id, actor, action, subject, detail) values (m.organization_id, p_by::text, 'grant.funding_' || p_status, m.id::text, jsonb_build_object('route', p_route, 'reasons', p_reasons, 'transaction', p_transaction));
  return r;
end $$;

-- A grant milestone is released only when its payment is confirmed on chain.
create or replace function grant_follow_payment() returns trigger language plpgsql security definer set search_path = public as $$
declare f grant_funding_records%rowtype;
begin
  if new.state is distinct from old.state and new.state in ('CONFIRMED', 'FAILED', 'REJECTED', 'CANCELLED') then
    for f in select * from grant_funding_records where transaction_id = new.id and status = 'requested' loop
      if new.state = 'CONFIRMED' then
        update grant_funding_records set status = 'confirmed', tx_hash = new.tx_hash, block_number = new.block_number, updated_at = now() where id = f.id;
        update milestones set status = 'released', release_tx_hash = new.tx_hash where id = f.milestone_id and status = 'approved';
        insert into audit_events(organization_id, actor, action, subject, detail) values (f.organization_id, 'chain', 'grant.milestone_released', f.milestone_id::text, jsonb_build_object('tx_hash', new.tx_hash, 'block', new.block_number));
      else
        update grant_funding_records set status = case when new.state = 'FAILED' then 'failed' else 'cancelled' end, updated_at = now() where id = f.id;
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists grant_follow_payment on transactions;
create trigger grant_follow_payment after update of state on transactions for each row execute function grant_follow_payment();

do $$ declare f text; begin
  foreach f in array array['submit_grant_milestone_evidence(uuid, text, jsonb, jsonb)', 'decide_grant_milestone(uuid, text, text)'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
  end loop;
  execute 'revoke all on function record_grant_funding(uuid, text, text, jsonb, uuid, uuid) from public';
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function record_grant_funding(uuid, text, text, jsonb, uuid, uuid) from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function record_grant_funding(uuid, text, text, jsonb, uuid, uuid) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function record_grant_funding(uuid, text, text, jsonb, uuid, uuid) to service_role'; end if;
end $$;
