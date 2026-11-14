# Architecture

## Shape

```
Web app (Next.js)  ─┐                        ┌─ Supabase: Postgres+RLS, Auth, Storage (ciphertext only)
QoreX / wallets    ─┼─► API routes ─► Coordinator ─► Agents (15) ─► AI provider (Gemini, shared)
                    │        │             │
                    │        │             └─► Payment pipeline ─► Policy engine (deterministic)
                    │        └─ audit_events (append-only)            │
                    └──────────────────────────────────────────────► Transaction service ─► QoreChain Diana
                                                                         (simulate, sign, receipt, events)
```

Implemented today: `shared-types`, `policy-engine`, `ai-provider`, `agent-coordinator`, `qorechain` (read-only),
`contracts`, `supabase/migrations`. Not yet: `apps/web`, `transaction-service`, `risk-analysis`, worker runtime.

## Trust boundaries

1. **LLM output is untrusted.** It is parsed against a strict Zod schema (unknown keys rejected) and can only be a
   recommendation or a draft. Third-party text is wrapped in `<untrusted>` blocks and the system prompt says it is data.
2. **Deterministic code decides.** `evaluatePayment` mirrors the contract limits; it is a pre-check, not the authority.
3. **The contract is the authority.** `TreasuryVault` re-checks everything on chain; a bug or compromise in the app
   cannot exceed the agent's on-chain limits.
4. **Humans approve exact payments.** Approvals are recorded on chain against the payment hash.
5. **Tenants are isolated by RLS**, and external parties (vendors, applicants) see only their own rows.

## Payment pipeline (`services/agent-coordinator/src/pipeline.ts`)

States: `PROPOSED → VALIDATING → AWAITING_APPROVAL → APPROVED → SIMULATING → READY → SUBMITTED → CONFIRMED`,
plus terminal `REJECTED | FAILED | CANCELLED`. `FAILED` is terminal: a retry is a new operation with a new
idempotency key. `CONFIRMED` requires a successful receipt **and** the vault event for this exact payment hash.
The same idempotency key with different details throws `IdempotencyConflict`. On chain, a repeated payment hash
reverts `AlreadyExecuted`, so a crash/restart cannot double-pay.

## Contracts

| Contract | Role |
|---|---|
| `OrganizationRegistry` | Orgs, one role per member, Owner-only admin changes, contract references |
| `PolicyManager` | Active policy version + hash; owner/guardian revoke; version 0 blocks the vault |
| `TreasuryVault` | Native + allow-listed ERC-20; agent limits; approvals; pause; `fundEscrow` for typed escrow funding |
| `MilestoneEscrow` | Procurement/grant projects; milestones; disputes; resolvers; refunds |
| `AuditAnchor` | Anchor hashes (documents, approvals) without content |

Design choices worth knowing:
* Non-upgradeable; `policyManager` is immutable in the vault (no way to repoint it to a permissive one).
* No arbitrary `call` from agents: `executePayment` (transfer) and `fundEscrow` (typed call to a registered escrow
  whose project's payer must be the vault and whose token must match).
* Owner configures; owner cannot spend. Funds leave only via agents + approvals. Trade-off: if every agent and approver
  is lost, funds need an agent re-registered by the owner (owner can re-add agents but approvals still apply).
* ERC-20 limits are per token in token base units (decimals respected); the EVM window does not price tokens.

## QoreChain integration plan (from the v3.2.8 docs, 2026-11-14)

* **EVM window** (`MsgOpenEVMWindow`, hybrid-signed native): bounds blocks (≤17,280), tx count (≤1,000), native value
  plus max fee, and `allowed_targets` (≤16). Tokens are not priced: bound ERC-20 via targets/contract rules.
  Contract creation needs an unscoped window.
* **Delegated agent keys** (`x/abstractaccount`, enabled on testnet): `MsgUpdateSpendingRules` +
  `MsgRegisterAuthenticator` with `possession_proof` (SDK 0.14.0 `linkAuthenticatorMsgs`). Rules bind only delegated
  keys, never the owner root key, so the vault enforces its own limits independently.
* **Verify failures from events**, not only tx code (`abstractaccount_execution_failed`).
* **QoreSeal** for documents: ML-KEM-1024 + X25519 hybrid, multi-recipient, purpose-bound (`purpose: "bid:<id>"`).
  Revoking a recipient cannot un-read what they already decrypted.

## Free-tier AI operation

Single `AiProvider`: concurrency semaphore, RPM window, per-global/org/user daily counters, 429 handling with free
fallback model then provider pause, timeouts, output-token and input-size caps, secret detection (keys/seed phrases
are never sent), metadata-only usage records. If unconfigured or exhausted it throws; it never fabricates output and
never switches to a paid model (`AI_FREE_TIER_ONLY` + a verified free-model allow-list).
