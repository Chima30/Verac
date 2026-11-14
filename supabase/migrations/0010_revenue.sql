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
