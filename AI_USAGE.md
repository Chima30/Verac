# AI usage

Verac uses AI in two places: to help build it, and inside the product. This file says which, where, what controls
apply, and what a person checked.

## 1. Building Verac (AI-assisted development)

**Tool:** Claude Code (Anthropic), in a desktop/terminal session on the developer's computer. Claude Sonnet and Claude Opus
models were used across the project.

**What the AI did:** read the QoreChain, Next.js and Gemini documentation; wrote and revised the Solidity contracts,
TypeScript packages, website, SQL migrations, tests, scripts and docs; ran the test suites, typechecks and builds; ran
dry runs of on-chain scripts and reported the results; found and fixed bugs, including ones it had introduced itself
(recorded in the commit history).

**What the developer did:**
- set the goals, the security rules and the order of work;
- approved, in the chat, every transaction before it was broadcast to Diana testnet;
- ran the Q-Day drill and submitted its proof;
- deployed and configured the website (Vercel, Supabase) and applied the migrations;
- tried the features in the browser and reported problems back (for example the production crash on /grants).

**What was not done:** no independent line-by-line review of the code, and no external audit of the contracts. Commits are
authored by the developer; AI assistance is disclosed here rather than in commit trailers.

## 2. AI inside the product (Gemini)

**Model:** Google Gemini through `@google/genai` (`gemini-3.5-flash-lite` by default, free tier), behind
`packages/ai-provider`, which enforces per-minute, per-day, per-organisation and per-user limits, timeouts and retries.
The website also rate-limits every AI route.

| Where | What the AI does | What it cannot do |
|---|---|---|
| Invoice workflow (`lib/workflows/engine.ts`) | Turns the typed instruction into an allow-listed intent | Widen the deterministic reading; see invoice text; decide eligibility, amounts or payments |
| Grants investigation (`lib/grants/engine.ts`) | Scores judgement criteria (relevance, technical, feasibility, impact, capability), citing evidence ids or application sections; lists strengths, concerns and optional questions | Score budget or milestones (fixed rules do); count an uncited score; award, reject, recommend or pay |
| Invoice check, policy drafting, governance analysis, dispute summaries, bid evaluation, "Ask Verac" | Explains, summarises or drafts text for a person to read | Change any record, policy or payment by itself |

**Controls that apply everywhere:**
- Output is validated against a schema (Zod); fields the AI was not asked for are dropped.
- Text from applicants, invoices or websites is wrapped as untrusted data, and the model is told never to follow it.
- Grant applications are also screened for instructions aimed at an automated reviewer (including disguised text);
  a hit sends the application to a human, whatever the AI scored.
- No AI agent has a payment tool. Money moves only through the treasury contracts, after human approval
  (TreasuryVault V2: two administrators' post-quantum signatures, verified on chain).
- Without a key, or when the quota runs out, the workflows continue by fixed rules and say so; nothing is invented.

**Evidence:**
- `deployments/grants-sample-dryrun.json`: the grants investigation run live with real GitHub, Diana and Gemini.
- `deployments/grants-injection-live.json`: prompt-injection attacks sent to the real model; it inflated no score, and
  every attack was flagged and sent to a human.
- `services/agent-coordinator/src/grants/eval.test.ts`: the evaluation set run on every push (a replay of the live run,
  a compromised model, 17 injection attacks, 12 ordinary sentences that must not be flagged).
- `docs/GRANTS_AUDIT.md` and `docs/AGENT_SPECIFICATIONS.md`: what each agent may and may not do.
