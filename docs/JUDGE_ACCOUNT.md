# Read-only judge account

Judges press **Enter as a judge** on `/start` and land in the live product, signed in as a read-only **auditor** of one
demo organisation. They can open every page, grant report, invoice and approval; the database refuses every change they
attempt (`supabase/migrations/0023_auditor_read.sql`, tested in `tests/security/auditor-read.test.ts`), and a banner on
every page says so. The credentials stay in the server's settings and are never sent to the browser.

## Set it up (about 10 minutes)

1. **Apply migration 0023** in the Supabase SQL editor: paste `supabase/migrations/0023_auditor_read.sql` and run it
   ("Success. No rows returned"). It only adds read access for auditors to the grants tables.
2. **Choose the demo organisation.** The judge sees everything in it, including member email addresses on the Team page.
   The cleanest choice is a fresh organisation run by a throwaway administrator account (no personal email):
   sign up with that account, create the organisation, then use the buttons that already exist:
   - Grants → **Load sample programme**, open the round, **Investigate with agents**;
   - Bills & Invoices → **Load the demo**, then run the agent workflow from the AI Command Center.
3. **Create the judge account** on your computer (the service-role key never leaves it):

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/setup-judge.mts
   ```

   This lists the organisations with their member, round and invoice counts. Then dry-run, then apply:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/setup-judge.mts --org <organisation id>
   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/setup-judge.mts --org <organisation id> --apply
   ```

   It creates `judge.verac@example.com` (or `--email …`) as an auditor and writes `JUDGE_EMAIL` and `JUDGE_PASSWORD` to
   `.secrets/judge.txt`. It refuses an address that already belongs to another organisation or has another role.
4. **Add the two lines to Vercel** as Sensitive variables and redeploy. `/api/health` then shows `"judge": "ready"`, and
   the black **For judges** panel appears on `/start`.

## What a judge can and cannot do

| Can | Cannot |
|---|---|
| Read the dashboard, treasury, approvals, invoices, milestones, activity and Live Proof | Request, approve, sign or execute a payment |
| Read grant rounds, submitted applications, the agents' evidence, scores, flags and questions | Recommend, award, reject, override a score or settle a flag |
| Download decision receipts | Read draft applications |
| Use the public tools (Quantum Simulator, address lookup) | Change any record: every write is refused by row-level security |

To revoke access, remove `JUDGE_PASSWORD` from Vercel (the button disappears), or delete the user in Supabase.
