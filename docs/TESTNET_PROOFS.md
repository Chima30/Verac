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
