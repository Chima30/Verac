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
