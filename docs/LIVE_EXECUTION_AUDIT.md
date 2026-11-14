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

## Not done yet

Everything in phases 2 to 7. No website-triggered transaction has been sent.
