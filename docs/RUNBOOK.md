# Runbook: operating Verac on Diana testnet

What to do when something goes wrong, in order of urgency. Every command below is a **dry run by default**: it simulates
against the live chain and prints what it would send. Add `--broadcast` to send. All amounts are testnet QOR.

## 1. Something is moving money that should not

Stop payments first, investigate second. Each step is independent; do as many as apply.

| Do this | Effect | Who | Undo |
|---|---|---|---|
| Vercel → Settings → Environment Variables: `LIVE_EMERGENCY_STOP=true`, then redeploy | The website refuses to propose, approve or execute any payment | Vercel project owner | Remove it and redeploy |
| `npx tsx packages/qorechain/scripts/owner-ops.ts pause --broadcast` | The original vault (V1) refuses every payment, from anyone | V1 owner (or a guardian) | `owner-ops.ts unpause --broadcast` (owner only) |
| `npx tsx packages/qorechain/scripts/owner-ops.ts revoke-agent --broadcast` | The V1 agent key can no longer pay | V1 owner (or a guardian) | `owner-ops.ts set-agent-limits --days N --broadcast` |
| `npx tsx packages/qorechain/scripts/v2-guardian.ts pause --broadcast` | TreasuryVault V2 refuses every payment | V2 guardian | Two administrators sign an Unpause (`v2-admin-action.ts`) |
| `npx tsx packages/qorechain/scripts/v2-guardian.ts revoke-agent --broadcast` | The V2 agent key can no longer pay | V2 guardian | Two administrators restore its limits |

Pausing and revoking only reduce risk: none of them can move funds. A compromised server key cannot undo them.

## 2. A key may be exposed

| Key | Blast radius while exposed | Response |
|---|---|---|
| V1 agent (`AGENT_EVM_PRIVATE_KEY`) | At most 10 QOR per payment, 20 per day, only to approved recipients, only with an approval, only inside its vault-only window | Revoke the agent (section 1), create a new key, `set-agent-limits` for the new address, update Vercel |
| V1 approver (`APPROVER_*`) | Can approve, not pay; payments still need the agent and the caps | `owner-ops.ts set-approver` for a new key; remove the old one; update Vercel |
| V1 owner (`.secrets/testnet-account.json`, never on the server) | Full control of V1 | Pause V1, move remaining QOR out, retire V1; V2 has no owner |
| V2 agent (`V2_AGENT_*`) | Cannot pay at all without two administrators' ML-DSA-87 signatures | Guardian revoke; administrators set limits for a new agent |
| One V2 administrator key | None alone (threshold 2 of 3) | The other two replace it with a RemoveAdmin and AddAdmin action |
| Supabase service role key | Database rows, not funds: the chain enforces caps and approvals | Rotate it in Supabase, update Vercel, redeploy; review `audit_logs` |
| `GEMINI_API_KEY` | AI quota and cost only; the AI has no payment tools | Rotate in Google AI Studio, update Vercel |
| `CRON_SECRET` | Can trigger the daily grants monitor early | Rotate in Vercel |

## 3. The site is down or misbehaving

1. `GET /api/health` reports the chain, the database and which features are configured (states only, no values). It
   answers 503 when a dependency is down or a switched-on feature is misconfigured.
2. Vercel → Logs. At start-up each server instance logs `[config] …` for every missing or malformed setting, by name.
3. Diana down: payments fail safely (`FAILED` with the reason, nothing moved); reads show "unavailable". Wait and retry.
4. Gemini quota exhausted: the AI pauses and the workflows continue by fixed rules; nothing is invented.
5. Rate limits: API routes answer 429 with `Retry-After`. Limits are shared by all instances once migration 0022 is
   applied; without it each instance counts on its own.

## 4. Routine checks

| When | Check | How |
|---|---|---|
| Every push | Typecheck, 500+ tests, website build | GitHub Actions `CI` |
| Contract changes | Foundry unit, fuzz and invariant tests | GitHub Actions `Contracts` |
| Weekly and on doc changes | Every transaction quoted in docs/ is on chain with the stated outcome | GitHub Actions `Proof` (`pnpm proof:check`) |
| Daily 06:00 UTC | Funded grants' repository activity re-read | Vercel cron `/api/cron/grants-monitor` |
| Before agent rights expire | V1 agent valid to 2026-12-06, V2 agent to about 2026-12-03 | `owner-ops.ts set-agent-limits --days N`; V2 by two administrators |

## 5. Data

Supabase holds organisation data, approvals, audit logs and reports; the chain holds the money and the authoritative
payment record. On the free plan Supabase keeps daily backups for a short period only: export important tables
(`audit_logs`, `transactions`, `grant_reviews`, `grant_funding_records`) before any risky migration. Migrations are
re-runnable and are tested on an in-memory Postgres in CI.
