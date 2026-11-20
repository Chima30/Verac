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
| One V2 administrator key | None alone (threshold 2 of 3) | Replace it (section 2a). The exposed key cannot stop the replacement |
| Supabase service role key | Database rows, not funds: the chain enforces caps and approvals | Rotate it in Supabase, update Vercel, redeploy; review `audit_logs` |
| `GEMINI_API_KEY` | AI quota and cost only; the AI has no payment tools | Rotate in Google AI Studio, update Vercel |
| `CRON_SECRET` | Can trigger the daily grants monitor early | Rotate in Vercel |

### 2a. Replacing a V2 administrator key (lost, exposed, or moving to a new device)

Add the new key first, then remove the old one, so the vault never has fewer administrators than its threshold.
Each step is signed by two administrators **on their own computers**; no computer ever holds two keys.

1. **New administrator, on their own computer:** `pnpm v2:admin-key create <folder>`. It prints an EVM address
   (to share) and a qor1… address. Send about 1 testnet QOR to the qor1… address for the fee, then
   `pnpm v2:admin-key register <folder> --broadcast` registers the ML-DSA-87 key with proof of possession.
   `pnpm v2:admin-key status <folder>` shows what the vault will see.
2. **Anyone:** `pnpm v2:admin-action prepare add-admin <new 0x> --out add.json`. It refuses a key that is not
   registered and proven, and refuses the agent or relayer key.
3. **Two current administrators, each on their own computer:** `pnpm v2:admin sign <their folder> add.json`. The tool
   decodes the change from the request itself ("Add administrator 0x…"), checks it against the live vault and asks for yes.
4. **Whoever holds the relayer key:** `pnpm v2:admin-action relay add.json add.signature-*.json --broadcast`. It checks
   every signature against the signer's registered key before sending; the vault checks again on chain.
5. Repeat 2 to 4 with `remove-admin <old 0x>`. It refuses if that would leave fewer administrators than the threshold.

Without `--broadcast` every step simulates against the live vault and sends nothing. A request is valid for 24 hours and
only until any other administrative change is made (the admin nonce moves on).

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
