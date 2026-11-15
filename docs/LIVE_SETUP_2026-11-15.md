# Live execution setup on Diana testnet, 2026-11-15

Testnet only (chain 9800, `qorechain-diana`). Every transaction below was approved by the project owner in chat before it was sent, was first run as a dry run (simulated against the chain, nothing sent), and was read back from the chain afterwards. Explorer: `https://explore.qore.network/tx/<hash>`.

| # | Operation | Result | Transaction |
|---|---|---|---|
| 1 | Open vault-only EVM window (owner; 120 blocks, 3 txs, 2 QOR cap) | success | `01FFA4EB67E7104C47442C4463D850ED95F813EBB779BC3674F93D776582E533` |
| 2 | `TreasuryVault.setAgentLimits(agent 0x7615…9dd7, native QOR, perTx 10, daily 20, autoApprove 0, valid 7 days)` | success, read back: MATCHES | `0x99a053ab48231f5cc2b3178572cb09d5235e4c98d754bea4606bd5f30838359d` |
| 3 | Close owner window | success | `DF0770056DF9D618AE2F9517C4F3CF899901024029847D7015D0D4A32E2B9456` |
| 4 | Create dedicated approver account `0x0Db385bBa0D24d47F1a73EDE8df84FAce785f91A` (`qor1pkectwaq6fx50ud88m0gm7z04nnct7g6px5cha`), keys saved to a gitignored local file | local only | none |
| 5 | Fund approver with 3 QOR (owner, `MsgSend`) | success | `070B298989C01145604163E3FCB3612EAFE32A6F0293AEB561DED701354CEDDE` |
| 6 | Register approver's ML-DSA-87 key (`MsgRegisterPQCKeyV2`) | success | `E11E283A7F256347C3B31F4EA99F80B149C9DEF5133C870828D0228A1C6A6FCF` |
| 7 | Open vault-only EVM window (owner) | success | `C3180406886C9ED7325F228679FE21B82E98ACFAC43057617A209C442A10E94B` |
| 8 | `TreasuryVault.setApprover(0x0Db3…f91A, true)` | success, read back: isApprover true, approverCount 2 | `0x51daf2af7cc8e62916750b50645ffce27bfed9a523df09d2f68970b93d3b2a44` |
| 9 | Close owner window | success | `0FB3FCB7B34E6F7805AD347A9FCCAFC3B6978D62FACE054F43E40E8FCE5D5BAD` |

## State after setup (read from the chain)

- Vault balance 10 QOR, not paused, approval threshold 1, approver count 2 (the owner and the new approver).
- Agent `0x7615…9dd7`: active, 10 QOR per payment, 20 QOR per day, **no amount is auto-approved**, authority valid until 2026-11-22 12:01:32 UTC. It is not an approver.
- Approver `0x0Db3…f91A`: registered approver, about 2.78 QOR for fees and windows.

## What this does and does not mean

- No payment has been made through the website yet. The kill switch (`LIVE_EXECUTION_ENABLED`) is still off.
- The agent and approver are different accounts, and the contract enforces the agent's limits whatever the website does.
- Keys are throwaway testnet keys held server-side. This is a development signing path, not production custody, and the contracts have had no external audit.
- The agent's authority expires on the date above. After that, executions revert until the owner runs `setAgentLimits` again (`tsx packages/qorechain/scripts/owner-ops.ts set-agent-limits --broadcast`).
- Emergency stop: set `LIVE_EMERGENCY_STOP=true` in Vercel, and/or have the owner call `revokeAgent` on the vault.

Helper scripts: `packages/qorechain/scripts/owner-ops.ts` (dry run by default) and `live-state.ts` (read-only).
