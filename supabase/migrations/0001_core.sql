-- QoreOps core schema. Every tenant-owned row carries organization_id and is protected by row-level security.
-- Assumes Supabase (auth.users, auth.uid()). All money amounts are base-unit integers stored as numeric(78,0).


-- ------------------------------------------------------------------ helpers
create type org_role as enum (
  'owner','administrator','finance_manager','procurement_manager','security_reviewer',
  'employee','vendor','grant_applicant','dao_member','auditor'
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  profile jsonb not null default '{}',
  status text not null default 'active' check (status in ('active','suspended')),
  treasury_address text check (treasury_address ~ '^0x[0-9a-fA-F]{40}$'),
  contracts jsonb not null default '{}',          -- deployed addresses, filled only after real deployment
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null,
  role org_role not null,
  status text not null default 'active' check (status in ('active','invited','revoked')),
  wallet_address text check (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, role)
);
create index memberships_user_idx on memberships(user_id, organization_id) where status = 'active';

-- Membership helpers. SECURITY DEFINER so policies can read memberships without recursing into its own RLS.
create function is_member(org uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.organization_id = org and m.user_id = auth.uid() and m.status = 'active');
$$;
create function has_role(org uuid, roles org_role[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.organization_id = org and m.user_id = auth.uid() and m.status = 'active' and m.role = any(roles));
$$;
-- "Internal" = everyone except external parties (vendors, grant applicants). External parties never see other parties' data.
create function is_internal(org uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.organization_id = org and m.user_id = auth.uid() and m.status = 'active'
                  and m.role not in ('vendor','grant_applicant'));
$$;

create function admin_roles() returns org_role[] language sql immutable as $$ select array['owner','administrator']::org_role[] $$;
create function finance_roles() returns org_role[] language sql immutable as $$ select array['owner','administrator','finance_manager']::org_role[] $$;
create function procurement_roles() returns org_role[] language sql immutable as $$ select array['owner','administrator','procurement_manager']::org_role[] $$;
create function security_roles() returns org_role[] language sql immutable as $$ select array['owner','administrator','security_reviewer']::org_role[] $$;

-- ------------------------------------------------------------------ agents & tasks
create table agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id text not null,                          -- e.g. PaymentAgent
  account_address text check (account_address ~ '^0x[0-9a-fA-F]{40}$'),
  status text not null default 'active' check (status in ('active','suspended','revoked')),
  permissions jsonb not null default '{}',
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, agent_id)
);

create table agent_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  parent_task_id uuid references agent_tasks(id),
  requested_by uuid not null,
  agent_id text not null,
  intent text not null,
  state text not null default 'QUEUED' check (state in ('QUEUED','RUNNING','AWAITING_HUMAN','COMPLETED','FAILED','PAUSED_AI_UNAVAILABLE')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_tasks_org_idx on agent_tasks(organization_id, state, created_at desc);

create table agent_messages (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  task_id uuid not null references agent_tasks(id) on delete cascade,
  from_agent text not null, to_agent text not null, kind text not null,
  nonce text not null, issued_at timestamptz not null, expires_at timestamptz not null,
  payload jsonb not null, sig text not null,
  unique (organization_id, nonce)                  -- replay protection survives restarts
);

create table ai_usage (
  id bigint generated always as identity primary key,
  organization_id uuid references organizations(id) on delete cascade,
  agent_id text not null, model text not null, status text not null,
  prompt_tokens int, output_tokens int, total_tokens int, latency_ms int not null,
  created_at timestamptz not null default now()    -- metadata only: never prompts or outputs
);

-- ------------------------------------------------------------------ treasury, policy, approvals, transactions
create table treasuries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  label text not null, vault_address text not null check (vault_address ~ '^0x[0-9a-fA-F]{40}$'),
  chain_id int not null default 9800 check (chain_id = 9800),   -- mainnet intentionally impossible
  created_at timestamptz not null default now(),
  unique (organization_id, vault_address)
);

