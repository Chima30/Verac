# Demo script (target flow; not yet runnable)

Organisation: Nova DAO. Amounts are **sample scenario data** on testnet QOR; the three bids (280 / 260 / 295 QOR) are fictional.

Nothing below can be demonstrated until the web app, deployment and QoreSeal flows exist. Steps marked ✅ have supporting code/tests;
steps marked ⬜ do not.

| # | Step | Needs | State |
|---|---|---|---|
| 1 | Create org, vault, agent limits | UI, deployed contracts | contracts ✅ / rest ⬜ |
| 2 | Publish tender | UI + DB | schema ✅ / rest ⬜ |
| 3 | Three vendors submit sealed bids | QoreSeal | ⬜ |
| 4 | Reviewers decrypt; ProcurementAgent recommends | QoreSeal + Gemini key | provider ✅ / rest ⬜ |
| 5 | Admin awards Vendor B; milestones 60/100/100 | UI + escrow | escrow ✅ / rest ⬜ |
| 6 | Vault funds escrow (`fundEscrow`) | deployment + agent key | contract ✅ / live ⬜ |
| 7 | Evidence sealed; reviewer approves; **real 60 QOR release tx** | deployment | ⬜ |
| 8 | Duplicate invoice, changed wallet: held, payment refused | fraud agent | pipeline ✅ / agent ⬜ |
| 9 | Throwaway account: classical key alone can't open a window | funded account, PQC key | ⬜ |
| 10 | Audit page: tender, commitment, decisions, tx hash, rejected attempt | UI | ⬜ |

3-minute video outline: 0:00 problem + dashboard · 0:20 agent limits · 0:45 sealed bid + AI evaluation · 1:15 milestone + real tx ·
1:45 fraud + rejection · 2:15 PQ authorisation evidence · 2:40 audit trail + repo.
