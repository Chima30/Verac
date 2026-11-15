import { AGENTS, type AgentSpec } from "@qoreops/agent-coordinator";

/** Plain-English meaning of each tool, for people who do not read code. */
export const TOOL_TEXT: Record<string, { label: string; detail: string; risk: 0 | 1 | 2 | 3 }> = {
  "db.read": { label: "Read organisation records", detail: "Can look at records your organisation stores in Verac.", risk: 0 },
  "db.write.drafts": { label: "Write drafts and recommendations", detail: "Can save suggestions for people to review. Never changes financial state.", risk: 0 },
  "notify.send": { label: "Send notifications", detail: "Can tell people that something needs their attention.", risk: 0 },
  "chain.read": { label: "Read the blockchain", detail: "Can read balances, contracts and transactions on Diana testnet.", risk: 0 },
  "market.read": { label: "Read market quotes", detail: "Can read prices. Has no trading access.", risk: 0 },
  "ai.analyze": { label: "Ask Gemini for analysis", detail: "Sends text to the shared, rate-limited Gemini service. The answer is advice only.", risk: 1 },
  "docs.read.ciphertext": { label: "See encrypted documents", detail: "Can see that a document exists and its checksum, not its contents.", risk: 0 },
  "docs.decrypt.authorised": { label: "Read a document you open for it", detail: "Only after a person explicitly opens that document for this task.", risk: 1 },
  "policy.evaluate": { label: "Check against policy", detail: "Runs the fixed policy rules on a proposed action.", risk: 0 },
  "payments.propose": { label: "Propose a payment", detail: "Can draft a payment request. A person must approve it before anything moves.", risk: 2 },
  "payments.submit": { label: "Submit an approved payment", detail: "Sends a payment that passed policy and human approval. The vault contract still enforces its limits.", risk: 3 },
  "security.pause.request": { label: "Ask for a pause", detail: "Can request that the vault be paused. A person or guardian key carries it out.", risk: 1 },
};

export type Authority = "submit" | "propose" | "draft" | "read";
export const AUTHORITY: Record<Authority, { label: string; detail: string }> = {
  submit: { label: "Submits approved payments", detail: "Only after policy checks and human approval, and only within the vault's on-chain limits." },
  propose: { label: "Proposes payments", detail: "Can draft a payment request. It cannot approve or send it." },
  draft: { label: "Drafts and recommends", detail: "Writes analyses and suggestions. It cannot touch funds." },
  read: { label: "Reads only", detail: "Looks things up. It cannot write anything that matters." },
};
export function authorityOf(a: AgentSpec): Authority {
  const t = a.tools as readonly string[];
  if (t.includes("payments.submit")) return "submit";
  if (t.includes("payments.propose")) return "propose";
  if (t.includes("db.write.drafts")) return "draft";
  return "read";
}

export const GROUPS: Array<{ id: string; title: string; description: string; agents: string[] }> = [
  { id: "finance", title: "Finance", description: "Money in and out of the treasury.", agents: ["PaymentAgent", "TreasuryAgent", "InvoiceFraudAgent", "PayrollAgent", "RevenueAgent"] },
  { id: "operations", title: "Operations", description: "Projects, tenders, grants and their evidence.", agents: ["ProcurementAgent", "GrantAgent", "MilestoneAgent", "DisputeAgent", "DocumentAgent"] },
  { id: "security", title: "Security", description: "Rules, anomalies and response.", agents: ["SecurityAgent", "PolicyAgent"] },
  { id: "intelligence", title: "Intelligence", description: "Analysis and simulations that inform decisions.", agents: ["GovernanceAgent", "StrategyAgent", "ArbitrageAgent"] },
];

/** Where each agent's work actually happens in the app. */
export const AGENT_HOME: Record<string, { href: string; label: string }> = {
  TreasuryAgent: { href: "/treasury", label: "Treasury" }, PaymentAgent: { href: "/approvals", label: "Approvals" },
  InvoiceFraudAgent: { href: "/invoices", label: "Bills & Invoices" }, ProcurementAgent: { href: "/procurement", label: "Procurement" },
  GrantAgent: { href: "/grants", label: "Grants" }, MilestoneAgent: { href: "/milestones", label: "Milestones" },
  DocumentAgent: { href: "/vault", label: "Document Vault" }, PolicyAgent: { href: "/policies", label: "Policies" },
  SecurityAgent: { href: "/threats", label: "Threat Center" }, PayrollAgent: { href: "/payroll", label: "Payroll" },
  RevenueAgent: { href: "/revenue", label: "Revenue" }, GovernanceAgent: { href: "/governance", label: "DAO Governance" },
  StrategyAgent: { href: "/strategies", label: "DCA & Rebalancing" }, ArbitrageAgent: { href: "/arbitrage", label: "Arbitrage Lab" },
  DisputeAgent: { href: "/disputes", label: "Disputes" },
};

/** Words that send an instruction to the agent that handles it. Deterministic: no AI decides the routing. */
export const ROUTING: Record<string, string[]> = {
  PaymentAgent: ["pay", "payment", "send", "transfer", "execute"],
  TreasuryAgent: ["treasury", "balance", "forecast", "runway", "funds", "cash"],
  InvoiceFraudAgent: ["invoice", "bill", "fraud", "suspicious", "duplicate", "unpaid"],
  PayrollAgent: ["payroll", "salary", "salaries", "contributor", "wages"],
  RevenueAgent: ["revenue", "receivable", "collect", "incoming", "customer"],
  ProcurementAgent: ["procurement", "tender", "bid", "supplier", "vendor", "rfp"],
  GrantAgent: ["grant", "applicant", "application", "funding round"],
  MilestoneAgent: ["milestone", "evidence", "release", "escrow", "deliverable"],
  DisputeAgent: ["dispute", "complaint", "case", "disagreement"],
  DocumentAgent: ["document", "file", "upload", "encrypt", "contract pdf"],
  SecurityAgent: ["security", "threat", "attack", "compromise", "anomaly", "stolen", "key"],
  PolicyAgent: ["policy", "rule", "limit", "allowance"],
  GovernanceAgent: ["proposal", "vote", "dao", "governance"],
  StrategyAgent: ["dca", "rebalance", "allocation", "strategy"],
  ArbitrageAgent: ["arbitrage", "spread", "price difference"],
};

export const agentList = () => Object.values(AGENTS);
