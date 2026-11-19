-- Grants, phases 3 to 5: evidence, AI-assisted review reports, risk flags, clarification requests, conflicts of interest,
-- reviewer overrides and the grant-review workflow. Safe to re-run.
--
-- Who writes what:
--   * The server (service role) runs the grant-review workflow and writes evidence, reports, risk flags and DRAFT
--     clarification requests. Signed-in users cannot write those tables directly.
--   * Administrators decide: dismiss or confirm a flag, edit and send a clarification, override a score, declare a conflict,
--     recommend, reject, award. Every decision needs a reason and is in audit_events.
--   * Applicants see only clarification requests that were SENT to them, and answer them.
--   * Reports are append-only: a new evaluation is a new row with its rubric version; nothing is overwritten.

-- ------------------------------------------------------------------ evidence
create table if not exists grant_evidence (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references grant_applications(id) on delete cascade,
  task_id uuid references agent_tasks(id) on delete set null,
  application_version int not null,
  source text not null check (source in ('github', 'qorechain', 'web')),
  subject text not null,
  claim text not null,
  status text not null check (status in ('VERIFIED', 'PARTIALLY_VERIFIED', 'UNVERIFIED', 'CONTRADICTED', 'UNAVAILABLE')),
  reason text not null,
  observed jsonb not null default '{}',
  url text not null,
  retrieved_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists grant_evidence_app_idx on grant_evidence(application_id, created_at desc);

-- ------------------------------------------------------------------ review reports (append-only)
create table if not exists grant_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references grant_applications(id) on delete cascade,
  task_id uuid references agent_tasks(id) on delete set null,
  application_version int not null,
  rubric_id uuid not null references grant_rubrics(id),
  rubric_version int not null,
  scores jsonb not null,           -- [{key,label,max,score|null,state,explanation,evidence_refs,missing}]
  scored_points numeric not null,  -- sum of scores where state = 'scored'
  scored_max numeric not null,     -- sum of maxima where state = 'scored'
  applicable_max numeric not null, -- sum of maxima of criteria that apply to the category
  recommendation text not null check (recommendation in ('strong_candidate', 'needs_clarification', 'further_review')),
  report jsonb not null,           -- sections; facts, claims, AI views and rule results kept apart
  model text,
  created_at timestamptz not null default now()
);
create index if not exists grant_reviews_app_idx on grant_reviews(application_id, created_at desc);
create or replace function grant_reviews_immutable() returns trigger language plpgsql as $$ begin raise exception 'grant reports are append-only'; end $$;
drop trigger if exists grant_reviews_no_update on grant_reviews;
create trigger grant_reviews_no_update before update or delete on grant_reviews for each row execute function grant_reviews_immutable();
-- The first evaluation against a rubric locks it; later rubric changes become new versions.
create or replace function grant_reviews_lock_rubric() returns trigger language plpgsql security definer set search_path = public as $$
begin update grant_rubrics set locked_at = now() where id = new.rubric_id and locked_at is null; return new; end $$;
drop trigger if exists grant_reviews_lock on grant_reviews;
create trigger grant_reviews_lock after insert on grant_reviews for each row execute function grant_reviews_lock_rubric();

-- ------------------------------------------------------------------ risk flags
create table if not exists grant_risk_flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references grant_applications(id) on delete cascade,
  task_id uuid references agent_tasks(id) on delete set null,
  code text not null,
  severity text not null check (severity in ('low', 'medium', 'high')),
  message text not null,
  evidence jsonb not null default '{}',
  status text not null default 'open' check (status in ('open', 'dismissed', 'confirmed')),
  decided_by uuid, decided_reason text, decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists grant_flags_app_idx on grant_risk_flags(application_id, status);

-- ------------------------------------------------------------------ clarification requests
create table if not exists grant_clarifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references grant_applications(id) on delete cascade,
  task_id uuid references agent_tasks(id) on delete set null,
  questions jsonb not null,        -- [{question, about}]
  status text not null default 'draft' check (status in ('draft', 'sent', 'answered', 'cancelled')),
  drafted_by text not null,        -- 'GrantCoordinator' or a user id
  approved_by uuid, sent_at timestamptz,
  response text, responded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists grant_clar_app_idx on grant_clarifications(application_id, created_at desc);

