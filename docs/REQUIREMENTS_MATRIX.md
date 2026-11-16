# Requirements matrix

Legend: ✅ implemented and tested locally · 🟡 partly · ⬜ not started · 🔒 blocked on something only you can supply.
"Tested" means an automated test ran and passed on 2026-11-14 (see [TEST_REPORT.md](TEST_REPORT.md)). Nothing here has
been deployed to the testnet yet.

## Hackathon (Post-Quantum AI Agents) - from build.qorechain.io/rules and the brief

| Requirement | State | Where / evidence |
|---|---|---|
| Public GitHub repo, README, MIT/Apache-2.0 licence | 🟡 README + MIT done; repo not pushed 🔒 | `README.md`, `LICENSE` |
| Featured image, ≤3 min video, testnet address(es) | ⬜ | needs deployed addresses first |
| Original work, third-party credits | ✅ | README credits |
| Scoped EVM authorisation (window) | ⬜ | docs read; builder: `openEvmWindowMsg` (SDK 0.14.0 verified exported) |
| Transaction / value / duration / target limits | 🟡 contract-side done; window-side ⬜ | `TreasuryVault` tests; window not opened yet |
| Smart-account spending rules for delegated keys | ⬜ | `linkAuthenticatorMsgs` exported; AA enabled on testnet (probe) |
| Authenticated agent messaging | ✅ | `messaging.ts`, 6 tests |
| ML-DSA-87 key registered, hybrid-signed native tx | ⬜ 🔒 | needs funded throwaway account |
| Q-Day drill (optional, register by 2026-11-17 23:59 UTC) | ⬜ 🔒 | needs account + ECDSA key handed to organisers |
| `AI_USAGE.md` (special award) | ✅ draft | `docs/AI_USAGE.md` |

> Updated 2026-11-16: the category requirements are tracked requirement by requirement, with evidence status, in [CATEGORY_COMPLIANCE.md](CATEGORY_COMPLIANCE.md). That file supersedes the category rows below where they differ.

## Platform requirements (from the brief)

| Req | State | Notes |
|---|---|---|
| Multi-tenant orgs, 10 roles, RLS | ✅ schema + 14 isolation tests; ⬜ app auth flow | `0001_core.sql` |
| Payment pipeline with the 11 states | ✅ | `pipeline.ts`; DB persistence ⬜ |
| Approvals bound to exact tx details | ✅ contract + TS hash parity | `HashVector.t.sol`, `policy-engine.test.ts` |
| Idempotency, no double payment | ✅ | pipeline + DB uniques + `AlreadyExecuted` |
| Contracts: registry/vault/policy/escrow/anchor | ✅ not deployed | 55 Foundry tests |
| Gemini provider, free tier, usage dashboard data | ✅ provider; ⬜ dashboard UI; ⬜ live call 🔒 key | `ai-provider` |
| 15 agents with schemas/tools/permissions | 🟡 specs + tool gating ✅; per-agent prompts/schemas ⬜ | `agents.ts` |
| QoreSeal vault | ⬜ | `@qorechain/qoreseal@0.1.0` on npm; offline seal/open doc-verified |
| Web UI + every nav route functional | ⬜ | |
| Playwright e2e | ⬜ | |

## The 12 modules

| # | Module | State |
|---|---|---|
| 1 | Treasury Assistant | ⬜ (reads via `QoreReader` ready) |
| 2 | Bill Payer / Invoice Fraud | 🟡 pipeline + duplicate-invoice DB constraint; detection logic/UI ⬜ |
| 3 | Procurement | 🟡 schema + escrow contract + RLS bid confidentiality; flow/UI ⬜ |
| 4 | Grants & milestones | 🟡 schema + same escrow; flow/UI ⬜ |
| 5 | Document vault | ⬜ |
| 6 | Policy builder | 🟡 validation, conflicts, consequence text ✅; NL→JSON agent + UI ⬜ |
| 7 | Threat response / simulator | ⬜ (pause/revoke exist on contracts) |
| 8 | Payroll & revenue | ⬜ (tables only) |
| 9 | DAO governance | ⬜ (tables only; marked application-level, not native) |
| 10 | DCA / rebalancing | ⬜ (tables only) |
| 11 | Arbitrage lab | ⬜ (tables only) |
| 12 | Disputes | 🟡 escrow dispute/resolve ✅; evidence/AI summary/UI ⬜ |
