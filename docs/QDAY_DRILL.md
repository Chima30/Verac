# Q-Day Survivor drill (Build Before Q-Day, 18 November 2026)

On drill day a bot holds the drill account's **classical ECDSA key** and tries native transfers, EVM windows, EVM
transfers, token approvals and drain calls on the registered contracts. Verac's defence: the account's ML-DSA-87 key is
registered, so the classical key alone signs nothing the chain accepts, and the registered contracts give that key no
rights at all (the vault is also frozen for the day).

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
| Freeze: pause the vault, revoke the drill agent | all success | see "Freeze" below |

## Target contracts (enter these in the drill form)

| Contract | Address | Drill account's rights |
|---|---|---|
| Drill TreasuryVault (holds 5 QOR) | `0x7ce4667EAB18072123AD28eD8E76aA89B70e2e6C` | **None during the drill.** The vault is paused and the drill account's agent rights are revoked. It is not the owner, an approver or an approved recipient. Before the freeze it was a capped agent (0.5 QOR per payment, 1 per day, every payment needing the admin's approval). |
| Drill PolicyManager | `0xA74487E1D499c6B35Ff14320B2cb5B1b81d743cA` | None (owner is the admin) |

Verac's production contracts are deliberately **not** registered.

## Defence in depth

| Layer | What it stops | Evidence |
|---|---|---|
| 1. ML-DSA-87 key registered | Every native transaction signed with the classical key alone: QOR and fest-token transfers, opening an EVM window, linking a delegated key | Refused with `code 20, codespace pqc: ... must include the hybrid signature extension` |
| 2. No EVM window open | Every EVM transaction: transfers, ERC-20 approvals, contract calls | Refused before inclusion (`no-window`) |
| 3. No rights on the target contracts | Owner, approver and policy calls | Simulated calls revert `OwnableUnauthorizedAccount` / `NotApprover` |
| 4. Vault frozen | Any payment, even if every layer above failed | Simulated payments revert `EnforcedPause`; agent revoked |
| 5. Watch with auto-close | A window that somehow opened would be closed within one reading, with the hybrid key the bot does not have | Tested 2026-11-17: an admin window opened on purpose (`10BDBF59…3283`) was closed by the watch (`20257978…AF25`) |

## Freeze (2026-11-17, `pnpm qday:freeze --broadcast`)

Signed by the admin inside a short window that admitted only the vault (opened `6C9D2155…C25F`, closed
`D1157A1F…A1BC`): `pause()` `0x79375c32…43f3` and `revokeAgent(drill, native QOR)` `0x589bc977…f302`. Recorded under
`freeze` in `deployments/qday-drill.json`. The drill-day proof is a native transfer, so the freeze does not affect it.

## Verification (`pnpm qday:verify`)

30/30 checks passed on 2026-11-17 after the freeze; the full output is in `deployments/qday-drill-verification.json`.
It covers: both windows closed; the key registered; owners, approvers, freeze and vault balance; eleven attack calls
simulated from the drill address; and six live attempts signed with the classical key alone, all refused before
inclusion: native QOR transfer, native fUSD transfer, opening an EVM window, linking a delegated key (all
`code 20, codespace pqc`), an EVM transfer and an unlimited fUSD approval (both `no-window`). The QOR and fUSD balances
did not change. (An earlier run before the freeze passed 23/23 the same day.)

## Drill day (18 November, 00:00 to 23:59 UTC), in PowerShell

1. Start the watch in its own PowerShell window and leave it running all day (keep the computer awake):

```powershell
cd C:\Users\IN\Pictures\Qoore
pnpm qday:watch
```

2. In a second PowerShell window, soon after 00:00 UTC, send the proof transaction once:

```powershell
cd C:\Users\IN\Pictures\Qoore
$env:ACCOUNT_DIR = ".secrets/qday-drill"
pnpm chain:tx send qor1wez33dgwj0netgxhkslnzr2aq0u7888u4j0rc3 1 --broadcast
Remove-Item Env:ACCOUNT_DIR
```

A hybrid-signed (ECDSA + ML-DSA-87) native transfer of 1 QOR to the drill admin; it needs no EVM window. Check it with
`curl.exe -s https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/<HASH>` (look for `"code":0` and a
`pqc_hybrid_verify` event with `status` = `verified`), then submit the hash.

3. Do not open an EVM window, unpause the vault or run any other command for either drill account that day.
   `deployments/qday-watch.jsonl` keeps every reading as evidence for the write-up.
