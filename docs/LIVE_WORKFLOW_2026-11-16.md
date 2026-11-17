# First agent-workflow payment on Diana testnet (2026-11-16)

This is the first payment that came from Verac's multi-agent invoice workflow rather than a payment typed in by hand. It ran end to end on the deployed site (verac-web.vercel.app) with synthetic demo invoices.

| Step | Who | Result |
|---|---|---|
| Instruction | A finance manager | "Review our three outstanding contractor invoices, check whether their milestones were approved, flag anything suspicious, and prepare eligible payments." Parsed by Gemini (gemini-3.5-flash-lite) and checked against fixed rules. |
| Agents | Invoice, Milestone, Security, Treasury, Policy, Payment | DEMO-A-101 (1.25 QOR) ELIGIBLE: vendor record matches, milestone approved, within cap, allowance and balance. DEMO-B-102 ON HOLD: milestone not approved. DEMO-C-7 ON HOLD: payout address differs from the vendor record, invoice text contains an injected instruction, recipient not on the vault. |
| Request | Payment Agent, as the finance manager | Live testnet request, payment hash `0x5c6e8b53572356a3a40f0d5716d4909ff26039f2880b459a92d2c09c480686b5`, 1 administrator approval required, policy v1. |
| Approval | A different administrator (password re-entered) | Relayed on chain by the server's approver key: `0xc58c67a3cb9c83b8d9d58240cc32d89b0cb45e33ca224c95a7acc7d75cdd691e`, block 10202336, status success. |
| Payment | The bounded agent key `0x7615DAb4651b47f69F80305f89F39B211F829dd7` | `0x5007c5d6bbde27022f38958d4b6d1a7d78bf48d825e665be7ba04daeeb0a8dd6`, block 10202342, status success. |

## How it was checked

The payment receipt was read back from `https://evm-testnet.qore.host`. It contains the TreasuryVault's `PaymentExecuted` event with:

- `paymentHash` equal to the hash Verac stored and the administrator approved;
- `agent` = `0x7615…9dd7`, `to` = `0x200caD3c9De63D3613A33fc20b1ef31CB4dbF5AF`;
- token = native QOR, `amount` = 1250000000000000000 (1.25 QOR), `policyVersion` = 1.

The approval transaction succeeded against the vault. Only its status was checked independently here; its event was not decoded. Both transactions are listed on Live Proof under "Agent workflow payment, 2026-11-16" and are re-read from the chain whenever the page is built.

## The earlier hold, and why it was correct

The first live runs held DEMO-A-101 with `SAME_PAYMENT_RECENTLY`. The demo invoice then asked for exactly 1 QOR to the same address that received the real 1 QOR website payment on 2026-11-15. The Security Agent was right to hold it. The demo was changed to 1.25 QOR, so the eligible case does not collide with real payment history.

## What this does not show

- The invoices are synthetic demo data.
- The approval is relayed by a server-held approver key after a person approves in Verac. Both signing keys live on the same server; see SECURITY.md.
- The native smart-account (delegated key) and window-limit proofs are separate; they were run on 2026-11-17 on a dedicated account (see CATEGORY_COMPLIANCE.md and TESTNET_PROOFS.md).
