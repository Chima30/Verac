# QoreOps (working title)

AI agents that do real operational work for a DAO or business (paying invoices, running tenders, releasing
milestone payments) without any agent ever holding unrestricted access to the treasury. Built for the
**Build Before Q-Day** hackathon, category **Post-Quantum AI Agents**, on **QoreChain Diana testnet**
(native `qorechain-diana`, EVM chain id `9800`). The product name is not final; it lives in one env var
(`NEXT_PUBLIC_PRODUCT_NAME`).

> **Status: early foundation (2026-11-14).** The security core is implemented and tested; the web app, live
> on-chain flows and most agent logic are not built yet. See [Status](#status) before judging anything here.
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
| Solidity: registry, policy manager, vault, escrow, anchor | Implemented, **not deployed** | 55 Foundry tests incl. fuzz and reentrancy |
| Deterministic policy engine + payment hash (matches Solidity byte for byte) | Implemented | 14 Vitest tests + cross-language vector |
| Payment pipeline, state machine, idempotency | Implemented (in-memory store) | 22 Vitest tests |
| 15 agent specs, tool allow-lists, signed replay-protected messaging | Implemented | same suite |
| Gemini provider (free-tier limits, retries, quota pause, schema validation) | Implemented, mocked tests only | 24 Vitest tests; **no live Gemini call yet** (needs your key) |
| Postgres schema + RLS (31 tables) | Implemented | 14 tenant-isolation tests on PGlite (not a Supabase project) |
| Live testnet **reads** (chain id, block, AA config, limits) | Verified 2026-11-14 | `pnpm chain:probe` |
| Web app (Next.js UI, all 12 module screens) | **Not started** | n/a |
| Wallet connect, PQC key registration, hybrid-signed tx, EVM window open | **Not started** | needs a funded throwaway testnet account |
| QoreSeal encrypt/decrypt in the vault | **Not started** (package verified on npm) | n/a |
| Contract deployment, real payment, real rejection | **Not done** | needs a deployer account and your approval |
| AI agent behaviours (fraud review, procurement scoring, policy NL→JSON) | Provider ready; agent prompts/schemas **not written** | n/a |
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