create table policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id text not null,
  nl_source text,                                  -- the administrator's original sentence
  status text not null default 'draft' check (status in ('draft','pending_approval','active','revoked','superseded')),
  active_version int,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  policy_id uuid not null references policies(id) on delete cascade,
  version int not null,
  document jsonb not null,                         -- validated structured policy
  document_hash text not null,
  findings jsonb not null default '[]',
  approved_by uuid, approved_at timestamptz,
  onchain_tx_hash text,
  created_at timestamptz not null default now(),
  unique (policy_id, version)
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  subject_type text not null, subject_id uuid not null,
  payment_hash text not null check (payment_hash ~ '^0x[0-9a-fA-F]{64}$'),   -- approval is bound to the exact payment
  approver uuid not null, decision text not null check (decision in ('approve','reject')),
  evidence jsonb not null default '{}', onchain_tx_hash text,
  created_at timestamptz not null default now(),
  unique (payment_hash, approver)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  idempotency_key text not null,
  agent_id text not null,
  state text not null default 'PROPOSED' check (state in ('PROPOSED','VALIDATING','AWAITING_APPROVAL','APPROVED','SIMULATING','READY','SUBMITTED','CONFIRMED','REJECTED','FAILED','CANCELLED')),
  payment_hash text not null check (payment_hash ~ '^0x[0-9a-fA-F]{64}$'),
  token text not null, recipient text not null, amount numeric(78,0) not null check (amount > 0),
  policy_version int not null, expires_at timestamptz not null,
  required_approvals int not null default 0,
  tx_hash text, evaluation jsonb, reasons jsonb not null default '[]', history jsonb not null default '[]',
  source text not null default 'LIVE_TESTNET' check (source in ('LIVE_TESTNET','SIMULATION')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  unique (organization_id, payment_hash)
);

-- ------------------------------------------------------------------ vendors, invoices, documents
create table vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid,                                    -- the vendor's own login, if any
  name text not null, verified boolean not null default false,
  payout_address text check (payout_address ~ '^0x[0-9a-fA-F]{40}$'),
  created_at timestamptz not null default now()
);
create table vendor_address_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vendor_id uuid not null references vendors(id) on delete cascade,
  payout_address text not null, approved_by uuid, created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  purpose text not null,                           -- invoice | bid | evidence | agreement | ...
  version int not null default 1,
  storage_path text not null,                      -- ciphertext only
  ciphertext_sha256 text not null, envelope_bytes int not null,
  recipients jsonb not null default '[]',          -- addresses the envelope is sealed to
  uploaded_by uuid not null, anchored_tx_hash text,
  created_at timestamptz not null default now()
);
create table document_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  user_id uuid not null, granted_by uuid not null, created_at timestamptz not null default now(),
  unique (document_id, user_id)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vendor_id uuid references vendors(id),
  invoice_number text not null, amount numeric(78,0) not null check (amount > 0), token text not null,
  recipient text not null check (recipient ~ '^0x[0-9a-fA-F]{40}$'), due_date date,
  status text not null default 'received' check (status in ('received','held','approved','paid','rejected')),
  review jsonb, document_id uuid references documents(id), payment_idempotency_key text,
  created_at timestamptz not null default now(),
  unique (organization_id, vendor_id, invoice_number),              -- duplicate invoices cannot be stored twice
  unique (organization_id, payment_idempotency_key)
);

-- ------------------------------------------------------------------ procurement, grants, milestones
create table procurements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null, requirements text, budget numeric(78,0) not null, token text not null,
  status text not null default 'draft' check (status in ('draft','open','review','awarded','closed')),
  bids_open_at timestamptz, award_bid_id uuid, escrow_project_id numeric(78,0), created_by uuid not null,
  created_at timestamptz not null default now()
);
create table bids (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  procurement_id uuid not null references procurements(id) on delete cascade,
  vendor_id uuid not null references vendors(id), submitted_by uuid not null,
  document_id uuid not null references documents(id),               -- the sealed bid
  quoted_amount numeric(78,0),                                      -- optional plaintext metadata the vendor chooses to reveal
  created_at timestamptz not null default now(),
  unique (procurement_id, vendor_id)
);
create table grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null, budget numeric(78,0) not null, token text not null,
  status text not null default 'open' check (status in ('draft','open','closed')),
  created_by uuid not null, created_at timestamptz not null default now()
);
create table grant_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  grant_id uuid not null references grants(id) on delete cascade,
  applicant_user_id uuid not null, applicant_name text not null,
  requested_amount numeric(78,0) not null, document_id uuid references documents(id),
  status text not null default 'submitted' check (status in ('submitted','under_review','recommended','awarded','rejected')),
  review jsonb, escrow_project_id numeric(78,0), created_at timestamptz not null default now()
);
create table milestones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  parent_type text not null check (parent_type in ('procurement','grant')), parent_id uuid not null,
  escrow_project_id numeric(78,0), idx int not null, title text not null, amount numeric(78,0) not null,
  status text not null default 'pending' check (status in ('pending','evidence_submitted','approved','released','disputed')),
  evidence_document_id uuid references documents(id), review jsonb, release_tx_hash text,
  created_at timestamptz not null default now(), unique (parent_type, parent_id, idx)
);

