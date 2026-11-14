# Verac

AI agents that do real operational work for a DAO or business (paying invoices, running tenders, releasing
milestone payments) without any agent ever holding unrestricted access to the treasury. Built for the
**Build Before Q-Day** hackathon, category **Post-Quantum AI Agents**, on **QoreChain Diana testnet**
(native `qorechain-diana`, EVM chain id `9800`). The product is called Verac; the name lives in one env var
(`NEXT_PUBLIC_PRODUCT_NAME`).

> **Status: early foundation (2026-11-14).** The security core is implemented and tested; the web app is a
> read-only shell with a few live pages; module workflows, live on-chain flows and most agent logic are not built yet. See [Status](#status) before judging anything here.
> Nothing has been deployed, no testnet transaction has been sent, and no external audit has happened.

## The problem

Treasury work (bills, payroll, grants, vendor milestones) is slow and manual, and "let an AI do it" is
dangerous: a prompt-injected invoice or a stolen key should not be able to drain a treasury.

## The idea

Agents investigate, recommend and prepare. **Money moves only through one pipeline**:

```
agent proposal → policy check → risk screen → human approval (if required, bound to the exact payment)
              → simulation → signed execution → receipt + event verification → audit record
```

An LLM's output is never authority. The final decision is made by deterministic code and by the contracts:

* `TreasuryVault` gives each agent a per-token per-transaction cap, a daily cap, an expiry and an
  auto-approve ceiling. New recipients, or anything above the ceiling, need N human approvals. Each approval
  commits to `keccak256(chainId, vault, agent, token, to, amount, purpose, policyVersion, expiry, nonce)`,
  so changing the recipient or amount invalidates it. There is deliberately **no owner withdraw-anything function**.
* `MilestoneEscrow` is one escrow for both procurement and grants: reviewer approval, double-release
  prevention, dispute freeze, resolver-decided splits, and explicit refund conditions.
* `PolicyManager` versions policies; activating a new version (or revoking) kills every older approval.

## Why post-quantum matters here, and what it does and does not do

QoreChain requires hybrid (secp256k1 + ML-DSA-87) signatures on native transactions. An **EVM transaction is
not ML-DSA signed**: it is admitted only while the account's **EVM authorisation window**, opened by a
hybrid-signed native message, covers it. So a thief with only the classical key cannot open a window and is
bounded by whatever window is open. We build on that real mechanism (windows, delegated authenticators with
spending rules, KEM-key registry, QoreSeal) and do not claim universal quantum resistance.
Details and limits: [docs/SECURITY.md](docs/SECURITY.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Status

| Area | State | Evidence |
|---|---|---|
| Solidity: registry, policy manager, vault, escrow, anchor | Implemented, deployed to testnet | 55 Foundry tests incl. fuzz and reentrancy |
| Deterministic policy engine + payment hash (matches Solidity byte for byte) | Implemented | 14 Vitest tests + cross-language vector |
| Payment pipeline, state machine, idempotency | Implemented (in-memory store) | 22 Vitest tests |
| 15 agent specs, tool allow-lists, signed replay-protected messaging | Implemented | same suite |
| Gemini provider (free-tier limits, retries, quota pause, schema validation) | Implemented; one real call per model made 2026-11-14 (default `gemini-3.5-flash-lite` answers in about 1.5 to 3 s; 5 of 8 other models timed out or errored) | 24 mocked Vitest tests + `pnpm ai:probe`; three agents wired (Policy Builder, Invoice explanations, Bid scoring) |
| Postgres schema + RLS (31 tables, migrations 0001 to 0006) | Implemented; a policy bug found on real Supabase was fixed | 15 tenant-isolation tests on PGlite; sign-up, organisation creation and contract linking confirmed on a real Supabase project |
| Live testnet **reads** (chain id, block, AA config, limits) | Verified 2026-11-14 | `pnpm chain:probe` |
| Web app shell: 27 routes, light/dark, mobile nav | Implemented and deployed read-only at https://verac-web.vercel.app (all 27 routes return 200) | checked 2026-11-14 |
| Web pages with live behaviour | Live Proof (re-verifies all 37 testnet transactions from the chain), Dashboard (chain + AI status), agent registry, permission matrix, policy validator, address lookup (balance, PQC, KEM, window, rules) on Diana testnet, integrations | read-only; no signing |
| Supabase sign-in, organisation, team, audit pages | Code written, type-checked and built; **not yet exercised against a real Supabase project** (needs docs/SUPABASE_SETUP.md) | no live test |
| Web pages for the 12 modules' workflows | **Placeholders that state what exists and what is missing**; no working controls | needs Supabase, auth, deployed contracts |
| Wallet connect, PQC key registration, hybrid-signed tx, EVM window open | **Not started** | needs a funded throwaway testnet account |
| QoreSeal encrypt/decrypt in the vault | **Not started** (package verified on npm) | n/a |
| Contract deployment | **Deployed to Diana testnet 2026-11-14** (5 contracts, see deployments/diana-testnet.json) | bytecode + owner read back on-chain |
| Real payment, human approval, escrow funding, 60 QOR milestone release, real rejections | **Done on testnet (shell scripts, not the web app)**: 3 successful payments or releases plus 4 on-chain denials | docs/LIVE_RUN_2026-11-14.md |
| AI Policy Builder (plain English → draft spending policy) | Implemented and tried live on Gemini 2026-11-14 (normal request, prompt injection, contradictory numbers, secret in text). Output is a draft only; deterministic code converts it and the policy validator checks it; nothing is activated by AI. Only enabled where `GEMINI_API_KEY` is set (local; not on the public site) | Vitest for the converter + validator; live runs manual |
| Approvals and Tasks (/approvals, /tasks) | Implemented in code. Payment requests and decisions only change through two audited database functions (direct writes are denied): finance roles only, the requester can never approve their own request, quorum of N approvals, one vote per person, any rejection ends it, expired requests are cancelled, each step writes an audit event and updates the linked task. Each request carries a payment hash that is re-checked against its stored fields before approval. **SIMULATION**: approving executes nothing on chain. Needs migration 0003 applied and a second finance member (Team page, add by user ID) | 10 PGlite tests for the workflow plus the updated RLS test; not yet exercised on the real Supabase project |
| Invoice fraud check (/invoices) | Implemented. Fixed rules decide block / hold / pass (duplicate, changed payout address, lookalike vendor, outlier, just-under-limit, bad dates, pressure wording, instructions aimed at an AI). Gemini only explains a stopped invoice; it cannot change the verdict. Tried live 2026-11-14. **SIMULATION**: you paste the invoice and sample history; no database history, upload or payment is connected yet | 12 Vitest tests for the rules; live runs manual |
| Procurement (/procurement) | Implemented in code. Tender, **sealed bids**, close, open, rank, award with a milestone plan. Bids are real QoreSeal envelopes (ML-KEM-1024 + X25519 hybrid, AES-GCM) made in the vendor's browser and sealed to reviewers' public keys; the database holds ciphertext only; reviewers decrypt in their own browser with a key that never leaves it (32-byte seed, backup file). Bound to the tender and chain. Ciphertext is released to reviewers only after bidding closes (enforced by the database, not by cryptography: a reviewer who already holds a key could still decrypt a copy they obtained earlier). Fixed rules decide eligibility (over budget, unreadable, instructions aimed at an AI), price and delivery scores; Gemini adds an optional, advisory fit score for eligible bids only, under anonymous labels, and only after the reviewer ticks a consent box (free-tier content may be used by Google). A human awards. **No QOR moves**: funding and releasing the MilestoneEscrow on chain is not wired to the web app (the contract is deployed and demonstrated on testnet via scripts/demo-escrow.sh) | 8 PGlite tests for the lifecycle and visibility, 7 for bid rules, 6 for QoreSeal usage (real library); AI scoring tried live 2026-11-14; not yet exercised on the real Supabase project |
| Treasury (/treasury) | Implemented. Reads the deployed TreasuryVault live from Diana testnet on every load: balance, paused flag, approver threshold, owner, active policy version, each agent's limits and remaining daily allowance (read from the contract), and recent vault events decoded from the chain (log queries are chunked because the node caps them at 10,000 blocks). Nothing is stored; if the node is unreachable it says so. Only successful transactions leave events, so denied payments appear on Live Proof instead | 3 unit tests for formatting/decoding; checked against the live contract 2026-11-14 |
| Milestones (/milestones) | Implemented in code. After an award the winning vendor submits **sealed** evidence (same QoreSeal construction as bids, bound to the milestone) in order; reviewers open it in their own browser and accept or reject; an accepted milestone lets finance open a payment request that must pay the vendor's recorded payout address and the exact milestone amount (checked in the database), approved by a different finance member in the Approvals flow. The vendor sets a payout address; every change is kept in history and the audit log. **SIMULATION**: nothing is released from the on-chain MilestoneEscrow and no QOR is sent | 9 PGlite tests for the lifecycle, ordering, visibility and payment rules; not yet exercised on the real Supabase project |
| Governance (/governance) | Implemented in code. Owners/administrators create proposals with a quorum and pass threshold; members vote once each while voting is open; the database counts the result after the deadline. Application vote, **not** an on-chain governance vote, and a passed proposal executes nothing. Optional Gemini summary (neutral, no recommendation, cannot vote) when a key is configured. Tested on a local Postgres (PGlite), not yet applied to the hosted database. |
| Disputes (/disputes) | Implemented in code. The awarded vendor or a procurement reviewer opens a dispute on a milestone, which freezes it; both sides add plain-text (not encrypted) statements; an owner or administrator who did **not** open it resolves it by accepting the work or sending it back for new evidence. Changes the milestone in this app only: no QOR moves and the on-chain MilestoneEscrow dispute states are not called. Optional Gemini summary (neutral, cannot decide). Tested on a local Postgres (PGlite), not yet applied to the hosted database. |
| Grants (/grants) | Implemented in code. Owners/administrators open a round with a budget; people with the grant_applicant role apply (plain text, not encrypted); fixed rules flag requests over what is left, copy-pasted pitches and instruction-like text; one administrator recommends and a **different** one awards with milestones that add up exactly to the request, and total awards can never pass the budget. Optional advisory Gemini review (cannot award or reject; pitches with instructions are kept out). Awarded grant milestones exist, but evidence and payment for them are **not built yet (PENDING)**. Application-only: no QOR moves and no escrow is created. Tested on a local Postgres (PGlite), not yet applied to the hosted database. |
| Revenue (/revenue) | Implemented in code. Finance records money owed to the organisation (native QOR) and later records the payment transaction hash; one transaction can settle only one record. Overdue is computed from the due date. On each page load the server looks the claimed transaction up on the Diana testnet and shows **VERIFIED ON TESTNET** only for a successful transfer to the linked treasury of at least the amount owed, otherwise NOT VERIFIED / NOT FOUND. No AI, no invoicing, no customer messaging, no automatic matching of unclaimed deposits. Tested on a local Postgres (PGlite), not yet applied to the hosted database. |
| Document Vault (/vault) | Implemented in code. Members seal a note or a small file (150 KB limit) in their **browser** to chosen members using QoreSeal (ML-KEM-1024 + X25519, AES-GCM, bound to the document id); the server stores ciphertext only and shows a document only to its listed readers, who open it in their own browser after a checksum check. Titles and reader lists are not encrypted and owners/administrators can see a document exists. Adding a reader means uploading a new sealed copy. On-chain anchoring of checksums is **not implemented (PENDING)**. The reading key is the same one used for bids and evidence; losing it and its backup loses the documents. QoreSeal is pre-1.0 with its specification awaiting external review. Crypto round trips are unit-tested; database rules are tested on a local Postgres (PGlite), not yet applied to the hosted database, and the browser flow has not been clicked through. |
| Activity (/activity) | Implemented in code. A readable, filterable (by module, and "only mine"), paginated feed of the append-only `audit_events` log. Owners, administrators, security reviewers and auditors see everyone's events; other members see only their own (migration 0012). Unknown actions are shown as recorded, and actors are short member ids (no names looked up). The log blocks edits and deletes in the database but is not signed or anchored on-chain, so it is **not** tamper-proof against direct database access. Tested on a local Postgres (PGlite) and unit tests for the wording; not yet applied to the hosted database. |
| Threat Center (/threats) | Implemented. Fixed rules over live chain reads for the vault owner and each agent account: post-quantum key registered / possession proven, EVM window open or closed (with what remains), QoreSeal key, account-level spending rules, single-key owner, approver count, paused vault, agent limits against vault balance, expired permissions. A failed read is reported as unknown, never as a pass or a failure. The compromised-key runbook is **manual steps only**: closing a window, pausing, revoking and rotating need a signing key the web app does not hold. No attack has been staged, so none is claimed | 7 unit tests for the rules; checked against the live testnet 2026-11-14 |
| Payroll (/payroll) | Implemented in code. Paste payees (name, 0x address, amount); fixed rules block empty batches, bad or repeated addresses and bad amounts, and flag repeated names, changed addresses, new payees and big jumps against the last approved period, plus optional per-payment and batch limits. A batch hash binds every address and amount (not names). Submitting opens an approval request: the approver sees every line, the hash is re-verified server-side, the submitter cannot approve, and the decision updates the batch. **No AI is used.** **SIMULATION**: approved means approved in the app; no QOR is sent and there is no execution wiring | 8 rule/hash tests and 7 PGlite workflow tests; not yet exercised on the real Supabase project |
| Other AI behaviours | Provider ready; no other prompts/schemas written | n/a |
| DCA / arbitrage / dispute / governance / payroll modules | **Not started** | n/a |

Full mapping: [docs/REQUIREMENTS_MATRIX.md](docs/REQUIREMENTS_MATRIX.md). Plan: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Run it

Requirements: Node 22, pnpm 10, [Foundry](https://getfoundry.sh) (tested with 1.9.0).

```bash
pnpm install
pnpm test              # TypeScript tests (agents, policy, AI provider, RLS) - no network, no API keys
pnpm chain:probe       # read-only live check of Diana testnet
cd contracts && pnpm install --ignore-workspace && forge test    # contracts
```

`contracts/` has its own install because Foundry cannot resolve imports outside its project root.
`forge-std` is vendored under `contracts/lib/forge-std` (v1.17.0, MIT/Apache-2.0).

Optional live AI check (one real call, synthetic data): `GEMINI_API_KEY=... pnpm ai:probe`.

## Testnet vs simulation

Everything labelled `LIVE_TESTNET` must come from the real chain with a verifiable hash. Anything else is
labelled `SIMULATION` or `SAMPLE_DATA`. The sample tender amounts (280/260/295 QOR) are scenario data only.

## Known limitations

* Gemini's free tier may use submitted content to improve Google products: use synthetic data in the public demo.
* The agent message bus uses HMAC inside one trust domain; it is not post-quantum and is not claimed to be.
* QoreSeal is a pre-1.0 draft construction pending external review.
* QoreX's documented EVM provider does not support `eth_sendTransaction`; EVM calls use a server-side signer on a throwaway testnet account.
* Compiled for EVM `paris` (conservative); the node accepted `PUSH0`/`TLOAD` in `eth_call`, but a live deploy is still unverified.

## Credits and licence

MIT ([LICENSE](LICENSE)). Built with OpenZeppelin Contracts 5.0.2, forge-std, viem, zod, `@qorechain/sdk` 0.14.0,
`@qorechain/qoreseal` 0.1.0, `@google/genai`, PGlite. AI-assisted development is described in
[docs/AI_USAGE.md](docs/AI_USAGE.md).
