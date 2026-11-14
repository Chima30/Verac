# AI usage

## In development (Claude Code)

Claude Code (Sonnet 5.5 model) was used in a terminal/desktop session to read the QoreChain and Gemini documentation, write the
contracts, TypeScript services, SQL migration, tests and docs, and run the test suites. Every change in this repository's history
that came from that workflow is committed with a `Co-Authored-By: Claude` trailer.

What the AI did in this milestone: scaffolded the monorepo; wrote and iterated the Solidity and TS code; found and fixed test bugs
(aliased memory structs in a Foundry test, a missing `READY → FAILED` state transition); built the cross-language payment-hash vector.

**Human verification status: pending.** At the time of writing no human has reviewed the code line by line, run it on their own
machine, or reviewed the contracts independently. This file must be updated to say what the team actually verified before submission.
Do not treat this paragraph as a claim that it has been.

## In the product (Gemini)

Gemini (`@google/genai`, free-tier models only) is used for tasks that benefit from language reasoning: invoice anomaly explanation,
bid comparison, policy drafting from natural language, summaries. Deterministic code handles money, limits, validation and escrow rules.
Model output is schema-validated and is never authorisation. No live Gemini call has been made yet in this repository.