-- ------------------------------------------------------------------ other modules
create table payroll_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  period text not null, items jsonb not null, total numeric(78,0) not null, token text not null,
  status text not null default 'draft' check (status in ('draft','awaiting_approval','approved','paid','failed')),
  created_by uuid not null, created_at timestamptz not null default now(), unique (organization_id, period)
);
create table revenue_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer text not null, reference text not null, amount numeric(78,0) not null, token text not null,
  due_date date, status text not null default 'issued' check (status in ('issued','paid','overdue','void')),
  matched_tx_hash text, created_at timestamptz not null default now(), unique (organization_id, reference)
);
create table governance_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null, body text not null,
  kind text not null default 'application_vote' check (kind in ('application_vote','onchain_governance_reference')),  -- never implied to be a native vote
  analysis jsonb, status text not null default 'discussion' check (status in ('discussion','voting','passed','failed','executed')),
  created_by uuid not null, created_at timestamptz not null default now()
);
create table votes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  proposal_id uuid not null references governance_proposals(id) on delete cascade,
  voter uuid not null, choice text not null check (choice in ('for','against','abstain')),
  created_at timestamptz not null default now(), unique (proposal_id, voter)
);
create table strategies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('dca','rebalance','arbitrage')), config jsonb not null,
  mode text not null default 'SIMULATION' check (mode in ('SIMULATION','LIVE_TESTNET')),
  status text not null default 'paused' check (status in ('active','paused','cancelled')),
  created_by uuid not null, created_at timestamptz not null default now()
);
create table market_quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source text not null, base text not null, quote text not null, price numeric not null,
  observed_at timestamptz not null, created_at timestamptz not null default now()
);
create table disputes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  milestone_id uuid references milestones(id), escrow_project_id numeric(78,0),
  opened_by uuid not null, status text not null default 'open' check (status in ('open','under_review','resolved')),
  summary jsonb, resolution jsonb, resolution_tx_hash text, created_at timestamptz not null default now()
);
create table dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  dispute_id uuid not null references disputes(id) on delete cascade,
  submitted_by uuid not null, document_id uuid not null references documents(id), created_at timestamptz not null default now()
);

create table audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  actor text not null, action text not null, subject text, detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_events_org_idx on audit_events(organization_id, created_at desc);
-- append-only, even for privileged roles
create function audit_events_immutable() returns trigger language plpgsql as $$ begin raise exception 'audit_events is append-only'; end $$;
create trigger audit_events_no_update before update or delete on audit_events for each row execute function audit_events_immutable();

create table notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null, title text not null, body text, read_at timestamptz, created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ row level security
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','memberships','agents','agent_tasks','agent_messages','ai_usage','treasuries','policies','policy_versions',
    'approvals','transactions','vendors','vendor_address_history','documents','document_access','invoices','procurements','bids',
    'grants','grant_applications','milestones','payroll_batches','revenue_records','governance_proposals','votes','strategies',
    'market_quotes','disputes','dispute_evidence','audit_events','notifications'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- organizations / memberships
create policy org_select on organizations for select using (is_member(id));
create policy org_insert on organizations for insert with check (created_by = auth.uid());
create policy org_update on organizations for update using (has_role(id, admin_roles()));
create policy mem_select on memberships for select using (user_id = auth.uid() or is_internal(organization_id));
-- a user may create the FIRST owner membership of an organization they created; everything else is admin-managed
create policy mem_insert_owner on memberships for insert with check (
  role = 'owner' and user_id = auth.uid() and exists (select 1 from organizations o where o.id = organization_id and o.created_by = auth.uid())
);
create policy mem_admin_write on memberships for insert with check (has_role(organization_id, admin_roles()) and role <> 'owner');
create policy mem_admin_update on memberships for update using (has_role(organization_id, admin_roles()) and role <> 'owner');

-- internal-read / role-write tables
do $$
declare r record;
begin
  for r in select * from (values
    ('agents','admin'),('agent_tasks','internal'),('treasuries','finance'),('policies','admin'),('policy_versions','admin'),
    ('transactions','finance'),('procurements','procurement'),('grants','admin'),('payroll_batches','finance'),
    ('revenue_records','finance'),('strategies','finance'),('market_quotes','finance'),('governance_proposals','admin'),
    ('vendor_address_history','finance'),('ai_usage','admin'),('notifications','none')
  ) as v(tbl, writer) loop
    execute format('create policy %I on %I for select using (is_internal(organization_id))', r.tbl || '_sel', r.tbl);
    if r.writer = 'admin' then
      execute format('create policy %I on %I for all using (has_role(organization_id, admin_roles())) with check (has_role(organization_id, admin_roles()))', r.tbl || '_wr', r.tbl);
    elsif r.writer = 'finance' then
      execute format('create policy %I on %I for all using (has_role(organization_id, finance_roles())) with check (has_role(organization_id, finance_roles()))', r.tbl || '_wr', r.tbl);
    elsif r.writer = 'procurement' then
      execute format('create policy %I on %I for all using (has_role(organization_id, procurement_roles())) with check (has_role(organization_id, procurement_roles()))', r.tbl || '_wr', r.tbl);
    elsif r.writer = 'internal' then
      execute format('create policy %I on %I for insert with check (is_internal(organization_id) and requested_by = auth.uid())', r.tbl || '_ins', r.tbl);
    end if;
  end loop;
