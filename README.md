# Verac

## The problem

Paying a contractor should be straightforward. But for a DAO, the payment is often the last step in a much longer process: someone checks the invoice, confirms the work was approved, makes sure the payment address is right, checks the treasury balance, gets another person to sign off, and finally sends the money.

Now add grants, supplier bids, payroll and governance decisions. The details end up spread across messages, spreadsheets, documents and wallets. It takes time to piece everything together, mistakes are easy to miss, and it's not always clear who approved what.

Giving an AI agent unrestricted access to a treasury isn't a good answer either. A misleading invoice, a bad AI response or a compromised key shouldn't be enough to move an organisation's funds.

## What Verac does

**Verac brings those operations into one place.** It helps DAOs and businesses review work, check financial requests, prepare decisions and make authorised payments on QoreChain.

The goal is to let people ask for an outcome, not manually coordinate every step. For example:

> Review our outstanding contractor invoices, check whether the milestones were approved, flag anything suspicious, and prepare eligible payments for approval.

That's the workflow we're building toward. Verac already has the invoice checks, milestone records, AI-assisted payment drafting, approval system and testnet payment infrastructure. **The full cross-module request above is not yet a proven end-to-end AI workflow.** Today, the strongest completed demonstration is a payment requested on the website, approved by a different administrator and executed on QoreChain.

The important distinction is simple: **AI helps with the work, but it doesn't get to decide on its own when money moves.**

