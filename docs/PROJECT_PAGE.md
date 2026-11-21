# Project page text (build.qorechain.io/p/verac)

Copy each section into the matching box on the project page. Every claim links back to a record in this repository.

---

## About

Paying a contractor should be simple. In a DAO it rarely is: someone has to check the invoice, confirm the work was
approved, make sure the payout address is right, check the treasury, and get the right people to sign off. Grants are
harder still. And handing an AI agent the treasury keys is not the answer: a misleading invoice, a bad model response or a
stolen key should never be enough to move an organisation's money.

I built Verac to show that AI agents can do the real checking work while people, and the chain, keep control of the money.

**What runs today, on QoreChain Diana testnet:**

- **One instruction, six agents.** I type "Review our outstanding contractor invoices, check their milestones, flag
  anything suspicious and prepare eligible payments." The agents find one eligible invoice, hold one whose milestone is
  not approved, and hold one with a swapped payout address and a hidden instruction to the AI. A different administrator
  approves the eligible one and 1.25 QOR is paid on chain.
- **Post-quantum approvals.** On TreasuryVault V2 a payment moves only with two of three administrators' ML-DSA-87
  signatures, made on their own computers and verified on chain by QoreChain's PQC precompile. The website's server
  holds no administrator key, so it cannot approve anything. V2 is switched on in the website.
- **I attacked it myself.** With every key the server holds, I tried 13 ways to move money without the administrators:
  no signatures, the server's own keys, a forged signature, a replay, a raised amount, an unapproved recipient, over the
  caps, a revoked or expired agent. All 13 were refused on chain.
- **Grant intelligence.** Agents investigate every application: they read the GitHub repository, check claimed contracts
  on Diana, score a published rubric with Gemini (citing evidence for every score) and draft questions. Budget and
  milestones are scored by fixed rules. The AI never awards, rejects or pays; awards need two different administrators.
  I tested it with 17 prompt-injection attacks and against the real model, which inflated no score.
- **Survived the Q-Day drill.** My drill account's proof was accepted, and the bot holding its classical key took nothing.
- **Key replacement, live.** I replaced one V2 administrator key on chain today, with each signature made separately.

Everything is on testnet with testnet QOR, and every transaction I quote is re-checked against the chain every week.

**Try it in three minutes, no account needed:** https://verac-web.vercel.app/start walks you through the invoice
workflow, the attacks on the vault and a grant investigation, each with its on-chain transactions.

---

## How it's made

I built Verac with Next.js, React and TypeScript on Vercel, Supabase (Postgres with row-level security), Solidity
contracts tested with Foundry, Google Gemini, the QoreChain SDK, QoreSeal and the QoreX wallet mock.

**Agents that cannot spend.** A coordinator hands each request to specialist agents (invoice, milestone, security,
treasury, policy, payment; for grants: research, technical, budget, milestone and risk agents). They exchange
authenticated, replay-protected messages and every step is saved, so a refresh or crash resumes instead of repeating.
Gemini only interprets and explains: its output is schema-checked, untrusted text is fenced off, and fixed code makes
every decision about money. No agent has a payment tool.

**Two layers of on-chain control.** The vault contracts enforce per-payment and daily caps, approved recipients and
exact-payment approvals: an approval is bound to the chain, vault, agent, recipient, amount, purpose, policy, expiry and
nonce, so it cannot be reused for anything else. Underneath, QoreChain only accepts the agent's EVM transactions inside a
short authorisation window that admits just the vault, opened by a hybrid secp256k1 + ML-DSA-87 signed native
transaction. On 17 November I proved those window limits (transaction count, value, expiry, target) and native
smart-account spending rules live on Diana.

**TreasuryVault V2** has no owner. Every payment and every administrative change needs two administrators' ML-DSA-87
signatures, each checked against a key registered on QoreChain with proof of possession. A guardian can pause or revoke
an agent instantly but can never move money. Administrators sign on their own computers with a small command-line tool
that re-checks the request against the live vault and shows it in plain words before signing.

**Privacy.** Bids, milestone evidence and documents are encrypted in the browser with QoreSeal (ML-KEM-1024 + X25519);
the server stores only ciphertext.

**Testing.** 522 automated tests run on every push, including database permission tests on an in-memory Postgres, the
grants evaluation set and the contract suite (unit, fuzz and invariant tests) in CI. A weekly check re-reads every
transaction quoted in my docs from Diana.

**What was hard.** Connecting AI-prepared requests to real payments without giving the AI any power over funds, and
making approvals that a compromised server cannot fake. That second problem is why I built V2.

**Honest limits.** This is a testnet project with no external audit. The original vault still uses server-held agent and
approver keys (with tight caps); V2 removes the approver key from the server. In this demo the three V2 administrator
keys are on one computer, though the tools let each move to its own device. Large grant milestone payments are not yet
possible on chain. Modules that agents do not drive (payroll, procurement, governance and others) are labelled Labs.