end $$;
-- notifications: only the addressee
drop policy notifications_sel on notifications;
create policy notifications_own on notifications for select using (user_id = auth.uid());
create policy notifications_ack on notifications for update using (user_id = auth.uid());

-- external-party aware tables
create policy vendors_sel on vendors for select using (is_internal(organization_id) or user_id = auth.uid());
create policy vendors_wr on vendors for all using (has_role(organization_id, procurement_roles())) with check (has_role(organization_id, procurement_roles()));

create policy bids_sel on bids for select using (
  has_role(organization_id, procurement_roles()) or submitted_by = auth.uid()   -- a vendor sees only their own bid
);
create policy bids_ins on bids for insert with check (
  submitted_by = auth.uid() and has_role(organization_id, array['vendor']::org_role[])
  and exists (select 1 from procurements p where p.id = procurement_id and p.organization_id = bids.organization_id and p.status = 'open')
);

create policy apps_sel on grant_applications for select using (has_role(organization_id, admin_roles()) or applicant_user_id = auth.uid());
create policy apps_ins on grant_applications for insert with check (applicant_user_id = auth.uid() and has_role(organization_id, array['grant_applicant']::org_role[]));
create policy apps_upd on grant_applications for update using (has_role(organization_id, admin_roles()));

create policy docs_sel on documents for select using (
  uploaded_by = auth.uid()
  or exists (select 1 from document_access a where a.document_id = documents.id and a.user_id = auth.uid())
  or has_role(organization_id, admin_roles())
);
create policy docs_ins on documents for insert with check (uploaded_by = auth.uid() and is_member(organization_id));
create policy docacc_sel on document_access for select using (user_id = auth.uid() or has_role(organization_id, admin_roles()));
create policy docacc_ins on document_access for insert with check (
  exists (select 1 from documents d where d.id = document_id and d.organization_id = document_access.organization_id and (d.uploaded_by = auth.uid() or has_role(d.organization_id, admin_roles())))
);

create policy invoices_sel on invoices for select using (is_internal(organization_id) or exists (select 1 from vendors v where v.id = vendor_id and v.user_id = auth.uid()));
create policy invoices_ins on invoices for insert with check (is_member(organization_id));
create policy invoices_upd on invoices for update using (has_role(organization_id, finance_roles()));

create policy milestones_sel on milestones for select using (is_internal(organization_id) or exists (
  select 1 from procurements p join bids b on b.procurement_id = p.id where parent_type = 'procurement' and p.id = parent_id and b.submitted_by = auth.uid()
) or exists (select 1 from grant_applications g where parent_type = 'grant' and g.grant_id = parent_id and g.applicant_user_id = auth.uid()));
create policy milestones_wr on milestones for all using (has_role(organization_id, procurement_roles())) with check (has_role(organization_id, procurement_roles()));

create policy approvals_sel on approvals for select using (is_internal(organization_id));
create policy approvals_ins on approvals for insert with check (approver = auth.uid() and has_role(organization_id, finance_roles()));

create policy votes_sel on votes for select using (is_internal(organization_id) or has_role(organization_id, array['dao_member']::org_role[]));
create policy votes_ins on votes for insert with check (voter = auth.uid() and has_role(organization_id, array['dao_member','owner','administrator']::org_role[]));

create policy disputes_sel on disputes for select using (is_internal(organization_id) or opened_by = auth.uid());
create policy disputes_ins on disputes for insert with check (opened_by = auth.uid() and is_member(organization_id));
create policy disputes_upd on disputes for update using (has_role(organization_id, security_roles()));
create policy evidence_sel on dispute_evidence for select using (is_internal(organization_id) or submitted_by = auth.uid());
create policy evidence_ins on dispute_evidence for insert with check (submitted_by = auth.uid() and is_member(organization_id));

-- audit: readable by admins, security reviewers and auditors; written only by the service role (which bypasses RLS)
create policy audit_sel on audit_events for select using (has_role(organization_id, array['owner','administrator','security_reviewer','auditor']::org_role[]));
-- agent_messages: service role only (no policies => no access for users)
