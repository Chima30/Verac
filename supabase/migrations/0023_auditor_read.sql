-- 0023: auditors can READ the grants work, so a read-only reviewer (for example a hackathon judge) sees what the agents
-- found. Each policy below only adds SELECT for the 'auditor' role; there are no insert, update or delete policies, and
-- every grants function already refuses an auditor, so nothing an auditor does can change a record or move money.
-- Drafts stay private to their applicant. Re-runnable.

do $$
declare t text;
begin
  foreach t in array array['grant_application_versions','grant_rubrics','grant_evidence','grant_reviews','grant_risk_flags',
                           'grant_conflicts','grant_overrides','grant_clarifications','grant_milestone_submissions','grant_funding_records'] loop
    execute format('drop policy if exists %I on %I', t || '_auditor_read', t);
    execute format('create policy %I on %I for select using (has_role(organization_id, array[''auditor'']::org_role[]))', t || '_auditor_read', t);
  end loop;
end $$;

drop policy if exists grant_applications_auditor_read on grant_applications;
create policy grant_applications_auditor_read on grant_applications for select
  using (status <> 'draft' and has_role(organization_id, array['auditor']::org_role[]));
