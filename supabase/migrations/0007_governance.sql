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
