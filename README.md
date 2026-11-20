# Verac

[![Built on QoreChain](https://build.qorechain.io/badge/verac.svg)](https://build.qorechain.io/p/verac)

**AI agents that do a DAO's treasury work, without unrestricted access to its funds.**

**[Open Verac](https://verac-web.vercel.app/dashboard)** · Build Before Q-Day · Post-Quantum AI Agents · QoreChain Diana testnet (EVM chain ID `9800`)

Paying a contractor should be simple. In a DAO it rarely is: someone has to check the invoice, confirm the work was
approved, make sure the payout address is right, check the treasury, and get the right people to sign off. Grants are
harder still, with applications to investigate, budgets to question and milestones to verify before any money moves.

Handing an AI agent the treasury keys is not the answer. A misleading invoice, a bad model response or a stolen key should
never be enough to move an organisation's money.

I built Verac to show that AI agents can do the real checking work while people, and the chain, keep control of the
money. **The agents investigate and prepare. People decide, with keys the server never sees. QoreChain enforces the limits.**

## What runs today

Everything below happened on Diana testnet with testnet QOR, and every transaction quoted in this repository is re-read
from the chain every week by `pnpm proof:check` (97 of 97 verified at the last run).

| Date (2026) | What I showed | Evidence |
|---|---|---|
| 14 Nov | Escrow funding and a 60 QOR milestone release to a contractor, run by scripts, with refused operations | [LIVE_RUN](docs/LIVE_RUN_2026-11-14.md) |
| 15 Nov | **First payment from the website**: a finance user requested 1 QOR, a different administrator approved it, the vault paid it | [LIVE_PAYMENT](docs/LIVE_PAYMENT_2026-11-15.md) |
| 16 Nov | **One instruction, six agents**: three invoices reviewed, one paid (1.25 QOR), two held, including one with a hidden prompt injection | [LIVE_WORKFLOW](docs/LIVE_WORKFLOW_2026-11-16.md) |
| 17 Nov | **Chain-level limits proven live**: EVM window transaction count, value, expiry and target limits, and native smart-account spending rules | [CATEGORY_COMPLIANCE](docs/CATEGORY_COMPLIANCE.md) |
| 18 Nov | **Q-Day drill survived**: my drill proof was accepted, and the bot holding the account's classical key took nothing | [QDAY_DRILL](docs/QDAY_DRILL.md) |
| 19 Nov | **TreasuryVault V2**: payments approved only by administrators' post-quantum signatures; I attacked it 13 ways and every attempt was refused | [V2_LIVE](docs/V2_LIVE_2026-11-19.md) |
| 19 Nov | **Grant intelligence** run live with real GitHub, Diana and Gemini on a sample programme | [GRANTS](docs/GRANTS.md) |
| 20 Nov | V2 switched on in the website; prompt-injection attacks sent to the real model; **an administrator key replaced on chain** | [GRANTS_AUDIT](docs/GRANTS_AUDIT.md), [V2_LIVE](docs/V2_LIVE_2026-11-19.md#administrator-key-replaced-2026-11-20) |

## One instruction, six agents

In the AI Command Center I type:

> Review our three outstanding contractor invoices, check whether their milestones were approved, flag anything
> suspicious, and prepare eligible payments.

| Step | Who | What actually happens |
|---|---|---|
| Understand | Coordinator | The instruction becomes one allow-listed intent. Gemini may parse it; fixed rules check the result and refuse anything else. |
| Load | Coordinator | Invoices, vendors, payout-address history, milestones and earlier requests from the database; the vault's balance, caps, today's allowance and recipient list from Diana. |
| Invoice | `InvoiceFraudAgent` | Duplicate numbers, payout address against the vendor record, look-alike vendors, dates, instructions hidden in invoice text. |
| Milestone | `MilestoneAgent` | Is the billed milestone approved, disputed or already paid, and does the amount match? |
| Security | `SecurityAgent` | Replays, recent payout changes, prompt injection, split payments, emergency stop. |
| Treasury | `TreasuryAgent` | Approved recipient, per-payment cap, balance, today's allowance. |
| Policy | `PolicyAgent` | Fixed code decides ELIGIBLE, HOLD or REJECT and sets the approvals needed. No model involved. |
| Payment | `PaymentAgent` | Prepares the exact payment request for each eligible invoice. Nothing is executed. |

A different administrator then approves the exact payment and executes it. The receipt and the vault's event are checked
on chain before anything is marked paid, and the decision receipt keeps AI recommendations, human decisions and chain
results apart.

Agents exchange HMAC-authenticated, replay-protected messages, bound to the organisation and task. Every step is saved
and runs under a lease, so a refresh or a crashed worker resumes instead of repeating.
[Architecture](docs/ARCHITECTURE.md#multi-agent-workflow) · [Demo script](docs/DEMO_SCRIPT.md)

## Post-quantum approvals: TreasuryVault V2

On the original vault the server held an approver key, so a compromised server could have approved and paid on its own,
within the vault's caps. I built V2 to remove that risk.

- **No owner.** Every payment and every administrative change needs **two of three administrators' ML-DSA-87
  signatures**, checked on chain by QoreChain's PQC Verify precompile against keys registered with proof of possession.
- **The website cannot approve.** Each administrator downloads the signing request and signs on their own computer with
  `pnpm v2:admin sign`, which re-checks the request against the live vault and shows it in plain words first.
- **A guardian can only reduce risk**: pause the vault or revoke an agent at once, never move money.
- **Keys can be replaced** without ever dropping below the threshold: add the new key, then remove the old one, each
  change signed by two administrators ([RUNBOOK 2a](docs/RUNBOOK.md)). I did this live on 20 November.

I attacked V2 myself, holding everything the server holds:

| Attempt | Refused by |
|---|---|
| No administrator signatures | contract: `NotEnoughSignatures(0, 2)` |
| Signatures from the server's own registered keys | contract: `NotAdmin` |
| One real signature plus a forged one | contract: `BadSignature` (the PQC precompile rejected it) |
| Replay of an executed payment | contract: `AlreadyExecuted` |
| Real signatures, amount raised | contract: `BadSignature` |
| Real signatures, unapproved recipient | contract: `RecipientNotApproved` |
| Real signatures, over the per-payment or daily cap | contract: `ExceedsPerTxCap`, `ExceedsDailyCap` |
| Policy or recipient change with the agent's key or one administrator | contract: `NotAdmin`, `NotEnoughSignatures(1, 2)` |
| Revoked agent, expired agent | contract: `AgentNotActive` |
| The agent sends QOR straight to an attacker | **QoreChain**, before inclusion: the agent's window was exhausted |

Two legitimate payments went through in the same run. The vault held 5 QOR before and 3.7 after: exactly those two.
[Full results and transactions](docs/V2_LIVE_2026-11-19.md)

## Grant intelligence

Agents investigate every grant application instead of a reviewer reading each one from scratch:

- **Evidence**: the GitHub repository (existence, activity, CI, licence), claimed contracts and transactions on Diana,
  and linked websites, each recorded as VERIFIED, PARTIALLY_VERIFIED, UNVERIFIED, CONTRADICTED or UNAVAILABLE.
- **Rubric**: Gemini scores the judgement criteria (relevance, technical, feasibility, impact, capability), and every
  score must cite evidence or an application section, or it is discarded. Budget and milestones are scored by fixed rules.
- **Risk flags**: copied text from another application, shared repositories or payout addresses, a payout address
  changed between versions, contradicted claims, and text addressed to an automated reviewer.
- **People decide**: one administrator recommends, a different one awards. Milestone money moves only after its evidence
  is approved, and only through the treasury.

On the sample programme the live run gave: Alpha, strong candidate (92/100); Beta, needs clarification (a one-line
budget, a milestone that says "Complete the protocol."); Gamma, further review (highly similar to Alpha, and a claimed
contract with no code on Diana).

I tested the grants agents against a careless or compromised model and 17 prompt-injection attacks, including disguised
text, on every push ([eval.test.ts](services/agent-coordinator/src/grants/eval.test.ts)). I also sent hidden attacks to
the real Gemini model: it inflated no score, and every attack was flagged for a human.

## Why QoreChain

Verac handles money, so an agent must not be able to spend just because it holds a key, or because a model says a payment
looks fine.

- **Hybrid signatures and authorisation windows.** QoreChain's native transactions are signed with secp256k1 and
  ML-DSA-87. EVM transactions are accepted only inside an authorisation window opened by a hybrid-signed native
  transaction, limited in duration, transaction count, value and target. Verac's agent windows admit only the vault.
  A classical key alone cannot open one, which is why the Q-Day drill bot got nowhere.
- **On-chain post-quantum verification.** V2 verifies ML-DSA-87 approvals inside the contract through the PQC Verify
  precompile, against keys whose possession was proven on chain.
- **QoreSeal** encrypts bids, milestone evidence and documents in the browser (ML-KEM-1024 + X25519); the server stores
  only ciphertext.

This is a specific security model, **not a claim that the whole application is quantum-proof**.
[Security](docs/SECURITY.md) · [Threat model](docs/THREAT_MODEL.md)

## Contracts

| Contract | Job |
|---|---|
| `TreasuryVaultV2` | No owner; payments and administration need two administrators' ML-DSA-87 signatures; caps, approved recipients, guardian pause and revoke |
| `TreasuryVault` | The original vault: agent caps, approved recipients, exact-payment approvals, pause |
| `MilestoneEscrow` | Escrow for procurement and grants: milestones, reviewer approvals, disputes, refunds |
| `PolicyManager` | Policy versions and revocations |
| `OrganizationRegistry` | Organisation and role references |
| `AuditAnchor` | On-chain commitments for evidence |

An approval is bound to the chain, vault, agent, token, recipient, amount, purpose, policy version, expiry and nonce: change
any of them and the approval no longer matches. Addresses: [deployments/](deployments/).

## What's inside the app

The core is agent-driven and proven on chain: **Dashboard, AI Command Center, Approvals, Live Proof, Treasury, Bills &
Invoices, Grants, Milestones, Policies** and the **Quantum Simulator**. Modules that work but are not agent-driven and
have no live proof yet (payroll, revenue, DCA and arbitrage simulations, procurement, governance, disputes, document
vault, threat centre) sit under **Labs** in the navigation and say so on every page.

## Testing and operations

- **522 automated tests** on every push (GitHub Actions): application logic, payment controls, agent behaviour, the
  grants evaluation set, and database permission tests that run every migration on an in-memory Postgres.
- **Contract tests** (Foundry unit, fuzz and invariant tests) in CI on every contract change.
- **Weekly proof check**: every transaction hash quoted in the docs is re-read from Diana, and must have succeeded or
  reverted exactly as the docs say.
- **Production hardening**: rate limits shared across server instances, a settings check at start-up (names, never
  values), `/api/health`, security headers, and emergency commands to pause either vault or revoke an agent.
  [Runbook](docs/RUNBOOK.md)

## Run locally

Requirements: Node.js 22 and pnpm 10 ([Foundry](https://getfoundry.sh) for the contract tests).

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm proof:check
```

Contract tests:

```bash
cd contracts && pnpm install --ignore-workspace && forge test
```

The website runs read-only without any settings. For sign-in, agents and live testnet payments see
[Deployment](docs/DEPLOYMENT.md) and [Supabase setup](docs/SUPABASE_SETUP.md). Live execution is off unless
`LIVE_EXECUTION_ENABLED=true`. Never commit private keys, service-role credentials or `.env` files.

## Honest limits

Verac is a **testnet project**, not a production treasury service, and has had **no external security audit**.

- The original vault still uses server-held agent and approver keys, limited to 10 QOR per payment and 20 per day. V2
  removes the approver key from the server; the V2 agent key on the server cannot pay without two administrators.
- In this demo the three V2 administrator keys are files on one computer. The tools let each move to its own device.
- Large grant milestone payments are not yet possible on chain; they show as awaiting an authorised funding path.
- The QoreX extension's EVM provider does not support the signing flow I need, so contract calls use restricted
  testnet keys rather than the user's wallet.
- Agent messages use HMAC, not post-quantum signatures, and the database activity log is not tamper-proof against
  database administrators.
- Gemini free-tier inputs may be used by Google, so demos use synthetic data.

## Credits and licence

[MIT licensed](LICENSE). Built with OpenZeppelin Contracts, Foundry, viem, Zod, Next.js, Supabase, `@qorechain/sdk`,
`@qorechain/qoreseal`, `@qorechain/qorex-wallet-mock`, `@google/genai` and PGlite. How AI was used to build Verac, and
inside it, is in [AI_USAGE.md](AI_USAGE.md).
