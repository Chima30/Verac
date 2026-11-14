# Test report

Run: 2026-11-14, Windows 11, Node 22.23.4, pnpm 10.34.9, Foundry 1.9.0 (solc 0.8.24, evm `paris`).

| Suite | Command | Passed | Failed | Blocked | Untested |
|---|---|---|---|---|---|
| Contracts (Foundry, incl. fuzz 512 runs) | `cd contracts && forge test` | 55 | 0 | 0 | invariant suite not written |
| Policy engine + hash parity | `pnpm test` | 14 | 0 | 0 | |
| Payment pipeline / agents / message bus | `pnpm test` | 22 | 0 | 0 | |
| AI provider (mocked Gemini) | `pnpm test` | 24 | 0 | 0 | |
| Postgres RLS isolation (PGlite) | `pnpm test` | 14 | 0 | 0 | |
| TypeScript typecheck (5 packages) | `tsc -p` per package | clean | | | `apps/web` doesn't exist |
| Live testnet read probe | `pnpm chain:probe` | ok | | | account-specific reads need an address |
| Live Gemini call | `pnpm ai:probe` | not run | | 🔒 no `GEMINI_API_KEY` | |

## Covered (maps to the brief's list)

Contracts: deposit, approved/unauthorised withdrawal, per-tx and daily caps (+ UTC rollover), expiry (+ too-far expiry),
replay, approval binding (recipient/amount/agent changes), policy-version invalidation, guardian pause/revoke,
escrow funding via vault, milestone release, double release, dispute freeze + resolution, refund rules, role escalation,
reentrancy (vault and escrow), token decimals.

Unit/integration (TS): policy validation and conflicts, recipient/changed-address hold, payment idempotency, state
transitions, tool denial, message tampering/impersonation/replay/expiry, Gemini retry/429/timeouts/concurrency/limits,
invalid model output, missing key, secret detection, prompt-injection schema rejection, tenant isolation.

## Not covered yet (no claim made)

Wallet rejection and wrong-chain UI states, Playwright journeys, responsive layout, QoreSeal wrong-recipient decryption,
live EVM window / delegated-key behaviour, failed delegated execution events, expired-key rejection on chain, any
end-to-end flow, load testing, independent security review.

## Caveats

* RLS tests run on PGlite with a stubbed `auth.uid()`; they validate our policies, not a Supabase project.
* Contract fuzz tests are bounded unit-style properties, not a formal invariant suite.
