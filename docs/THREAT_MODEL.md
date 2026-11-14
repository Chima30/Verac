# Threat model

Status key: ✅ mitigated and tested locally · 🟡 mitigated by design, live proof pending · ⬜ not yet addressed.

| Threat | Mitigation | State |
|---|---|---|
| Stolen classical key | Native txs need hybrid sig; EVM txs need an open window opened only by hybrid-signed message; window bounds blocks/txs/value/targets | 🟡 documented chain behaviour; live demo pending |
| Compromised agent key | Vault caps (per-tx, daily, expiry), approvals above ceiling, guardian pause/revoke | ✅ contract tests |
| Delegated-key limits don't bind the owner key | Vault enforces independently; owner cannot withdraw directly | ✅ `test_owner_has_no_direct_withdrawal_path` |
| Malicious invoice / changed recipient | New recipient ⇒ approvals; DB unique (vendor, invoice no.); risk screen blocks | ✅ pipeline + RLS tests; fraud agent ⬜ |
| Prompt injection in vendor docs | `<untrusted>` wrapping; strict schema rejects extra fields; model has no tools/keys; output never authorises | ✅ provider tests |
| Replay of approved payment | `executed[hash]`, nonce in hash, expiry, idempotency keys | ✅ |
| Modified payment after approval | Approval bound to full hash | ✅ incl. fuzz |
| Cross-tenant access | RLS on all tenant tables, `force row level security` | ✅ 14 tests (PGlite) |
| Vendor sees other bids | bids/documents policies | ✅ |
| Unauthorised decryption | QoreSeal recipient-based; server sees only ciphertext | ⬜ |
| Agent impersonation / privilege escalation | per-agent HKDF keys, HMAC, nonce+TTL, sender/recipient allow-list, tool allow-list | ✅ |
| Unapproved policy change | `PolicyManager` owner-only; version bump invalidates approvals; UI approval ⬜ | 🟡 |
| Escrow manipulation / double release | state flip before transfer, `nonReentrant`, reviewer-only approve, payer-only fund | ✅ |
| Hostile project naming vault as payer | `createProject` limited to payer/creators; vault checks `projectPayer`, `projectToken` | ✅ |
| Oracle / stale price | no on-chain price oracle used; strategy modules are simulations with timestamped quotes | ⬜ |
| Failed delegated execution looks like success | pipeline requires matching vault event; AA failure events to be checked | 🟡 |
| Gemini leaks confidential data | no auto-send of decrypted docs; secret detector; synthetic demo data; free-tier training caveat documented | 🟡 explicit-consent UI ⬜ |
| Relayer key theft | testnet-only throwaway account, server-side only, hard max per tx | ⬜ service not built |
| Admin collusion / lost keys | threshold approvals, guardians; no recovery beyond owner re-adding agents | documented |

Out of scope: external audit, MEV, validator-level attacks, UI phishing, mainnet.
