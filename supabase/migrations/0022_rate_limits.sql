-- 0022: request rate limits shared by every server instance.
-- The website's serverless instances do not share memory, so a per-instance counter lets a client multiply its allowance
-- by the number of instances. This keeps one counter per key and fixed window in Postgres. Only the server (service
-- role) can call it; signed-in users and anonymous visitors cannot read or reset counters. Re-runnable.

create table if not exists rate_limit_hits (
  key text not null check (length(key) between 1 and 200),
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table rate_limit_hits enable row level security; -- no policies: nobody reads it through the API

-- Counts one request for p_key in the current p_window_seconds window. Returns the count so far in this window, and
-- whether it is within p_max. Old windows are removed now and then, so the table stays small.
create or replace function take_rate_limit(p_key text, p_window_seconds int, p_max int)
returns table (allowed boolean, hits int, retry_after_seconds int)
language plpgsql security definer set search_path = public as $$
declare
  w timestamptz;
  n int;
begin
  if p_window_seconds < 1 or p_window_seconds > 86400 or p_max < 1 then raise exception 'take_rate_limit: bad window or limit'; end if;
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into rate_limit_hits as r (key, window_start, hits) values (p_key, w, 1)
    on conflict (key, window_start) do update set hits = r.hits + 1
    returning r.hits into n;
  if random() < 0.01 then delete from rate_limit_hits where window_start < now() - interval '1 day'; end if;
  return query select n <= p_max, n, greatest(1, ceil(extract(epoch from (w + make_interval(secs => p_window_seconds) - now())))::int);
end $$;

revoke all on table rate_limit_hits from public;
revoke all on function take_rate_limit(text, int, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on table rate_limit_hits from anon; revoke all on function take_rate_limit(text, int, int) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on table rate_limit_hits from authenticated; revoke all on function take_rate_limit(text, int, int) from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function take_rate_limit(text, int, int) to service_role'; end if;
end $$;
