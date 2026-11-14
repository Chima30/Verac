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