**[Open Verac](https://verac-web.vercel.app/dashboard)** · **Build Before Q-Day** · **Post-Quantum AI Agents** · **QoreChain Diana testnet (EVM chain ID `9800`)**

## See what works today

On **November 15, 2026**, Verac completed a real **1 QOR payment from the website**:

1. A finance user submitted a payment request.
2. A different administrator authenticated and approved the exact payment.
3. The server relayed the approval and executed the payment using a restricted testnet agent account.
4. Verac checked the on-chain receipt and the matching `TreasuryVault` event before marking the payment **confirmed**.
5. The approval and payment transaction hashes were recorded on the **Proof** page.

This was a testnet transaction, not a simulated success screen. The agent was limited to **10 QOR per payment**, **20 QOR per day**, and approved recipients, with no automatic payments permitted in that configuration.

An earlier testnet run on **November 14, 2026** also demonstrated escrow funding, a **60 QOR milestone release to a contractor**, and rejected operations. Those earlier transactions were executed through scripts, **not from the website**.

**Evidence:** [Website payment](docs/LIVE_PAYMENT_2026-11-15.md) · [Earlier testnet run](docs/LIVE_RUN_2026-11-14.md) · [Agent and approver setup](docs/LIVE_SETUP_2026-11-15.md) · [Deployment addresses](deployments/diana-testnet.json)

### What happens before a payment goes through?

```text
Payment request
    ↓
Policy and risk checks
    ↓
Approval from an authorised administrator, when required
    ↓
Transaction preparation and simulation
    ↓
Restricted testnet signing and execution
    ↓
On-chain receipt and event verification
    ↓
Payment record and audit history
```

Gemini can turn a plain-English request into a payment draft, but it cannot bypass the form checks, spending limits or approval requirements. The payment's details are bound to a hash, so an approval for one recipient and amount cannot be reused for a different payment.

## What's inside Verac?

Verac brings treasury management, finance operations and DAO work into the same application. The table below separates working testnet features from application workflows and simulations.

| Area | What it does | Current state |
| --- | --- | --- |
| **Treasury** | Reads the deployed vault's balance, limits, policy version, pause status and transaction activity. Supports website-initiated payments. | **Live testnet:** one website payment confirmed. |
| **Approvals and Tasks** | Records payment requests, prevents self-approval, checks approval thresholds and tracks decisions. | **Working for the demonstrated live payment**; broader flows still need end-to-end checks. |
| **AI Command and policy tools** | Gemini drafts constrained payment requests, proposes policy drafts, explains flagged invoices and offers advisory bid scoring. | **Partly integrated.** Not all 15 agent specifications are autonomous workflows. |
| **Bills and invoice checks** | Flags duplicates, changed payment addresses, suspicious amounts and instructions hidden in invoice text. | **Rule-based checker implemented**; full invoice-history-to-payment flow not connected. |
| **Procurement** | Creates tenders, accepts encrypted bids, compares eligible proposals and records awards with milestones. | **Application workflow implemented**; website escrow funding still pending. |
| **Grants** | Manages funding rounds, applications, reviews, awards and milestone plans. | **Application workflow implemented**; grant disbursement and evidence flow incomplete. |
| **Milestones** | Lets vendors submit encrypted evidence for review and records approval decisions. | **Application workflow implemented**; website-triggered escrow release pending. |
| **Document Vault** | Encrypts small files and notes in the browser for selected recipients using QoreSeal. | **Cryptography tested**; full hosted-browser flow still needs verification. |
| **Payroll** | Checks payee lists, calculates batch totals and prepares approval requests. | **Application workflow only**; approved batches do not send QOR. |
| **Revenue** | Tracks amounts owed and checks submitted payment hashes against QoreChain. | **On-chain receipt verification**; no automatic deposit matching. |
| **Governance** | Creates proposals, tracks members' votes and explains proposals with optional Gemini summaries. | **Application-level voting**, not native on-chain governance; no execution. |
| **Disputes** | Records milestone disputes, supporting statements and reviewer outcomes. | **Application-level resolution**; on-chain escrow dispute actions not yet connected. |
| **DCA, rebalancing and arbitrage** | Calculates allocation changes, DCA comparisons and estimated returns after fees and slippage. | **Simulation only.** No trades, market feeds or schedules execute. |
| **Threat Center** | Reads live account and vault security configuration, including windows, limits and permissions. | **Live reads and rule checks**; incident response steps are currently manual. |
| **Proof and Activity** | Shows testnet evidence and application audit events, with distinctions between verified and unverified outcomes. | **Live chain evidence available**; database audit events are not themselves tamper-proof. |

For a more detailed breakdown of what is implemented, tested or still pending, see [Requirements Matrix](docs/REQUIREMENTS_MATRIX.md) and [Implementation Plan](docs/IMPLEMENTATION_PLAN.md).

## Where the AI fits

Verac uses **Google Gemini** where interpreting information is useful: drafting a payment from natural language, suggesting a spending policy, explaining an invoice flag, or adding an optional assessment to an eligible supplier bid.

It does **not** ask Gemini to do the maths on a treasury transfer, decide whether a recipient is authorised or enforce a policy. Those decisions use validated application code and smart contracts. Human reviewers still select suppliers, approve payments and resolve disputes.

The project includes **15 agent definitions**, tool permissions and authenticated, replay-protected agent messaging. That's the foundation for more coordinated work, but it would be misleading to claim all 15 agents already run fully autonomous, connected business processes.

The next major AI milestone is a single request that checks real invoices against real approved milestones, coordinates the relevant agents, and produces payment proposals that can enter the existing approval and execution flow.

## Why build this on QoreChain?

Verac handles money, so an agent shouldn't be able to spend just because it has a key or because a language model says a payment looks fine.

QoreChain gives us another control at the blockchain level. On its native chain, transactions use **hybrid secp256k1 and ML-DSA-87 signatures**. EVM transactions are **not themselves ML-DSA-signed**. Instead, they are accepted only inside an EVM authorisation window opened by an appropriately hybrid-signed native transaction. Windows can restrict duration, transaction count, value and targets.

Verac uses that mechanism alongside the spending rules in its deployed contracts. An attacker with only a classical private key cannot open a new authorisation window, although an already-open window and a compromised server still introduce risks. This is a specific security model, **not a claim that the whole application is quantum-proof**.

For confidential bids, milestone evidence and vault documents, Verac uses **QoreSeal**: browser-side encryption built around ML-KEM-1024, X25519 and AES-GCM. The server stores ciphertext rather than the document's readable contents. Reviewers decrypt using their own keys. Document titles and reader lists are not encrypted, and QoreSeal is still a pre-1.0 implementation awaiting external review.

More detail: [Security](docs/SECURITY.md) · [Threat Model](docs/THREAT_MODEL.md)

## Contracts and payment controls

Five Solidity contracts are deployed on Diana testnet:

| Contract | Job |
| --- | --- |
| `OrganizationRegistry` | Organisation and role references. |
| `PolicyManager` | Policy versions and revocations. |
| `TreasuryVault` | Agent limits, approved recipients, approval thresholds and payment enforcement. |
| `MilestoneEscrow` | Shared escrow rules for procurement and grants, including milestones, disputes and refunds. |
| `AuditAnchor` | On-chain commitments for evidence where integrated. |

`TreasuryVault` checks per-token payment limits, daily limits, expiry and approval requirements. The approved payment hash commits to the chain, vault, agent, token, recipient, amount, purpose, policy version, expiry and nonce. If a material detail changes, the old approval no longer matches.

`MilestoneEscrow` supports reviewer approvals, prevents double release, can hold disputed funds and has explicit resolution and refund conditions. Its on-chain functionality was demonstrated with scripts; **the corresponding website funding and release actions are still unfinished**.

The application has a kill switch and emergency-stop controls. These are useful safeguards but do not make server-held keys equivalent to production custody.

## Testing and evidence

The latest project report lists **323 passing tests**, including **135 database security tests**. They cover application logic, payment controls, agent behaviour and row-level security. The repository also contains a Foundry contract test suite covering issues such as spending limits, reentrancy and escrow behaviour, but **Foundry was not installed in the environment used for the latest report**, so the contract tests still need to be rerun there.

The database has migrations through `0015`. **Successful application of migration `0015` to the hosted Supabase project has not yet been independently confirmed.**

A live testnet transaction is marked **confirmed** only after Verac checks its receipt and matching contract event. Simulated calculations and sample tender data are not presented as payments or trading executions.

Useful evidence and project documents:

- [Website payment proof — November 15](docs/LIVE_PAYMENT_2026-11-15.md)
- [Earlier escrow and payment run — November 14](docs/LIVE_RUN_2026-11-14.md)
- [Live testnet setup](docs/LIVE_SETUP_2026-11-15.md)
- [Deployment manifest](deployments/diana-testnet.json)
- [Security model](docs/SECURITY.md) and [threat model](docs/THREAT_MODEL.md)
- [Requirements and implementation status](docs/REQUIREMENTS_MATRIX.md)

## Run locally

Requirements: **Node.js 22**, **pnpm 10**, and [Foundry](https://getfoundry.sh) for the Solidity tests.

```bash
pnpm install
pnpm test
pnpm chain:probe
```

Run the contract tests separately:

```bash
cd contracts
pnpm install --ignore-workspace
forge test
```

`contracts/` has its own dependency installation because Foundry does not resolve imports outside that project root. `forge-std` is included under `contracts/lib/forge-std`.

For a live Gemini connectivity check using synthetic inputs, configure `GEMINI_API_KEY` locally and run:

```bash
pnpm ai:probe
```

See [Deployment](docs/DEPLOYMENT.md) and [Supabase Setup](docs/SUPABASE_SETUP.md) for environment variables, authentication and database configuration. **Never commit private keys, service-role credentials or `.env` secrets.** Live transaction execution is controlled separately through `LIVE_EXECUTION_ENABLED` and is disabled unless explicitly set to `true`.

## What still needs work

Verac is a **testnet MVP**, not a production treasury service. The priorities are:

1. Connect procurement escrow funding and milestone release to website actions and the right signing/approval paths.
2. Verify hosted Supabase migration `0015` and run full browser workflows against the deployed database.
3. Add Playwright end-to-end coverage and rerun the Foundry contract suite in the current environment.
4. Test the QoreX wallet panel against the real extension. Its documented EVM provider does not support `eth_sendTransaction`, so contract calls currently use server-held testnet keys.
5. Connect invoice review, milestone evidence and payment preparation into a single demonstrable multi-agent workflow.

The server currently holds separate **agent and approver signing keys** for testnet execution. The administrator's website approval is recorded separately, but both signing credentials live in the server's trust environment. A compromised server therefore remains a serious risk; on-chain vault limits are an important independent boundary, not a replacement for production key management. There has been **no external security audit**, and mainnet use is not supported.

Other limitations: Gemini free-tier inputs may be used to improve Google's products, so public demos should use synthetic data; the internal agent message bus uses HMAC rather than post-quantum signatures; and the activity log cannot be called tamper-proof against database administrators. [Security](docs/SECURITY.md) explains these trade-offs.

## Built for Build Before Q-Day

Verac is an entry in the **Post-Quantum AI Agents** category on QoreChain Diana testnet (`qorechain-diana`, EVM chain ID `9800`). We wanted to explore a practical question: **can AI help an organisation do real financial work without giving the AI unrestricted control of the funds?**

The verified website payment is one answer. Connecting invoices, milestones, procurement and grants into that same controlled flow is the work that comes next.

## Credits and licence

[MIT licensed](LICENSE). Built with OpenZeppelin Contracts, Foundry/forge-std, viem, Zod, `@qorechain/sdk`, `@qorechain/qoreseal`, `@google/genai` and PGlite. The development process and AI-assisted work are documented in [AI Usage](docs/AI_USAGE.md).
