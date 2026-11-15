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

## Reporting

Hackathon project; open an issue on the repository.
