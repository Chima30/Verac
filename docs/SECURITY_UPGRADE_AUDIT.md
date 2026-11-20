# Security upgrade audit (2026-11-19)

Branch `feat/security-upgrade`. This audit checks five weaknesses raised in an evaluation of Verac against the actual
code and the live state of Diana testnet. Everything marked *read on chain* was read on 2026-11-19 with
`packages/qorechain/scripts/probe-roles.ts` (read-only).

## Actual trust boundaries today

| Boundary | Who is inside it | What it holds |
|---|---|---|
| **Website server** (Vercel functions) | Next.js routes, the agent coordinator, the live executor | `AGENT_EVM_PRIVATE_KEY` + `AGENT_MLDSA_*`, `APPROVER_EVM_PRIVATE_KEY` + `APPROVER_MLDSA_*`, `SUPABASE_SERVICE_ROLE_KEY`, `AGENT_MESSAGE_ROOT_SECRET`, `GEMINI_API_KEY` |
| **Supabase** | Database, RLS policies, SECURITY DEFINER functions | Approval records, audit events, workflow state. The service-role key bypasses RLS. |
| **Owner key** (local file, `.secrets/testnet-account.json`) | One person's computer | Owner of TreasuryVault, PolicyManager, MilestoneEscrow and AuditAnchor (`0x5B10…70F2`, read on chain) |
| **QoreChain** | Validators | Enforces PQC hybrid signatures, EVM windows, contract rules |

## Weakness 1: agent and approver keys on the same server. **Confirmed, with a bounded impact.**

Code: `apps/web/lib/live/config.ts` builds both signers from environment variables on the same server.
`apps/web/app/api/live/decide/route.ts` checks the administrator's password and then records the decision in the database;
`packages/qorechain/src/live-executor.ts` step 3 makes the server's **approver key** sign `approvePayment` on chain.
The person never signs anything. The password check and the database record are both inside the server's boundary.

Attack path (server compromise): the attacker holds both keys and the service-role key, so it can write an "approved"
row, relay an on-chain approval and execute. What still stops it (read on chain):

* The recipient must already be on the vault's approved list. Only the owner (`0x5B10…`, not on the server) can add one.
* `perTxCap` 10 QOR, `dailyCap` 20 QOR for the agent; the vault holds 7.75 QOR.
* The agent's rights expire on chain at **2026-11-22 12:01 UTC** (`validUntil` 1795348892), after which no payment runs
  until the owner renews them. This also stops the website's own payment path before the 2 December deadline.
  **Renewed on 2026-11-20** with the same caps (10 QOR per payment, 20 per day, no auto-approval) until 2026-12-06:
  `0xd2720eb7fd78893644ab89518f54b90fbf795e047aaf73af23a4d0ede90e6609` (block 10404324), `owner-ops.ts set-agent-limits --days 16`.

So the evaluation is right that human approval is not independent of the server, and slightly overstated in impact:
a compromised server can pay **approved recipients only, within the caps**. It can also spend the agent's and approver's
own fee balances (2.10 and 2.52 QOR): it holds their ML-DSA secrets, so it can open an unscoped window for either.

Can be demonstrated: yes, by simulation (the approval forged with the server's own keys succeeds today).
**Fix in this branch:** TreasuryVault V2, below.

## Weakness 2: native spending rules not in the real payment path. **Confirmed.**

`category-proofs.ts` proved delegated spending on a dedicated account; the website's payment path uses EVM windows plus
TreasuryVault rules only. Reading the authenticator documentation settles how the two can be combined:

* `MsgExecuteCosmos` moves native QOR through `x/bank` **from the canonical account**; the spending rule bounds that
  exact amount and denomination. It has **no recipient allow-list**.
* `MsgExecuteEVM` runs an EVM call from the account's 0x address; the rule bounds the call's attached value. A
  zero-value call to `TreasuryVault.executePayment` would make the **vault** pay, and that payout is **not** bounded by the
  native rule. Describing it as native spending-rule enforcement would be wrong.

**Fix in this branch:** a separate routine-payment path on the native lane (a canonical PQC account holding a small float,
a linked agent key bounded by a rule, an independent relayer), using the same task, approval and audit records.

## Weakness 3: the drill vault was frozen. **Confirmed.**

`docs/QDAY_DRILL.md` already says so: the capped-agent defence was not exercised against the bot. The original evidence
stays as it is. **Fix:** a new, isolated active-attack environment where a legitimate payment succeeds while attacks are
refused, with each result labelled by where it was stopped.

## Weakness 4: HMAC agent messaging. **Partly confirmed; mostly a documentation issue.**

`services/agent-coordinator/src/messaging.ts`: each agent has its own HKDF-derived HMAC key, and messages carry
sender, recipient, organisation, task, kind, issue time, expiry (max 5 minutes), a 128-bit nonce (persisted under a
unique `(organisation, nonce)` key) and a schema-checked payload. `messaging-attacks.test.ts` covers spoofing,
modification, replay, expiry and cross-organisation use.

All agents run in **one process** with the root secret, so per-agent keys protect against bugs and confused routing,
not against a compromise of that process. Independent (or ML-DSA) agent keys would add security only if agents ran in
separate trust domains, which they do not. Adding post-quantum signatures here would be decoration. Agent messages carry
findings only; **no message can move money**: payments need the on-chain checks in weakness 1. **Outcome:** keep HMAC,
document the boundary, keep the attack tests.

## Weakness 5: single owner key. **Confirmed (read on chain).**

`0x5B108321e824faf53AA198fcD1682A07a68970F2` owns TreasuryVault, PolicyManager, MilestoneEscrow and AuditAnchor (no
pending transfers). It is also one of the vault's two approvers (`approvalThreshold` 1, `approverCount` 2). Whoever
holds that one key can add recipients, raise caps, add agents and change policy. The key is not on the server.

No reviewed multisig (for example Safe) is known to be deployed on Diana, and no existing multisig can verify
post-quantum signatures. **Fix in this branch:** TreasuryVault V2 has no owner. Every administrative change needs a
threshold of distinct administrators' ML-DSA-87 signatures, verified on chain. The existing contracts are not changed.

## What makes a stronger fix possible

Checked on 2026-11-19 (`packages/qorechain/scripts/probe-pqc-precompile.ts`, read-only `eth_call`):

* QoreChain's **PQC Verify** precompile (`0x…0A01`) is active on Diana. An ML-DSA-87 signature made with the SDK's
  `pqcSign` verified as `true`; a changed message and a changed signature both returned `false`. About 312,000 gas.
* **PQC Key Status** (`0x…0A02`) returned the account's registered 2,592-byte key with `possessionProven` true.
* QoreX does **not** support `personal_sign` or `eth_signTypedData_v4` yet (listed as planned), so a browser
  EIP-712 approval in QoreX is not possible today.

So administrators can approve with their **own ML-DSA-87 keys**, and the vault can check those signatures against the
keys the chain has on record. This is stronger than EIP-712 (which would be a classical secp256k1 signature) and does
not depend on QoreX features that do not exist yet.

## Plan, in order of risk

1. TreasuryVault V2: payments and admin changes authorised by a threshold of administrators' on-chain-verified
   ML-DSA-87 signatures; no owner key; the server only relays. Foundry tests with mocked precompiles; live proof on testnet.
2. Administrator signer (CLI on the administrator's own computer) and a relay route; the website never sees the key.
3. Native routine-payment path (delegated agent key, rule, independent relayer).
4. Active-attack environment and Live Proof labels.
5. Receipts, signed-in browser tests, documentation, demo script.

Nothing in this branch changes, migrates or pauses the existing deployed contracts.
