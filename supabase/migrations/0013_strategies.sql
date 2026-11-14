-- Strategies: saved simulation inputs (DCA, rebalancing, arbitrage). Always SIMULATION and always paused: there is no venue, so nothing
-- is ever executed. A saved strategy is only the numbers someone typed in. Direct writes are removed; the mode cannot be changed.

drop policy strategies_wr on strategies;

create function save_strategy(p_org uuid, p_kind text, p_config jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; me uuid := auth.uid();
begin
  if me is null or not has_role(p_org, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if p_kind not in ('dca', 'rebalance', 'arbitrage') then raise exception 'kind must be dca, rebalance or arbitrage'; end if;
  if jsonb_typeof(p_config) <> 'object' or length(p_config::text) > 8000 then raise exception 'invalid configuration'; end if;
  if length(trim(coalesce(p_config->>'name', ''))) not between 1 and 80 then raise exception 'a name of 1 to 80 characters is required'; end if;
  insert into strategies(organization_id, kind, config, mode, status, created_by) values (p_org, p_kind, p_config, 'SIMULATION', 'paused', me) returning strategies.id into sid;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p_org, me::text, 'strategy.saved', sid::text, jsonb_build_object('kind', p_kind, 'mode', 'SIMULATION'));
  return sid;
end $$;

create function cancel_strategy(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare s strategies%rowtype; me uuid := auth.uid();
begin
  select * into s from strategies where id = p_id for update;
  if not found or me is null or not has_role(s.organization_id, finance_roles()) then raise exception 'not allowed: finance role required'; end if;
  if s.status = 'cancelled' then raise exception 'already cancelled'; end if;
  update strategies set status = 'cancelled' where id = s.id;
  insert into audit_events(organization_id, actor, action, subject) values (s.organization_id, me::text, 'strategy.cancelled', s.id::text);
end $$;

revoke all on function save_strategy(uuid, text, jsonb), cancel_strategy(uuid) from public;
grant execute on function save_strategy(uuid, text, jsonb), cancel_strategy(uuid) to authenticated;
