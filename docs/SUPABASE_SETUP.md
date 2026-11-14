# Supabase setup (about 10 minutes, free tier)

Nothing here needs a secret in chat. The two values you copy are the project URL and the **anon (public) key**; the anon key is
designed to be public, and row-level security is what protects the data. Do **not** use the `service_role` key anywhere in this app.

1. Create a project at https://supabase.com (free). Pick any region. Save the database password somewhere safe; this app does not need it.
2. **Create the tables:** Dashboard -> SQL Editor -> New query -> paste the whole of `supabase/migrations/0001_core.sql` -> Run.
   It should finish with "Success". (It creates 31 tables with row-level security forced on.)
   Then do the same, one at a time and in order, for `0002_creator_membership.sql`, `0003_approvals.sql`, `0004_procurement.sql`, `0005_payroll.sql`, `0006_milestones.sql`, `0007_governance.sql`, `0008_disputes.sql`, `0009_grants.sql`, `0010_revenue.sql`, `0011_vault.sql` and `0012_activity.sql`. Skipping 0002 breaks creating an organisation; skipping 0003 breaks Approvals and Tasks; skipping 0004 breaks Procurement; skipping 0005 breaks Payroll; skipping 0006 breaks Milestones; skipping 0007 breaks Governance; skipping 0008 breaks Disputes; skipping 0009 breaks Grants; skipping 0010 breaks Revenue; skipping 0011 breaks the Document Vault; skipping 0012 means non-admin members see an empty Activity feed.
3. **Auth settings:** Dashboard -> Authentication -> Providers -> Email. For a quick demo turn **Confirm email** off, otherwise new
   accounts must click a link in an email first.
4. **Copy the two public values:** Dashboard -> Project Settings -> API -> `Project URL` and `anon public` key.
5. **Local:** create `apps/web/.env.local` containing
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
   ```
6. **Vercel:** Project -> Settings -> Environment Variables -> add the same two names for Production, then Redeploy.

Without these two variables the app stays public and read-only, and `/login` says sign-in is not configured.

## What works once connected
Sign up / sign in with email and password, a session that refreshes on every request, protected pages (organisation, team, audit,
tasks, approvals, activity), creating an organisation (you become its owner), linking the deployed testnet contracts to it, and listing
members and audit events. Everything runs as the signed-in user, so row-level security decides what each person can see.

## What does not exist yet
Invites (no email service), role changes, wallet linking, and server-side audit writes (users are deliberately unable to write audit events).
The flow above has been type-checked and built but has **not** been exercised against a real Supabase project yet.
