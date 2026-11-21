# Read-only demo for judges and visitors

Judges sign in with **their own email** and choose **Explore the demo** on the welcome screen. That adds them to one demo
organisation as a read-only **auditor**: they can open every page, grant report, invoice and approval, and the database
refuses every change they attempt (`supabase/migrations/0023_auditor_read.sql`, tested in
`tests/security/auditor-read.test.ts`). A banner on every page says they are read-only. No password is shared.

## Set it up (about 15 minutes, once)

1. **Apply migration 0023** in the Supabase SQL editor: paste `supabase/migrations/0023_auditor_read.sql` and run it
   ("Success. No rows returned"). It only adds read access for auditors to the grants tables.
2. **Make the demo organisation.** Everyone who chooses Explore the demo sees everything in it, including member email
   addresses on the Team page, so use a separate account with no personal email (for example a new mailbox you made
   for the demo). Sign up with it, create an organisation such as "Verac demo", then fill it with the existing buttons:
   - Grants → **Load sample programme**, open the round, **Investigate with agents**;
   - Bills & Invoices → **Load the demo**, then run the invoice workflow from the AI Command Center.
3. **Copy the organisation's id.** In Supabase → Table Editor → `organizations`, copy the `id` of "Verac demo".
4. **Add `DEMO_ORG_ID`** with that id to Vercel (Settings → Environment Variables) and redeploy. `/api/health` then shows
   `"demo": "ready"`, `/start` shows **Sign in to explore**, and the welcome screen offers **Explore the demo**.

## What a visitor in the demo can and cannot do

| Can | Cannot |
|---|---|
| Read the dashboard, treasury, approvals, invoices, milestones, activity and Live Proof | Request, approve, sign or execute a payment |
| Read grant rounds, submitted applications, the agents' evidence, scores, flags and questions | Recommend, award, reject, override a score or settle a flag |
| Download decision receipts | Read draft applications |
| Create their own, separate organisation later | Change any record in the demo: every write is refused by row-level security |

To close the demo, delete `DEMO_ORG_ID` from Vercel (the option disappears). To remove someone, delete their row in
`memberships` for the demo organisation.
