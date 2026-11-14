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

## Reporting

Hackathon project; open an issue on the repository.
