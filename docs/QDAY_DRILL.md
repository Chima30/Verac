# Q-Day Survivor drill (Build Before Q-Day, 18 November 2026)

On drill day a bot holds the drill account's **classical ECDSA key** and tries native transfers, EVM windows, EVM
transfers, token approvals and drain calls on the registered contracts. Verac's defence: the account's ML-DSA-87 key is
registered, so the classical key alone signs nothing the chain accepts, and the registered contracts give that key no
owner or approver rights.

## Accounts (testnet, fresh, shared with nothing else in Verac)

| Role | QOR address | EVM address | Keys (local, gitignored) |
|---|---|---|---|
| Drill account (key given to the bot) | `qor1gglakalsjlypwe7g7u7grxrf6m3aq32kzgu6ak` | `0x423Fdb77F097c81767C8f73C819869D6E3D04556` | `.secrets/qday-drill/` |
| Drill admin (owner and only approver; never shared) | `qor1wez33dgwj0netgxhkslnzr2aq0u7888u4j0rc3` | `0x764518B50E93e795a0d7B43F310D5d03f9e39cFc` | `.secrets/qday-admin/` |

Each folder holds `ecdsa-private-key.txt` and `pqc-recovery-code.txt` in separate files (as the QoreChain key-binding
guide advises) plus a public `account.json`. Only the drill account's `ecdsa-private-key.txt` goes into the drill form.

## On-chain setup (2026-11-17)

| Step | Result | Transaction |
|---|---|---|
| Faucet | 100 QOR received | (claimed by the team on dashboard.qorechain.io) |
| Register drill ML-DSA-87 key, with proof of possession | code 0, `possession_proven: true`, key matches | `2ADDCECA30636840DB1E04F6EA77323E86A2D8ACD3AEF4806F509DD0F62C920C` |
| Drill sends 20 QOR to the admin (hybrid) | code 0, `pqc_hybrid_verify` = verified | `6D3DE65D289DD9EB7ECC0D393913E088C8D7F7F9BE08CCD4638F4978CA7A203C` |
| Register admin ML-DSA-87 key | code 0 | `EC71DA808F2A50F9EA28C317E27EE848C05A7D56B84518B1D995E8C1C4F54699` |
| Admin window open, deploy, configure, fund, window close | all success | see `deployments/qday-drill.json` |

## Target contracts (enter these in the drill form)

| Contract | Address | Drill account's rights |
|---|---|---|
| Drill TreasuryVault (holds 5 QOR) | `0x7ce4667EAB18072123AD28eD8E76aA89B70e2e6C` | Capped agent only: 0.5 QOR per payment, 1 QOR per day, **every** payment needs the admin's approval; not an approver, not an approved recipient, not the owner |
| Drill PolicyManager | `0xA74487E1D499c6B35Ff14320B2cb5B1b81d743cA` | None (owner is the admin) |

Verac's production contracts are deliberately **not** registered.

## Verification (`npx tsx packages/qorechain/scripts/qday-verify.ts`)

23/23 checks passed on 2026-11-17; the full output is in `deployments/qday-drill-verification.json`. It covers:
both EVM windows closed; the key registered; owners, approvers, caps and vault balance; eleven attack calls simulated
from the drill address (each reverted with the expected error); and two live attempts signed with the classical key
alone, both refused before inclusion: a native transfer (`code 20, codespace pqc: ... must include the hybrid
signature extension`) and an EVM transfer (`no-window`). The account balance did not change.

## Drill-day transaction (18 November, 00:00 to 23:59 UTC)

Run once, from the repository root:

```bash
ACCOUNT_DIR=.secrets/qday-drill pnpm chain:tx send qor1wez33dgwj0netgxhkslnzr2aq0u7888u4j0rc3 1 --broadcast
```

A hybrid-signed (ECDSA + ML-DSA-87) native transfer of 1 QOR to the drill admin. It needs no EVM window, so windows
stay closed all day. Check it with
`curl -s https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/<HASH>` (look for `"code": 0` and a
`pqc_hybrid_verify` event with `status` = `verified`), then submit the hash.

Do not open an EVM window for either account on drill day.