-- ------------------------------------------------------------------ conflicts and overrides
create table if not exists grant_conflicts (
  organization_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references grant_applications(id) on delete cascade,
  user_id uuid not null,
  note text not null,
  declared_at timestamptz not null default now(),
  primary key (application_id, user_id)
);
create table if not exists grant_overrides (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  review_id uuid not null references grant_reviews(id) on delete cascade,
  criterion text not null,
  new_score numeric not null,
  reason text not null,
  by_user uuid not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ row-level security
alter table grant_evidence enable row level security;
alter table grant_reviews enable row level security;
alter table grant_risk_flags enable row level security;
alter table grant_clarifications enable row level security;
alter table grant_conflicts enable row level security;
alter table grant_overrides enable row level security;
do $$ declare t text; begin
  foreach t in array array['grant_evidence','grant_reviews','grant_risk_flags','grant_conflicts','grant_overrides'] loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select using (has_role(organization_id, admin_roles()) or has_role(organization_id, security_roles()))', t || '_read', t);
  end loop;
end $$;
drop policy if exists grant_clarifications_read on grant_clarifications;
create policy grant_clarifications_read on grant_clarifications for select using (
  has_role(organization_id, admin_roles()) or has_role(organization_id, security_roles())
  or (status in ('sent', 'answered') and exists (select 1 from grant_applications a where a.id = application_id and a.applicant_user_id = auth.uid()))
);

-- ------------------------------------------------------------------ decisions by people
create or replace function grant_has_conflict(p_app uuid, p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from grant_conflicts where application_id = p_app and user_id = p_user)
$$;

create or replace function declare_grant_conflict(p_app uuid, p_note text) returns void language plpgsql security definer set search_path = public as $$
declare a grant_applications%rowtype; me uuid := auth.uid();
begin
  select * into a from grant_applications where id = p_app;
  if not found or me is null or not (has_role(a.organization_id, admin_roles()) or has_role(a.organization_id, security_roles())) then raise exception 'not allowed'; end if;
  if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'describe the conflict (at least 5 characters)'; end if;
  insert into grant_conflicts(organization_id, application_id, user_id, note) values (a.organization_id, a.id, me, left(trim(p_note), 500))
  on conflict (application_id, user_id) do update set note = excluded.note, declared_at = now();
  insert into audit_events(organization_id, actor, action, subject, detail) values (a.organization_id, me::text, 'grant.conflict_declared', a.id::text, jsonb_build_object('note', left(trim(p_note), 200)));
end $$;

create or replace function decide_grant_flag(p_flag uuid, p_decision text, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare f grant_risk_flags%rowtype; me uuid := auth.uid();
begin
  select * into f from grant_risk_flags where id = p_flag for update;
  if not found or me is null or not (has_role(f.organization_id, admin_roles()) or has_role(f.organization_id, security_roles())) then raise exception 'not allowed'; end if;
  if p_decision not in ('dismissed', 'confirmed') then raise exception 'decision must be dismissed or confirmed'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'give a reason (at least 5 characters)'; end if;
  if grant_has_conflict(f.application_id, me) then raise exception 'you declared a conflict of interest on this application'; end if;
  update grant_risk_flags set status = p_decision, decided_by = me, decided_reason = left(trim(p_reason), 500), decided_at = now() where id = f.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (f.organization_id, me::text, 'grant.flag_' || p_decision, f.application_id::text, jsonb_build_object('flag', f.code, 'reason', left(trim(p_reason), 200)));
end $$;

-- A reviewer edits the AI's draft questions and sends them; the application is opened for one amendment.
create or replace function send_grant_clarification(p_clar uuid, p_questions jsonb) returns void language plpgsql security definer set search_path = public as $$
declare c grant_clarifications%rowtype; a grant_applications%rowtype; me uuid := auth.uid(); q jsonb;
begin
  select * into c from grant_clarifications where id = p_clar for update;
  if not found or me is null or not has_role(c.organization_id, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  if c.status <> 'draft' then raise exception 'this clarification request is already %', c.status; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 1 and 10 then raise exception 'send 1 to 10 questions'; end if;
  for q in select * from jsonb_array_elements(p_questions) loop
    if length(trim(coalesce(q->>'question', ''))) not between 10 and 600 then raise exception 'each question must be 10 to 600 characters'; end if;
  end loop;
  select * into a from grant_applications where id = c.application_id for update;
  if grant_has_conflict(a.id, me) then raise exception 'you declared a conflict of interest on this application'; end if;
  if a.status not in ('submitted', 'under_review') then raise exception 'the application is %, so it cannot be sent a clarification request', a.status; end if;
  update grant_clarifications set questions = p_questions, status = 'sent', approved_by = me, sent_at = now() where id = c.id;
  update grant_applications set status = 'clarification_requested', amendment_open = true, updated_at = now() where id = a.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (a.organization_id, me::text, 'grant.clarification_sent', a.id::text, jsonb_build_object('questions', jsonb_array_length(p_questions), 'drafted_by', c.drafted_by));
end $$;

create or replace function cancel_grant_clarification(p_clar uuid) returns void language plpgsql security definer set search_path = public as $$
declare c grant_clarifications%rowtype; me uuid := auth.uid();
begin
  select * into c from grant_clarifications where id = p_clar for update;
  if not found or me is null or not has_role(c.organization_id, admin_roles()) then raise exception 'not allowed'; end if;
  if c.status <> 'draft' then raise exception 'only a draft can be discarded'; end if;
  update grant_clarifications set status = 'cancelled' where id = c.id;
end $$;

-- The applicant answers in their portal. Their answer is kept; editing sections and resubmitting is separate (versioned).
create or replace function answer_grant_clarification(p_clar uuid, p_response text) returns void language plpgsql security definer set search_path = public as $$
declare c grant_clarifications%rowtype; a grant_applications%rowtype; me uuid := auth.uid();
begin
  select * into c from grant_clarifications where id = p_clar for update;
  if not found then raise exception 'unknown clarification request'; end if;
  select * into a from grant_applications where id = c.application_id;
  if me is null or a.applicant_user_id <> me then raise exception 'not allowed: only the applicant can answer'; end if;
  if c.status <> 'sent' then raise exception 'this request is %', c.status; end if;
  if length(trim(coalesce(p_response, ''))) not between 5 and 6000 then raise exception 'the answer must be 5 to 6000 characters'; end if;
  update grant_clarifications set status = 'answered', response = trim(p_response), responded_at = now() where id = c.id;
  insert into audit_events(organization_id, actor, action, subject) values (a.organization_id, me::text, 'grant.clarification_answered', a.id::text);
end $$;

create or replace function override_grant_score(p_review uuid, p_criterion text, p_score numeric, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare r grant_reviews%rowtype; me uuid := auth.uid(); c jsonb;
begin
  select * into r from grant_reviews where id = p_review;
  if not found or me is null or not has_role(r.organization_id, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  if grant_has_conflict(r.application_id, me) then raise exception 'you declared a conflict of interest on this application'; end if;
  select x into c from jsonb_array_elements(r.scores) x where x->>'key' = p_criterion;
  if c is null then raise exception 'unknown criterion'; end if;
  if p_score is null or p_score < 0 or p_score > (c->>'max')::numeric then raise exception 'the score must be between 0 and %', c->>'max'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'explain the override (at least 10 characters)'; end if;
  insert into grant_overrides(organization_id, review_id, criterion, new_score, reason, by_user) values (r.organization_id, r.id, p_criterion, p_score, left(trim(p_reason), 600), me);
  insert into audit_events(organization_id, actor, action, subject, detail) values (r.organization_id, me::text, 'grant.score_overridden', r.application_id::text, jsonb_build_object('criterion', p_criterion, 'score', p_score, 'review', r.id));
end $$;

-- Recommend / reject and award now refuse anyone who declared a conflict on the application.
create or replace function decide_application(p_app uuid, p_decision text, p_note text) returns text language plpgsql security definer set search_path = public as $$
declare a grant_applications%rowtype; me uuid := auth.uid(); s text;
begin
  if p_decision not in ('recommend', 'reject') then raise exception 'decision must be recommend or reject'; end if;
  select * into a from grant_applications where id = p_app for update;
  if not found or me is null or not has_role(a.organization_id, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  if grant_has_conflict(a.id, me) then raise exception 'you declared a conflict of interest on this application, so you cannot decide it'; end if;
  if a.applicant_user_id = me then raise exception 'you cannot decide your own application'; end if;
  if a.status not in ('submitted', 'under_review') then raise exception 'the application is %, not awaiting a decision', a.status; end if;
  if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'write a short reason'; end if;
  s := case p_decision when 'recommend' then 'recommended' else 'rejected' end;
  update grant_applications set status = s, recommended_by = case when p_decision = 'recommend' then me else null end,
    review = coalesce(review, '{}'::jsonb) || jsonb_build_object('decision', p_decision, 'by', me, 'at', now(), 'note', left(trim(p_note), 500)) where id = a.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (a.organization_id, me::text, 'grant.' || p_decision, a.id::text, jsonb_build_object('status', s, 'reason', left(trim(p_note), 200)));
  return s;
end $$;

do $$ begin
  if to_regprocedure('public.award_application_core(uuid,jsonb)') is null then
    alter function award_application(uuid, jsonb) rename to award_application_core;
  end if;
end $$;
revoke all on function award_application_core(uuid, jsonb) from public;
do $$ begin if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function award_application_core(uuid, jsonb) from authenticated'; end if; end $$;
create or replace function award_application(p_app uuid, p_milestones jsonb) returns int language plpgsql security definer set search_path = public as $$
declare a grant_applications%rowtype; me uuid := auth.uid();
begin
  select * into a from grant_applications where id = p_app;
  if found and me is not null and grant_has_conflict(a.id, me) then raise exception 'you declared a conflict of interest on this application, so you cannot award it'; end if;
  if found and a.applicant_user_id = me then raise exception 'you cannot award your own application'; end if;
  return award_application_core(p_app, p_milestones);
end $$;

-- ------------------------------------------------------------------ the grant-review workflow (agent_tasks kind 'grant_review')
create or replace function start_grant_workflow(p_org uuid, p_grant uuid, p_instruction text, p_idempotency_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_id uuid; g grants%rowtype;
begin
  if me is null or not has_role(p_org, admin_roles()) then raise exception 'not allowed: owner or administrator required'; end if;
  select * into g from grants where id = p_grant and organization_id = p_org;
  if not found then raise exception 'unknown grant round'; end if;
  if p_instruction is null or length(trim(p_instruction)) not between 3 and 2000 then raise exception 'instruction must be 3 to 2000 characters'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 80 then raise exception 'idempotency key must be 8 to 80 characters'; end if;
  select t.id into v_id from agent_tasks t where t.organization_id = p_org and t.idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  insert into agent_tasks(organization_id, requested_by, agent_id, intent, state, kind, instruction, idempotency_key, result)
  values (p_org, me, 'GrantCoordinator', 'Investigate grant applications', 'QUEUED', 'grant_review', trim(p_instruction), p_idempotency_key, jsonb_build_object('grant_id', g.id))
  returning agent_tasks.id into v_id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p_org, me::text, 'grant.investigation_started', v_id::text, jsonb_build_object('grant', g.id, 'instruction', left(trim(p_instruction), 280)));
  return v_id;
end $$;

create or replace function cancel_grant_workflow(p_task uuid) returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t agent_tasks%rowtype;
begin
  select * into t from agent_tasks where id = p_task and kind = 'grant_review' for update;
  if not found or me is null or not has_role(t.organization_id, admin_roles()) then raise exception 'not allowed'; end if;
  if t.state in ('COMPLETED', 'FAILED', 'CANCELLED') then return t.state; end if;
  update agent_tasks set state = 'CANCELLED', cancelled_at = now(), lease_until = null, updated_at = now() where id = t.id;
  insert into audit_events(organization_id, actor, action, subject) values (t.organization_id, me::text, 'grant.investigation_cancelled', t.id::text);
  return 'CANCELLED';
end $$;

create or replace function claim_grant_workflow(p_task uuid, p_lease_seconds int) returns agent_tasks
language plpgsql security definer set search_path = public as $$
declare t agent_tasks%rowtype;
begin
  update agent_tasks set lease_until = now() + make_interval(secs => greatest(5, least(p_lease_seconds, 120))), attempts = attempts + 1, updated_at = now(),
    state = case when state = 'QUEUED' then 'RUNNING' else state end
  where id = p_task and kind = 'grant_review' and state in ('QUEUED', 'RUNNING', 'PAUSED_AI_UNAVAILABLE') and (lease_until is null or lease_until < now())
  returning * into t;
  if not found then return null; end if;
  return t;
end $$;

-- ------------------------------------------------------------------ permissions
do $$ declare f text; begin
  foreach f in array array['declare_grant_conflict(uuid, text)', 'decide_grant_flag(uuid, text, text)', 'send_grant_clarification(uuid, jsonb)', 'cancel_grant_clarification(uuid)',
    'answer_grant_clarification(uuid, text)', 'override_grant_score(uuid, text, numeric, text)', 'decide_application(uuid, text, text)', 'award_application(uuid, jsonb)',
    'start_grant_workflow(uuid, uuid, text, text)', 'cancel_grant_workflow(uuid)'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
  end loop;
  execute 'revoke all on function claim_grant_workflow(uuid, int) from public';
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function claim_grant_workflow(uuid, int) from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function claim_grant_workflow(uuid, int) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function claim_grant_workflow(uuid, int) to service_role'; end if;
end $$;
