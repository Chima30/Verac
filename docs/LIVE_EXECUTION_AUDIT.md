# Live execution: audit and plan (branch `feat/live-execution`)

Status as of 2026-11-15. Nothing here claims a feature works unless it is listed under "Verified".

## What already exists

| Area | State |
|---|---|
| Contracts | Five contracts deployed on Diana (`deployments/diana-testnet.json`), sources in `contracts/src`, Foundry tests in `contracts/test`. Not source-verified on an explorer, no external audit. |
| Payment pipeline | `services/agent-coordinator/src/pipeline.ts`: propose, validate, approvals, simulate, submit, verify receipt, with idempotency keys and an in-memory store. Its chain steps are injected (`PipelineDeps`) and had no real implementation. |
| Policy engine | `services/policy-engine`: payment evaluation, invoice, grants, procurement, payroll, strategies, and `computePaymentHash`. |
| Live evidence | `docs/LIVE_RUN_2026-11-14.md`: payments, caps, approvals, escrow funding and release, all run from shell scripts (`scripts/demo-escrow.sh`), not from the web app. |
| Chain access | `packages/qorechain`: read-only (balances, PQC key, EVM window, spending rules). `scripts/chain-tx.ts` signs native messages from a local throwaway key file. |
| Website | All 12 module pages, Supabase auth and organisation data (migrations 0001 to 0013), Live Proof page, AI routes. No wallet connection and no transaction button. |

## Gaps this work closes

1. No code connects the pipeline to the real contracts (simulate, submit, receipt).
2. No database-backed operation store, so no durable approval and transaction state.
3. No wallet connection in the website.
4. No website path that sends a transaction.
5. The Integrations page showed a hard-coded "NOT CONNECTED IN UI" for Supabase although the app already uses it. It now probes the real auth endpoint.

## Signing model (what QoreChain allows)

- A page cannot hold the ML-DSA-87 key. QoreX signs native messages itself through `window.qorex.native.signAndBroadcast` (hybrid signature). That is the supported way for a user to open or close their own EVM window from the browser.
- QoreX's EVM provider does not support `eth_sendTransaction`, so contract calls cannot be signed in the user's wallet today. This work does not pretend otherwise.
- Contract calls are therefore signed by a **server-side delegated agent key**. Its authority is bounded on chain by the vault: per-transaction cap, daily cap, expiry, recipient list, approval threshold, and revocation. It is a development signing path, not a user-signed one.
- The agent account needs an open EVM window to send EVM transactions, and opening one needs its ML-DSA key. The signer service has to hold both keys for the throwaway agent account. They live only in server environment variables, never in browser code, never in an API response.
- Human approvals are recorded in Verac by an authenticated administrator. The on-chain `approvePayment` is then sent by an approver account, bound to the exact payment hash (any change to the payment changes the hash and voids the approval). This makes the approver a relayer; that is stated in the UI.

## Phases

1. **Chain service (done, verified below).** ABIs from the real sources, read, simulate, receipt verification and event decoding, revert decoding.
2. **Durable state.** Migration for operations, approvals, receipts, security alerts; idempotency enforced by unique keys; RLS; service key server-side only.
3. **Signer.** Restricted signer interface and server implementation; window management; caps hard-coded in code as well as on chain; refuses any contract or function outside an allow-list.
4. **Pipeline wiring.** Real `PipelineDeps`, API routes (propose, approve, reject, execute, status), Gemini proposes structured actions only.
5. **Wallet.** Connect, address, QOR balance, chain 9800 check, PQC key, window status, open and close through `signAndBroadcast`, disconnect, clear errors.
6. **Pages.** Treasury, Approvals, Procurement, Grants and Milestones, Command Center, Activity and Live Proof wired to the above.
7. **Live runs.** Each live transaction is shown first (exact operation, amount, recipient) and run only after approval, with small amounts. Results are appended to a new live-run report.

## Verified so far

- Offline: addresses equal the deployment file; custom errors decode; receipt verification accepts only events emitted by the vault or escrow, and treats a reverted receipt as failure (9 tests).
- Live, read only, against Diana (4 tests, no keys, no transactions): chain id 9800, code present at all five addresses, the TypeScript payment hash equals `TreasuryVault.paymentHash`, the agent's limits and the vault balance read back, and a simulated over-cap payment is rejected with the contract's own `ExceedsPerTxCap`.

- Offline: signer (13 tests: builds its own calldata, 10 QOR cap, role separation, kill switch, key never exposed), window manager (4), executor (14, with fakes: claim once, re-derive hashes, relay approval, simulate, send, verify, every refusal path). Database rules (21 tests on PGlite: separation of duties, idempotency, double-claim, append-only audit, no direct writes). Full suite 307 passing on 2026-11-15.
- On chain (2026-11-15, see LIVE_SETUP_2026-11-15.md): owner tightened the agent to 10 QOR per payment, 20 per day, no auto-approve; a separate approver account was created, funded, its post-quantum key registered, and added to the vault. Each was dry-run first and read back from the chain.
- Website: migration 0014 applied on the hosted Supabase; the Treasury page on the branch deployment shows the live chart and the Live payments card.

## Status of the phases

| Phase | State |
|---|---|
| 1 Chain service | Done, verified |
| 2 Durable state (migration 0014) | Done, applied |
| 3 Signer and windows | Done, offline-tested; used for the owner setup transactions (window open, send, close) but not yet by the website's agent and approver |
| 4 Pipeline and routes (propose, decide, execute, status) | Built and type-checked; **not exercised end to end from the website** |
| 5 Wallet (QoreX) | Not started |
| 6 Pages | Treasury done. Approvals, Live Proof, Command Center, Procurement, Grants, Milestones in progress or not started |
| 7 Live runs | Setup done. **First website payment confirmed on chain: 1 QOR, 2026-11-15** (see `docs/LIVE_PAYMENT_2026-11-15.md`) |

## Known gaps

- Milestone approval needs the project's reviewer account on chain (project 1's reviewer is the owner); the server does not hold that key, so milestone release is not wired.
- Playwright end-to-end tests and the Foundry suite have not been run in this environment (`forge` is not installed locally).
- Gemini only drafts. `POST /api/live/ask` turns plain English into the request form's fields; the address and amount must appear literally in what the person wrote, the amount is capped at 10 QOR, and nothing is requested, approved or sent from that route. A person still presses Request, a different administrator approves, and the vault enforces its limits.
- Migration `0015_live_decision_guard.sql` closes a bypass: the generic `decide_payment` could otherwise decide a live row without re-authentication. It must be applied in the Supabase SQL editor on the hosted database; until it is, that hole exists there.
- The QoreX wallet panel is connect and display only. QoreX has no `eth_sendTransaction`, so contract calls stay server-signed.
