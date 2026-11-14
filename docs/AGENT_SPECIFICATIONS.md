# Agent specifications

Source of truth: `services/agent-coordinator/src/agents.ts` (tests assert the table below). Tools are capabilities; an agent
calling a tool outside its list is refused and the attempt is recorded. Only `PaymentAgent` has `payments.submit`.

| Agent | Module | Uses Gemini | Can move funds | Notable tools |
|---|---|---|---|---|
| TreasuryAgent | Treasury Assistant | yes | no | chain.read, policy.evaluate, payments.propose |
| PaymentAgent | Execution | no | **yes, only via pipeline** | payments.submit |
| InvoiceFraudAgent | Invoice fraud | yes | no | docs.decrypt.authorised, ai.analyze |
| ProcurementAgent | Procurement | yes | no | docs.read.ciphertext, docs.decrypt.authorised |
| GrantAgent | Grants | yes | no | same as procurement |
| MilestoneAgent | Milestones | yes | no | chain.read, payments.propose |
| DocumentAgent | Vault | no | no | docs.read.ciphertext (never plaintext/keys) |
| PolicyAgent | Policy builder | yes | no | ai.analyze, policy.evaluate (cannot activate) |
| SecurityAgent | Threat response | yes | no | security.pause.request |
| PayrollAgent | Payroll | no | no | payments.propose |
| RevenueAgent | Revenue | no | no | chain.read |
| GovernanceAgent | Governance | yes | no | ai.analyze |
| StrategyAgent | DCA/rebalance | no | no | market.read, payments.propose |
| ArbitrageAgent | Arbitrage lab | no | no | market.read (simulation only) |
| DisputeAgent | Disputes | yes | no | docs.decrypt.authorised |

Messages: `task.handoff`, `finding.report`, `payment.proposal.ready`, `security.alert`, `approval.requested`. Each is HMAC-signed with
a per-agent key, carries a nonce and ≤5-minute TTL, is checked against a sender→recipient allow-list and a per-kind strict schema, and
verifies once. Payloads are data only (ids, severities, short text); there is no field for code or calldata.

Per-agent prompts and output schemas are **not written yet**.
