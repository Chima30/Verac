# First payment made from the website, 2026-11-15

A 1 QOR payment on QoreChain Diana testnet (chain 9800), requested, approved and executed through the Verac website.

| Step | Who | Result |
|---|---|---|
| Request: 1 QOR to `0x200cad3c9de63d3613a33fc20b1ef31cb4dbf5af`, purpose "first live website test" | A signed-in finance user | Checked against live chain state, recorded as AWAITING_APPROVAL |
| Approve | A different administrator, password re-entered | 1 of 1 approval bound to the payment hash |
| Approval relayed on chain | Server's dedicated approver key (not the agent) | `0x1bd9aa176131f7486eca60e0291837f290f58f3f4995cd1fd6c1c9b8453000ac`, block 0x9ac066, status 1 |
| Payment | Server's bounded agent key | `0x75ac37df6b0f686616559ee4028ca51f101bc75d037d0066426b44fe984c0636`, block 10141804 (0x9ac06c), status 1 |

Payment hash: `0x7360e4fa4840be82234716d48233031ccf9b95547182afd51216d5b8a558181c`.

## Independently checked against the chain

- The payment receipt has status 1 and contains a vault event carrying exactly that payment hash, the agent as sender, the recipient above, and an amount of 1 QOR (`0x0de0b6b3a7640000`).
- The vault balance went from 10 QOR to 9 QOR.
- The agent is still not an approver; the approval came from the separate approver account `0x0Db385bB…f91A`.

## A failed first attempt, and the fix

The first attempt was refused with "The call that would be sent does not match the call that was approved. Nothing was sent." The database stores the amount and the 96-bit nonce as numbers and Supabase returns them as JSON numbers, which JavaScript rounds, so the call re-derived at execution differed from the approved one. The check worked as designed and no funds moved. The server now reads the exact amount and nonce as text when it claims an approved payment (commit 464a78d), and the second attempt above succeeded.
