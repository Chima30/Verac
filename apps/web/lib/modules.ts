/**
 * Honest status for routes whose UI is not built yet. Each entry says what exists in the repository today
 * (contracts, policy engine, agents) and what is missing. Nothing here pretends to be a working feature.
 */
export interface ModuleInfo {
  title: string;
  description: string;
  agent?: string;
  exists: string[];
  missing: string[];
}

export const MODULES: Record<string, ModuleInfo> = {
  tasks: { title: "Tasks", description: "Queue of agent work items and their pipeline states.", agent: "agent-coordinator",
    exists: ["Operation state machine (PROPOSED to CONFIRMED, FAILED terminal)", "Idempotent pipeline in services/agent-coordinator"],
    missing: ["Database-backed task list (needs a Supabase project)", "Task detail view"] },
  approvals: { title: "Approvals", description: "Human approval queue for payments that policy marks REQUIRE_APPROVAL.", agent: "PolicyAgent",
    exists: ["Policy engine decisions ALLOW / REQUIRE_APPROVAL / REJECT", "approvals and approval_signatures tables in migration 0001", "On-chain approval hash bound to chain, vault, agent, token, recipient, amount, purpose, nonce"],
    missing: ["Wallet connection and approval signing UI", "Supabase auth"] },
  activity: { title: "Activity", description: "Chronological feed of agent and user actions.",
    exists: ["Append-only audit_events table with trigger"], missing: ["Live feed (needs database and auth)"] },
  invoices: { title: "Bills and Invoices", description: "Invoice intake, fraud checks, and paying approved bills.", agent: "InvoiceFraudAgent",
    exists: ["InvoiceFraudAgent spec (no pay or approve tools)", "Unique constraint on org, vendor and invoice number in the schema"],
    missing: ["Invoice upload and extraction", "Fraud rules and Gemini prompts", "Payment execution wiring"] },
  payroll: { title: "Payroll", description: "Payroll batches prepared from contributor records.", agent: "PayrollAgent",
    exists: ["PayrollAgent spec (deterministic, proposes only)"], missing: ["Contributor records UI", "Batch builder", "Execution"] },
  revenue: { title: "Revenue", description: "Customer invoices and on-chain receipt reconciliation.", agent: "RevenueAgent",
    exists: ["RevenueAgent spec"], missing: ["Invoice issuing", "Receipt watcher"] },
  strategies: { title: "DCA and Rebalancing", description: "Scheduled buys and portfolio rebalancing. Simulation only until a verified venue exists.", agent: "StrategyAgent",
    exists: ["StrategyAgent spec (market.read, proposes only)"], missing: ["Strategy builder", "Verified venue (none identified, so everything stays SIMULATION)"] },
  arbitrage: { title: "Arbitrage Lab", description: "Net-profit-after-fees opportunity analysis. Simulation only.", agent: "ArbitrageAgent",
    exists: ["ArbitrageAgent spec (market.read only)"], missing: ["Quote collection", "Profit calculator UI"] },
  procurement: { title: "Procurement", description: "Tenders, encrypted bids, AI evaluation, award and milestone escrow.", agent: "ProcurementAgent",
    exists: ["MilestoneEscrow contract (18 passing Foundry tests)", "ProcurementAgent spec", "tenders, bids and awards tables"],
    missing: ["QoreSeal bid encryption flow", "Tender and bid UI", "Gemini evaluation prompts", "Deployment of contracts (needs your approval and a funded throwaway testnet account)"] },
  grants: { title: "Grants", description: "Grant applications, evaluation and milestone funding.", agent: "GrantAgent",
    exists: ["GrantAgent spec"], missing: ["Application UI", "Evaluation prompts"] },
  milestones: { title: "Milestones", description: "Milestone evidence review and escrow release.", agent: "MilestoneAgent",
    exists: ["MilestoneEscrow contract with release, dispute and refund paths"], missing: ["Evidence upload", "Release UI", "Deployed escrow"] },
  governance: { title: "DAO Governance", description: "Proposal summaries and treasury impact analysis.", agent: "GovernanceAgent",
    exists: ["GovernanceAgent spec (does not vote or execute)"], missing: ["Proposal ingestion", "Impact analysis UI"] },
  disputes: { title: "Disputes", description: "Evidence summaries and resolution proposals.", agent: "DisputeAgent",
    exists: ["Dispute states in MilestoneEscrow"], missing: ["Evidence UI", "Resolver actions"] },
  vault: { title: "Document Vault", description: "Multi-recipient post-quantum encrypted documents (QoreSeal).", agent: "DocumentAgent",
    exists: ["DocumentAgent spec (never holds plaintext or keys)", "documents and document_recipients tables", "Live QoreSeal KEM-key lookup in the Quantum Simulator page"],
    missing: ["Browser-side encryption and decryption", "Storage upload", "Recipient key registration"] },
  threats: { title: "Threat Center", description: "Anomaly detection, permission drift, pause and revoke requests.", agent: "SecurityAgent",
    exists: ["SecurityAgent spec", "TreasuryVault guardian pause and agent revoke"], missing: ["Detection rules", "Alert feed", "Deployed vault"] },
  "settings/organization": { title: "Organisation", description: "Organisation profile and members' roles.",
    exists: ["organizations, members tables with RLS (14 isolation tests)"], missing: ["Onboarding flow and auth"] },
  "settings/team": { title: "Team Members", description: "Invite members and assign roles.",
    exists: ["Role model and has_role helper"], missing: ["Invites", "Auth"] },
  "settings/notifications": { title: "Notifications", description: "Alert routing preferences.",
    exists: ["notify.send tool in the agent allow-lists"], missing: ["Channel configuration"] },
  "settings/audit": { title: "Audit History", description: "Tamper-evident record of operations.",
    exists: ["audit_events append-only table", "AuditAnchor contract for on-chain hash anchoring"], missing: ["Query UI", "Anchoring job", "Deployed AuditAnchor"] },
};
