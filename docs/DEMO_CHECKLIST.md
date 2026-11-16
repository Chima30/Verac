# Demo and submission checklist

## Before recording

- [x] Workflow deployed to production (feat/foundation, 2026-11-16).
- [ ] Migrations `0016_agent_workflows.sql` and `0017_demo_reset.sql` applied to the hosted Supabase project.
- [ ] `AGENT_MESSAGE_ROOT_SECRET` set in Vercel (Sensitive). Optional: `CRON_SECRET`, `LIVE_APPROVER_ADDRESS`.
- [ ] Live execution on: `LIVE_EXECUTION_ENABLED=true`, agent and approver keys set, `LIVE_EMERGENCY_STOP` unset.
- [ ] Vault balance at least 2 QOR; the agent's daily allowance not used up (Treasury → Agent spending rules).
- [ ] Two accounts in one organisation: a finance manager and a different administrator.
- [ ] Demo invoices loaded (Bills & Invoices → Load the three-invoice demo).
- [ ] Optional: category proofs run from a dedicated test account (see TESTNET_PROOFS.md), so Live Proof shows B, D, E and F with evidence.
- [ ] Browser zoom 100%, light or dark theme chosen, notifications off.

## Acceptance criteria (status at 2026-11-16)

| Criterion | Status | Evidence |
|---|---|---|
| Multi-agent coordination: an instruction makes several agents process permitted records and return one evidence-backed result | **Done on the deployed site, 2026-11-16** (and by automated tests) | `invoice-review.test.ts` (14), `engine.test.ts` (8), `workflows.test.ts` (10) |
| Payment execution: an eligible invoice becomes an exact request, is approved properly and executes through the existing pipeline | **Verified on chain, 2026-11-16**: 1.25 QOR for DEMO-A-101, tx `0x5007c5d6…8dd6`, block 10202342 | LIVE_WORKFLOW_2026-11-16.md |
| Security enforcement: each category requirement shown by real configuration and recorded tests | **Partial**: A and C2 verified on chain; G by local tests; B, C1, D, E and F scripted but not broadcast | CATEGORY_COMPLIANCE.md; Live Proof |
| Authenticated messaging: invalid and replayed messages rejected | **Verified by local test** | `messaging-attacks.test.ts` (13) |
| Auditability: request, findings, policy, approvals, execution and receipt traceable | **Built**: task page and decision receipt (JSON and text) | `receipt.ts`; task page |
| User experience: usable through the website, not scripts | **Built** | AI Command Center, Bills & Invoices, Approvals |
| Reproducibility: documented for judges | **Done** | README, this file, DEMO_SCRIPT.md, TESTNET_PROOFS.md |
| Testing: relevant automated tests pass; gaps documented | **Vitest and Playwright layout pass**; signed-in browser E2E and Foundry not run here | see below |

## Tests not executed in this environment

- **Foundry contract suite** (`contracts/test`): `forge` is not installed on this machine. Run `pnpm test:contracts` after installing Foundry.
- **Signed-in Playwright workflow** (sign in, run the workflow, approve as a different user, execute): needs an isolated Supabase project with test users. It is not written as a passing test, because none could be run here.
- **Live fund-moving tests**: never run automatically. The opt-in scripts are `category-proofs.ts --broadcast`, and the live payment test is `vitest.live.config.ts`.
