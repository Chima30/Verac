# Testnet proofs

Only real, verifiable evidence goes here. Each entry needs a transaction hash that opens in the explorer
(https://explore.qore.network). Empty sections mean it has not happened.

## Read-only checks (no transaction)

2026-11-14, `pnpm chain:probe`, public endpoints:

| Check | Result |
|---|---|
| EVM chain id (`eth_chainId`) | `0x2648` = 9800 |
| Latest EVM block | 10,077,908 |
| `GET /qorechain/abstractaccount/v1/config` | `enabled: true`, max session keys 10, max spending rules 5 |
| `GET /qorechain/pqc/v1/evm_limits` | `tx_max_gas` 30,000,000; `precompile_input_max_bytes` 16,384 |
| `eth_call` with init code using `PUSH0` / `TLOAD` | accepted (no error) |

## Deployed contracts

None. (Addresses will be listed here with deployment tx hashes.)

## Transactions

| Claim | Tx hash | Explorer | Status |
|---|---|---|---|
| ML-DSA-87 key registered | | | not done |
| Hybrid-signed native transaction | | | not done |
| EVM window opened / read / closed | | | not done |
| Permitted agent payment through the vault | | | not done |
| Denied out-of-policy payment (revert / rejection evidence) | | | not done |
| Escrow funded, milestone released | | | not done |
| Classical-key-only window attempt rejected | | | not done |

## Post-Quantum AI Agents category proofs (scripted, 2026-11-16)

`packages/qorechain/scripts/category-proofs.ts` proves the window and native smart-account limits on a **dedicated throwaway account**. It refuses to run as the owner, agent or approver. It is a dry run by default. With `--broadcast`, it appends exactly what the chain returned to `deployments/category-proofs.json`, which Live Proof and the Quantum Simulator read.

**Status: run on 2026-11-17, all passed.** The dedicated account was `qor1mx24zdf8j5wxcjx9v8e38u4quwk9luxltk5dpv` (fresh, funded from the faucet, ML-DSA-87 key registered with proof of possession in `C6C68E97…A00A`). The results are in `deployments/category-proofs.json`, and Live Proof shows B, C1, D, E and F as verified on chain. Refusals of window limits happen before block inclusion, so their evidence is the RPC error plus the window read back before and after, not a transaction hash.

A first attempt at the delegated-key payments sent them to the account itself, which the chain refuses ("recipient must differ from the account"). Those refusals proved nothing about the limits and were not recorded. The script now pays the `0x…dEaD` burn address, records refusals with their reason, and links a fresh key on every `aa-link`; the F sequence was then run again from a new key. The earlier link and revoke of the first key remain in the file as history; Live Proof uses the latest run of each check.

| Scenario | Proves |
|---|---|
| `window-count` | B: a second transaction in a 1-transaction window is refused |
| `window-value` | C: value plus fee above `maxValue` is refused (kept separate from the vault's contract caps) |
| `window-expiry` | D: a transaction after the expiry height is refused |
| `window-target` | E: a vault-only window admits the vault and refuses another target |
| `aa-link`, `aa-within`, `aa-over-per-tx`, `aa-over-daily`, `aa-wrong-denom`, `aa-revoke`, `aa-after-revoke`, `aa-replay` | F: a delegated ed25519 key with proof of possession, send-only permission, 24 h expiry, per-transaction and daily limits, uqor only; revocation; nonce replay. Each execution's own result is checked, because a code-0 envelope can carry a failed execution. |
