-- Activity: every member can read the audit events they caused themselves (the existing policy lets only owners, administrators,
-- security reviewers and auditors read all of them). Nobody gains write access: audit_events stays append-only.

create policy audit_own on audit_events for select using (actor = auth.uid()::text and is_member(organization_id));
