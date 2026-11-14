-- Fix: the "first owner" membership policy checked `exists (select 1 from organizations ...)`, but that subquery is itself
-- subject to RLS and a brand-new creator is not a member yet, so it could never pass (found when testing on real Supabase).
-- Use SECURITY DEFINER helpers (same pattern as is_member) so the check bypasses RLS while still being strict.

create function is_org_creator(org uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from organizations o where o.id = org and o.created_by = auth.uid())
$$;

create function org_has_owner(org uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.organization_id = org and m.role = 'owner')
$$;

drop policy mem_insert_owner on memberships;
create policy mem_insert_owner on memberships for insert with check (
  role = 'owner' and user_id = auth.uid() and is_org_creator(organization_id) and not org_has_owner(organization_id)
);
