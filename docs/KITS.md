# QoreChain kits used by Verac

Checked against https://build.qorechain.io/kits on 2026-11-16. Only real uses are listed.

| Kit | Version | Where it is used |
|---|---|---|
| QoreChain SDK (`@qorechain/sdk`) | 0.14.0 | `packages/qorechain`: chain reads, hybrid secp256k1 + ML-DSA-87 signing, EVM authorisation windows, receipts. Behind the live payment, the setup scripts and the Proof page's chain checks. |
| QoreSeal (`@qorechain/qoreseal`) | 0.1.0 | `packages/qorechain` and `apps/web`: browser-side ML-KEM-1024 encryption of bids, milestone evidence and vault documents. |
| QoreX wallet mock (`@qorechain/qorex-wallet-mock`) | 0.1.0 | `apps/web/lib/qorex.wallet-mock.test.ts`: tests Verac's QoreX helpers (connect, network check, declined request, refused `eth_sendTransaction`) against the Association's own test double of the wallet. Dev dependency only. |
| QoreScan (`@qorechain/qorescan`) | 0.1.0 | Run on 2026-11-16 against testnet, the owner, agent and approver accounts, `verac-web.vercel.app:443` and `contracts/src`. Output: `docs/evidence/cbom-testnet.json` (CycloneDX 1.6 CBOM). Not run in CI. |

`@qorechain/pqc`, `@qorechain/qoresign` and `@qorechain/evm` reach the project only as dependencies of the SDK. Verac does not import them directly.

## Kits not used

QoreX integrations for wagmi, RainbowKit, cosmos-kit and Interchain Kit (the wallet panel talks to the QoreX provider directly), the Synpress fixture, wallet adapter, RDK, MCP server and `qore` CLI, Asset Kit, custody kit, chain bridge, handles, PQ light client and `create-qorechain-dapp`. Verac has no use for them today and does not claim them.

## What the CBOM is and is not

QoreScan's own disclaimer applies: it is an inventory aid, not a certification, an audit or a legal opinion. It lists 19 cryptographic assets, including ML-DSA-87 and ECDSA secp256k1 on the chain, and the TLS 1.3 endpoint of the deployed site (hybrid X25519MLKEM768 key exchange, RSA certificates).
