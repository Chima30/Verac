# Implementation plan

Deadline: **2026-12-02 23:59 UTC** (18 days from 2026-11-14). Q-Day drill registration (optional): **2026-11-17 23:59 UTC**.

## Done (this branch, `feat/foundation`)

- [x] Repo, pnpm workspace, Foundry project, licence, `.env.example`
- [x] Docs read; SDK 0.14.0, QoreSeal 0.1.0, `@google/genai` 3.3.0 verified on npm; free Gemini models verified
- [x] 5 contracts + 55 tests
- [x] Policy engine, payment pipeline, coordinator, message bus (60 tests)
- [x] Gemini provider with free-tier controls (24 tests)
- [x] Postgres schema + RLS (14 tests)
- [x] Live read-only testnet probe

## Next, in priority order

**P1: security + payment foundation (target 11-15 → 11-18)**
1. 🔒 You: create a throwaway testnet account, fund from the faucet (100 QOR/24h), register at build.qorechain.io.
2. `packages/qorechain` signer: derive account, register ML-DSA-87 key, first hybrid-signed native tx (`createClient`, `connectTx`, `signAndBroadcastHybrid`).
3. Open/read/close an EVM window; prove "classical key alone cannot open one" with the SDK rejection classifier.
4. Deploy the 5 contracts (🔒 needs your OK); record addresses in `TESTNET_PROOFS.md`.
5. Delegated agent authenticator with spending rule (`linkAuthenticatorMsgs`); one permitted and one denied vault payment, verified from receipts/events.
6. Drill account registration before 11-17 23:59 UTC if you want the Survivor award.

**P2: encrypted procurement → escrow (11-19 → 11-22)**
QoreSeal vault (key publishing, sealing bids, decrypt in browser), tender + bid flows, Procurement agent scoring, escrow funding via `fundEscrow`, milestone release.

**P3: treasury/invoice/approvals UI and agent behaviours (11-23 → 11-26)**
Next.js shell, auth, org onboarding, approvals queue, Treasury + Invoice Fraud + Policy agents with Zod schemas and tests.

**P4/P5 (11-27 → 11-29):** grants, payroll, revenue, governance, disputes, DCA/arbitrage as labelled simulations.

**Hardening (11-30 → 12-02):** Playwright, security scenarios, README/evidence, 3-minute video, submission.

## Cut line

If time runs short, protect: (1) real agent payment under on-chain limits, (2) encrypted doc opened by authorised recipient,
(3) real escrow milestone payment, (4) a real rejected attack. Secondary modules ship as clearly labelled partial.
