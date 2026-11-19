-- Grants, phase 2: richer rounds, versioned rubrics, structured applications with drafts and version history.
-- Extends 0001/0009; the existing functions keep working. Safe to re-run.
--
-- * A round has a description, requirements, project categories, a deadline and an optional per-application maximum.
-- * A rubric is versioned per round. It can be edited until the round's first evaluation locks it; after that a change
--   creates a NEW version, so earlier evaluations keep the criteria they were scored against.
-- * An application is a draft until the applicant submits it. Submission is validated here (sections, budget lines and
--   milestones that add up exactly to the request, recipient address, declarations). Every submitted state is kept in
--   grant_application_versions. After submission the applicant can change it only when a reviewer opens an amendment
--   (a clarification request, phase 4), and each amendment is a new version.

-- ------------------------------------------------------------------ rounds
alter table grants
  add column if not exists description text,
  add column if not exists requirements text,
  add column if not exists categories text[] not null default array['software','research','education','community','other'],
  add column if not exists deadline timestamptz,
  add column if not exists max_request numeric(78,0),
  add column if not exists rules jsonb not null default '{}';

-- ------------------------------------------------------------------ rubrics (versioned)
create table if not exists grant_rubrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  grant_id uuid not null references grants(id) on delete cascade,
  version int not null,
  criteria jsonb not null,
  locked_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (grant_id, version)
);
alter table grant_rubrics enable row level security;
drop policy if exists grant_rubrics_read on grant_rubrics;
-- Rubrics are published criteria: administrators and the round's applicants may read them.
create policy grant_rubrics_read on grant_rubrics for select using (
  has_role(organization_id, admin_roles()) or has_role(organization_id, array['grant_applicant']::org_role[]) or has_role(organization_id, security_roles())
);

create or replace function default_grant_rubric() returns jsonb language sql immutable as $$
  select '[
    {"key":"relevance","label":"Project relevance","max":20,"guidance":"Fit with the round''s stated purpose and requirements."},
    {"key":"technical","label":"Technical implementation","max":20,"applies_to":["software"],"guidance":"Verified state of the implementation: code, documentation, tests, deployments."},
    {"key":"approach","label":"Method or approach","max":20,"applies_to":["research","education","community","other"],"guidance":"Soundness of the method, curriculum or programme design."},
    {"key":"feasibility","label":"Feasibility","max":15,"guidance":"Can this team deliver this scope in this time with this budget?"},
    {"key":"milestones","label":"Milestone quality","max":15,"guidance":"Deliverables are specific, dated, and verifiable by a reviewer."},
    {"key":"budget","label":"Budget justification","max":10,"guidance":"Each budget line is explained and proportionate."},
    {"key":"impact","label":"Expected impact","max":10,"guidance":"Concrete outcomes and success metrics."},
    {"key":"capability","label":"Execution capability","max":10,"guidance":"Relevant, evidenced experience. Not follower counts or stars."}
  ]'::jsonb
$$;

-- Validates a rubric: 1 to 12 criteria with unique snake_case keys, integer maxima 1..100, known categories.
create or replace function grant_rubric_valid(p jsonb) returns boolean language plpgsql immutable as $$
declare c jsonb; keys text[] := '{}'; k text;
begin
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) not between 1 and 12 then return false; end if;
  for c in select * from jsonb_array_elements(p) loop
    k := c->>'key';
    if k is null or k !~ '^[a-z][a-z0-9_]{1,31}$' or k = any(keys) then return false; end if;
    keys := keys || k;
    if length(coalesce(c->>'label', '')) not between 2 and 80 then return false; end if;
    if coalesce(c->>'max', '') !~ '^[0-9]{1,3}$' or (c->>'max')::int not between 1 and 100 then return false; end if;
    if c ? 'applies_to' and (jsonb_typeof(c->'applies_to') <> 'array' or exists (
      select 1 from jsonb_array_elements_text(c->'applies_to') x where x not in ('software','research','education','community','other'))) then return false; end if;
  end loop;
  return true;
