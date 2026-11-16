# Security

**No external audit has been performed.** Tests are evidence of intended behaviour, not a guarantee. Testnet only; mainnet is
disabled in code (`assertTestnet`, DB check `chain_id = 9800`).

## Rules of the codebase

1. An LLM never authorises anything. Model output → Zod schema → deterministic check → (human) → contract.
2. No private keys, seed phrases or API keys in Git, logs, prompts or the browser. `.env` is git-ignored; the AI provider refuses
   to send text that looks like a key or seed phrase.
3. Server-only secrets never use `NEXT_PUBLIC_`.
4. Agents get typed capabilities, not arbitrary calls. `payments.submit` exists only for `PaymentAgent`, behind the pipeline.
5. Every financial change is an audit event; `audit_events` is append-only (trigger).

## What PQ security does and doesn't give us

* Gives: native transactions need an ML-DSA-87 co-signature; EVM spending needs a hybrid-signed window; stolen classical key ≠ open window.
* Doesn't: EVM transactions themselves are secp256k1-only. A window that is open bounds a classical-key thief by its limits; the
  window's native cap does not price ERC-20 transfers (we bound those with `allowed_targets` and vault caps).
* QoreSeal protects content, not metadata (addresses, timing, sizes, recipient count). Removing a recipient cannot revoke plaintext
  they already decrypted. QoreSeal's spec is a pre-1.0 draft pending external review.
* The agent HMAC bus is classical symmetric authentication inside one trust domain.

## Server-managed signing (testnet only)

The website can send real **testnet** payments (Treasury, Live payments). This is a **development signing path, not production
custody**, and it has had no external audit. How it is bounded, and what it does not protect against:

**Bounds**
* QoreX cannot send contract calls today (its EVM provider has no `eth_sendTransaction`), so the server signs with two
  throwaway keys held only in Vercel Sensitive variables: an **agent** (executePayment, fundEscrow) and a **separate approver**
  (approvePayment). The signer builds the call itself from structured fields; it never accepts calldata from a request, Gemini
  or the browser, and the server refuses to start if both keys are the same account.
* The vault enforces, whatever the website does: 10 QOR per payment, 20 QOR per day, no amount auto-approved, a validity date,
  approved recipients only, and an approval threshold. The website adds its own 10 QOR guard.
* A payment needs a request, a **different** administrator's approval (password re-entered), and an explicit Execute click.
  The approval is bound to the payment hash (chain, vault, agent, token, recipient, amount, purpose, policy version, expiry,
  nonce); any change makes a different hash and voids it. Before sending, the server recomputes the hash and the calldata
  hash and checks them against the stored ones and the vault's own `paymentHash`.
* Each send happens inside a short EVM window (120 blocks, 3 transactions, 2 QOR cap) that admits only the vault, closed
  afterwards. A result is CONFIRMED only when the receipt is read back from the chain and contains the vault's event for that exact hash.
* `LIVE_EXECUTION_ENABLED` (must be exactly `true`) and `LIVE_EMERGENCY_STOP` stop all signing without a code change. The owner can
  also `revokeAgent` on the vault. Every step writes an audit event; the on-chain approval is recorded as sent by the server relay.

**Not protected against**
* Anyone who can read the Vercel environment variables or the server's memory can use the agent and approver keys, within the
  limits above. Treat any exposure as a leak and rotate (new account, new limits).
* The server holds both keys, so a compromised server can both approve and pay, up to the vault's caps. The caps, not the
  server, are the control. The approver is a relayer for human approvals recorded in Verac; the contract cannot tell a human decision from a relayed one.
* Application-level approvals live in Supabase; a database administrator could alter them (the audit log blocks edits but is not signed or anchored on chain).
* A single owner key still configures the vault. It is not a multisig.
* The post-quantum protection covers the account windows; the EVM transactions themselves are classical secp256k1.

## Custody audit (2026-11-16)

Question: can the server approve and execute a payment without a genuinely authenticated administrator decision?

* **Through any HTTP endpoint: no.** The only code that loads the agent and approver keys for signing is `runLiveExecution`, called only by `POST /api/live/execute`. That route needs a signed-in finance user. It then calls `live_claim_execution`, which refuses any operation not in state `APPROVED`. Only `decide_live_payment` can set `APPROVED`: the caller must be an owner or administrator who is not the requester, and the route first re-checks their password. `proposeLivePayment` reads only the agent's public address.
* **The agent workflow never executes or approves.** It prepares requests through `proposeLivePayment` as the person who started it, so that person can never approve them. It cannot call the decide or execute paths.
* **With control of the server: yes, up to the vault's caps.** Two keys stored on one server are not two independent security domains. Anyone with the server's environment or memory can relay an approval and execute. The vault's on-chain limits (10 QOR per payment, 20 per day, approved recipients, approval threshold) are the boundary that holds then. The fix is for the approver to sign `approvePayment` from their own wallet. QoreX's EVM provider does not support `eth_sendTransaction` yet, so this is not built.

## Agent messages and untrusted documents

* Agent messages are HMAC-SHA256 with one key per agent (and one for the coordinator), derived by HKDF from `AGENT_MESSAGE_ROOT_SECRET`. This authenticates messages inside Verac's server. **It is not a post-quantum signature**, and the only party that holds the root secret is the same server.
* A message is rejected for:
  * a bad tag (spoofed sender, altered payload, foreign secret);
  * expiry or a time in the future;
  * a replayed nonce (memory, plus a unique `(organisation, nonce)` in `agent_messages`);
  * the wrong organisation, task or recipient, or a payload naming a different task than its envelope;
  * an unauthorised sender, or unknown fields.

  See `messaging-attacks.test.ts`.
* Invoice and milestone text is untrusted. Instructions inside it are flagged as `INSTRUCTION_IN_INVOICE` / `PROMPT_INJECTION` and hold the invoice. Eligibility is decided by fixed code, so text can never change a decision. Gemini sees only the user's own instruction, wrapped as untrusted and checked against fixed rules. It sees no invoice text and no sealed documents.

## Reporting

Hackathon project; open an issue on the repository.