end $$;

-- Creates a round with its first rubric (the default unless one is given).
create or replace function create_grant_round(p_org uuid, p_title text, p_budget numeric, p_description text, p_requirements text,
  p_categories text[], p_deadline timestamptz, p_max_request numeric, p_rubric jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare gid uuid; me uuid := auth.uid(); r jsonb := coalesce(p_rubric, default_grant_rubric());
begin
  gid := create_grant(p_org, p_title, p_budget, '0x0000000000000000000000000000000000000000');
  if length(coalesce(p_description, '')) > 4000 or length(coalesce(p_requirements, '')) > 4000 then raise exception 'description and requirements are limited to 4000 characters'; end if;
  if p_categories is null or cardinality(p_categories) = 0 or exists (select 1 from unnest(p_categories) c where c not in ('software','research','education','community','other')) then
    raise exception 'categories must be chosen from software, research, education, community, other';
  end if;
  if p_deadline is not null and p_deadline <= now() then raise exception 'the deadline must be in the future'; end if;
  if p_max_request is not null and (p_max_request <= 0 or p_max_request > p_budget or p_max_request <> trunc(p_max_request)) then raise exception 'the maximum request must be a positive whole amount within the budget'; end if;
  if not grant_rubric_valid(r) then raise exception 'the rubric is not valid'; end if;
  update grants set description = nullif(trim(p_description), ''), requirements = nullif(trim(p_requirements), ''), categories = p_categories,
    deadline = p_deadline, max_request = p_max_request where id = gid;
  insert into grant_rubrics(organization_id, grant_id, version, criteria, created_by) values (p_org, gid, 1, r, me);
  return gid;
end $$;

-- Edits the current rubric while it is unlocked; once locked (first evaluation), writes a new version instead.
create or replace function set_grant_rubric(p_grant uuid, p_criteria jsonb, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare g grants%rowtype; cur grant_rubrics%rowtype; me uuid := auth.uid(); v int;
begin
  select * into g from grants where id = p_grant for update;
  if not found or me is null or not has_role(g.organization_id, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  if not grant_rubric_valid(p_criteria) then raise exception 'the rubric is not valid: 1 to 12 criteria, unique snake_case keys, maximum points 1 to 100'; end if;
  select * into cur from grant_rubrics where grant_id = g.id order by version desc limit 1;
  if found and cur.locked_at is null then
    update grant_rubrics set criteria = p_criteria where id = cur.id; v := cur.version;
  else
    if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'the rubric is locked by an evaluation: give a reason for the new version'; end if;
    v := coalesce(cur.version, 0) + 1;
    insert into grant_rubrics(organization_id, grant_id, version, criteria, created_by) values (g.organization_id, g.id, v, p_criteria, me);
  end if;
  insert into audit_events(organization_id, actor, action, subject, detail)
  values (g.organization_id, me::text, 'grant.rubric_set', g.id::text, jsonb_build_object('version', v, 'reason', p_reason));
  return v;
end $$;

-- ------------------------------------------------------------------ applications
alter table grant_applications
  add column if not exists category text,
  add column if not exists content jsonb not null default '{}',
  add column if not exists recipient_address text,
  add column if not exists version int not null default 0,
  add column if not exists submitted_at timestamptz,
  add column if not exists amendment_open boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();
alter table grant_applications drop constraint if exists grant_applications_status_check;
alter table grant_applications add constraint grant_applications_status_check
  check (status in ('draft','submitted','under_review','clarification_requested','recommended','awarded','rejected'));
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'grant_applications_category_check') then
    alter table grant_applications add constraint grant_applications_category_check check (category is null or category in ('software','research','education','community','other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'grant_applications_recipient_check') then
    alter table grant_applications add constraint grant_applications_recipient_check check (recipient_address is null or recipient_address ~ '^0x[0-9a-fA-F]{40}$');
  end if;
end $$;

create table if not exists grant_application_versions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references grant_applications(id) on delete cascade,
  version int not null,
  requested_amount numeric(78,0) not null,
  category text not null,
  recipient_address text not null,
  content jsonb not null,
  changed_by uuid not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (application_id, version)
);
alter table grant_application_versions enable row level security;
drop policy if exists grant_versions_read on grant_application_versions;
create policy grant_versions_read on grant_application_versions for select using (
  has_role(organization_id, admin_roles()) or has_role(organization_id, security_roles())
  or exists (select 1 from grant_applications a where a.id = application_id and a.applicant_user_id = auth.uid())
);

-- Drafts are private to the applicant: administrators see an application from submission on.
drop policy if exists apps_sel on grant_applications;
create policy apps_sel on grant_applications for select using (
  (has_role(organization_id, admin_roles()) and status <> 'draft') or applicant_user_id = auth.uid()
);

-- Everything a complete application must hold. Returns null when valid, otherwise the first problem in plain words.
create or replace function grant_application_problem(a grant_applications, g grants) returns text language plpgsql stable as $$
declare c jsonb := a.content; m jsonb; b jsonb; total numeric := 0; i int := 0; x text; d date;
begin
  if a.category is null or not (a.category = any(g.categories)) then return 'choose a project category this round accepts'; end if;
  if length(trim(coalesce(a.applicant_name, ''))) not between 1 and 120 then return 'enter the project or team name'; end if;
  foreach x in array array['overview','problem','solution'] loop
    if length(trim(coalesce(c->>x, ''))) not between 20 and 6000 then return 'the ' || x || ' section needs 20 to 6000 characters'; end if;
  end loop;
  if length(trim(coalesce(c->>'team', ''))) not between 10 and 4000 then return 'describe the team and contributors (10 to 4000 characters)'; end if;
  if length(coalesce(c->>'experience', '')) > 4000 or length(coalesce(c->>'technical', '')) > 6000 or length(coalesce(c->>'metrics', '')) > 3000 or length(coalesce(c->>'timeline', '')) > 3000 then
    return 'a section is too long';
  end if;
  if a.category = 'software' and length(trim(coalesce(c->>'technical', ''))) < 20 then return 'software projects need a technical implementation section (at least 20 characters)'; end if;
  if length(trim(coalesce(c->>'metrics', ''))) < 10 then return 'give at least one success metric'; end if;
  -- links: all optional; a public repository is never required
  foreach x in array array['website','docs','demo'] loop
    if coalesce(c->'links'->>x, '') <> '' and (c->'links'->>x !~ '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[^[:space:]]*)?$' or length(c->'links'->>x) > 300) then return x || ' must be an https:// link of at most 300 characters'; end if;
  end loop;
  if jsonb_typeof(coalesce(c->'links'->'repos', '[]')) <> 'array' or jsonb_array_length(coalesce(c->'links'->'repos', '[]')) > 5 then return 'list at most 5 repositories'; end if;
  for x in select * from jsonb_array_elements_text(coalesce(c->'links'->'repos', '[]')) loop
    if x !~ '^https://github\.com/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}/?$' then return 'repositories must be links like https://github.com/owner/name'; end if;
  end loop;
  if jsonb_array_length(coalesce(c->'contracts', '[]')) > 10 or exists (select 1 from jsonb_array_elements_text(coalesce(c->'contracts', '[]')) y where y !~ '^0x[0-9a-fA-F]{40}$') then return 'contract addresses must be 0x addresses (at most 10)'; end if;
  if jsonb_array_length(coalesce(c->'transactions', '[]')) > 10 or exists (select 1 from jsonb_array_elements_text(coalesce(c->'transactions', '[]')) y where y !~ '^(0x)?[0-9a-fA-F]{64}$') then return 'transaction hashes must be 32-byte hex (at most 10)'; end if;
  -- budget lines and milestones must each add up exactly to the request
  if jsonb_typeof(c->'budget') <> 'array' or jsonb_array_length(c->'budget') not between 1 and 30 then return 'give a budget breakdown of 1 to 30 lines'; end if;
  for b in select * from jsonb_array_elements(c->'budget') loop
    if length(trim(coalesce(b->>'item', ''))) not between 2 and 160 or coalesce(b->>'amount', '') !~ '^[0-9]{1,40}$' or (b->>'amount')::numeric <= 0 then return 'each budget line needs a description and a positive amount'; end if;
    total := total + (b->>'amount')::numeric;
  end loop;
  if total <> a.requested_amount then return 'the budget lines must add up exactly to the requested amount'; end if;
  total := 0;
  if jsonb_typeof(c->'milestones') <> 'array' or jsonb_array_length(c->'milestones') not between 1 and 10 then return 'define 1 to 10 milestones'; end if;
  for m in select * from jsonb_array_elements(c->'milestones') loop
    i := i + 1;
    if length(trim(coalesce(m->>'title', ''))) not between 2 and 120 then return 'milestone ' || i || ' needs a title'; end if;
    if length(trim(coalesce(m->>'deliverable', ''))) not between 10 and 1000 then return 'milestone ' || i || ' needs a deliverable description (10 to 1000 characters)'; end if;
    if length(trim(coalesce(m->>'verification', ''))) not between 5 and 600 then return 'milestone ' || i || ': say how a reviewer can verify it'; end if;
    begin d := (m->>'due')::date; exception when others then return 'milestone ' || i || ' needs a due date'; end;
    if d is null or d <= current_date then return 'milestone ' || i || ' must be due in the future'; end if;
    if coalesce(m->>'amount', '') !~ '^[0-9]{1,40}$' or (m->>'amount')::numeric <= 0 then return 'milestone ' || i || ' needs a positive amount'; end if;
    total := total + (m->>'amount')::numeric;
  end loop;
  if total <> a.requested_amount then return 'the milestones must add up exactly to the requested amount'; end if;
  if a.recipient_address is null then return 'give the wallet address that would receive funds'; end if;
  if coalesce((c->'declarations'->>'accurate')::boolean, false) is not true or coalesce((c->'declarations'->>'rights')::boolean, false) is not true
     or coalesce((c->'declarations'->>'conflicts_disclosed')::boolean, false) is not true then
    return 'confirm all three declarations';
  end if;
  if a.requested_amount <= 0 or a.requested_amount > g.budget then return 'the request must be positive and within the round budget'; end if;
  if g.max_request is not null and a.requested_amount > g.max_request then return 'the request is above this round''s maximum per application'; end if;
  return null;
end $$;

-- Creates or updates the caller's application in this round. Allowed while it is a draft, or while an amendment is open.
create or replace function save_grant_application(p_grant uuid, p_name text, p_category text, p_amount numeric, p_recipient text, p_content jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare g grants%rowtype; a grant_applications%rowtype; me uuid := auth.uid();
begin
  select * into g from grants where id = p_grant;
  if not found or me is null or not has_role(g.organization_id, array['grant_applicant']::org_role[]) then raise exception 'not allowed: grant applicant role required'; end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' or length(p_content::text) > 60000 then raise exception 'the application content is missing or too large'; end if;
  if p_amount is not null and (p_amount <= 0 or p_amount <> trunc(p_amount)) then raise exception 'the requested amount must be a positive whole number of base units'; end if;
  if p_recipient is not null and p_recipient <> '' and p_recipient !~ '^0x[0-9a-fA-F]{40}$' then raise exception 'the recipient must be a 0x address'; end if;
  if p_category is not null and p_category not in ('software','research','education','community','other') then raise exception 'unknown category'; end if;
  select * into a from grant_applications where grant_id = g.id and applicant_user_id = me for update;
  if not found then
    if g.status <> 'open' or (g.deadline is not null and g.deadline <= now()) then raise exception 'this grant round is not accepting applications'; end if;
    insert into grant_applications(organization_id, grant_id, applicant_user_id, applicant_name, requested_amount, status, category, content, recipient_address, version)
    values (g.organization_id, g.id, me, coalesce(nullif(trim(p_name), ''), 'Untitled draft'), coalesce(p_amount, 1), 'draft', p_category, p_content, nullif(p_recipient, ''), 0)
    returning * into a;
    insert into audit_events(organization_id, actor, action, subject) values (g.organization_id, me::text, 'grant.draft_created', a.id::text);
    return a.id;
  end if;
  if not (a.status = 'draft' or a.amendment_open) then raise exception 'this application is % and can no longer be edited', a.status; end if;
  update grant_applications set applicant_name = coalesce(nullif(trim(p_name), ''), applicant_name), category = p_category, requested_amount = coalesce(p_amount, requested_amount),
    recipient_address = nullif(p_recipient, ''), content = p_content, updated_at = now() where id = a.id;
  return a.id;
end $$;

-- Submits a draft, or re-submits an amendment. Validates everything and stores a new version.
create or replace function submit_grant_application(p_app uuid, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare a grant_applications%rowtype; g grants%rowtype; me uuid := auth.uid(); problem text; v int; amending boolean;
begin
  select * into a from grant_applications where id = p_app for update;
  if not found or me is null or a.applicant_user_id <> me then raise exception 'not allowed: only the applicant can submit their application'; end if;
  select * into g from grants where id = a.grant_id;
  amending := a.amendment_open;
  if not (a.status = 'draft' or amending) then raise exception 'this application is already %', a.status; end if;
  if not amending and (g.status <> 'open' or (g.deadline is not null and g.deadline <= now())) then raise exception 'this grant round is not accepting applications'; end if;
  problem := grant_application_problem(a, g);
  if problem is not null then raise exception 'cannot submit yet: %', problem; end if;
  if amending and length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'describe what you changed (at least 5 characters)'; end if;
  v := a.version + 1;
  insert into grant_application_versions(organization_id, application_id, version, requested_amount, category, recipient_address, content, changed_by, reason)
  values (a.organization_id, a.id, v, a.requested_amount, a.category, a.recipient_address, a.content, me, case when amending then trim(p_reason) else 'submitted' end);
  update grant_applications set version = v, amendment_open = false, updated_at = now(),
    status = case when amending then 'under_review' else 'submitted' end,
    submitted_at = coalesce(submitted_at, now()),
    pitch = left(trim(a.content->>'overview') || E'\n\n' || trim(a.content->>'problem') || E'\n\n' || trim(a.content->>'solution'), 6000)
  where id = a.id;
  insert into audit_events(organization_id, actor, action, subject, detail)
  values (a.organization_id, me::text, case when amending then 'grant.amended' else 'grant.submitted' end, a.id::text, jsonb_build_object('version', v, 'requested', a.requested_amount::text));
  return v;
end $$;

-- The old one-step apply stays for compatibility, but is now a submitted application with content.
revoke all on function create_grant_round(uuid, text, numeric, text, text, text[], timestamptz, numeric, jsonb) from public;
revoke all on function set_grant_rubric(uuid, jsonb, text) from public;
revoke all on function save_grant_application(uuid, text, text, numeric, text, jsonb) from public;
revoke all on function submit_grant_application(uuid, text) from public;
grant execute on function create_grant_round(uuid, text, numeric, text, text, text[], timestamptz, numeric, jsonb) to authenticated;
grant execute on function set_grant_rubric(uuid, jsonb, text) to authenticated;
grant execute on function save_grant_application(uuid, text, text, numeric, text, jsonb) to authenticated;
grant execute on function submit_grant_application(uuid, text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function create_grant_round(uuid, text, numeric, text, text, text[], timestamptz, numeric, jsonb), set_grant_rubric(uuid, jsonb, text), save_grant_application(uuid, text, text, numeric, text, jsonb), submit_grant_application(uuid, text) from anon';
  end if;
end $$;
