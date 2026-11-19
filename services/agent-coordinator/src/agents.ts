import type { AgentId } from "@qoreops/shared-types";

/**
 * Tools are capabilities, not free-form commands. An agent may only invoke tools on its allow-list, and
 * `payments.submit` exists solely for the PaymentAgent behind the shared pipeline (policy -> approval -> simulate).
 */
export const TOOLS = [
  "db.read",
  "db.write.drafts", // writes recommendations / drafts, never financial state
  "chain.read",
  "ai.analyze",
  "docs.read.ciphertext",
  "docs.decrypt.authorised", // only after an explicit user authorisation for that document
  "policy.evaluate",
  "payments.propose",
  "payments.submit",
  "security.pause.request", // asks for a pause; a human or guardian key executes it
  "notify.send",
  "market.read",
  "web.read.public", // bounded, read-only research of applicant-supplied public links (GitHub API, QoreChain RPC, SSRF-guarded pages)
] as const;
export type Tool = (typeof TOOLS)[number];

export interface AgentSpec {
  id: AgentId;
  module: string;
  responsibilities: string;
  tools: readonly Tool[];
  usesAi: boolean;
  /** May this agent's output directly cause on-chain value movement? Only through the shared pipeline. */
  canMoveFunds: boolean;
  /** Messages this agent may send, and to whom. Enforced by the message bus. */
  mayMessage: readonly AgentId[];
}

const base = ["db.read", "db.write.drafts", "notify.send"] as const;

export const AGENTS: Record<AgentId, AgentSpec> = {
  TreasuryAgent: {
    id: "TreasuryAgent", module: "Treasury Assistant", usesAi: true, canMoveFunds: false,
    responsibilities: "Reads balances, obligations and history; forecasts and recommends; prepares funding proposals.",
    tools: [...base, "chain.read", "ai.analyze", "policy.evaluate", "payments.propose"],
    mayMessage: ["PaymentAgent", "PolicyAgent", "SecurityAgent"],
  },
  PaymentAgent: {
    id: "PaymentAgent", module: "Bill Payer / execution", usesAi: false, canMoveFunds: true,
    responsibilities: "The only agent that submits transactions, and only via the shared pipeline within delegated on-chain limits.",
    tools: [...base, "chain.read", "policy.evaluate", "payments.propose", "payments.submit"],
    mayMessage: ["SecurityAgent", "TreasuryAgent"],
  },
  InvoiceFraudAgent: {
    id: "InvoiceFraudAgent", module: "Invoice Fraud Detector", usesAi: true, canMoveFunds: false,
    responsibilities: "Detects duplicates, recipient changes and anomalous amounts; explains holds. Cannot approve or pay.",
    tools: [...base, "ai.analyze", "docs.decrypt.authorised"],
    mayMessage: ["SecurityAgent", "PaymentAgent", "TreasuryAgent"],
  },
  ProcurementAgent: {
    id: "ProcurementAgent", module: "Autonomous Procurement", usesAi: true, canMoveFunds: false,
    responsibilities: "Runs tenders, evaluates decrypted bids, writes recommendation reports. Humans approve awards.",
    tools: [...base, "ai.analyze", "docs.read.ciphertext", "docs.decrypt.authorised", "payments.propose"],
    mayMessage: ["DocumentAgent", "SecurityAgent", "PolicyAgent", "TreasuryAgent", "MilestoneAgent"],
  },
  GrantCoordinator: {
    id: "GrantCoordinator", module: "Grant Intelligence", usesAi: true, canMoveFunds: false,
    responsibilities: "Plans a grant investigation, assigns specialist agents, combines their findings into one review package and drafts clarification questions. Never approves, awards or pays.",
    tools: [...base, "ai.analyze"],
    mayMessage: ["GrantAgent", "ProjectResearchAgent", "TechnicalEvaluationAgent", "GrantRiskAgent", "TreasuryAgent", "MilestoneAgent"],
  },
  ProjectResearchAgent: {
    id: "ProjectResearchAgent", module: "Grant Intelligence", usesAi: false, canMoveFunds: false,
    responsibilities: "Reads applicant-supplied public evidence: GitHub through its API, QoreChain contracts and receipts, project websites through an SSRF-guarded fetcher. Records unavailable sources as unavailable.",
    tools: ["db.read", "db.write.drafts", "chain.read", "web.read.public"],
    mayMessage: ["TechnicalEvaluationAgent", "GrantRiskAgent"],
  },
  TechnicalEvaluationAgent: {
    id: "TechnicalEvaluationAgent", module: "Grant Intelligence", usesAi: true, canMoveFunds: false,
    responsibilities: "Assesses whether a technical project appears to exist and how far it is, from collected evidence only. Never runs applicant code.",
    tools: ["db.read", "db.write.drafts", "ai.analyze"],
    mayMessage: ["GrantRiskAgent"],
  },
  GrantRiskAgent: {
    id: "GrantRiskAgent", module: "Grant Intelligence", usesAi: false, canMoveFunds: false,
    responsibilities: "Flags similar or repeated submissions, reused links and payout addresses, recipient changes and contradicted claims, with evidence. A flag is not proof of fraud.",
    tools: ["db.read", "db.write.drafts"],
    mayMessage: ["SecurityAgent"],
  },
  GrantAgent: {
    id: "GrantAgent", module: "Grants", usesAi: true, canMoveFunds: false,
    responsibilities: "Evaluates grant applications, finds duplicates, recommends recipients and budgets.",
    tools: [...base, "ai.analyze", "docs.read.ciphertext", "docs.decrypt.authorised", "payments.propose"],
    mayMessage: ["DocumentAgent", "MilestoneAgent", "TreasuryAgent", "SecurityAgent"],
  },
  MilestoneAgent: {
    id: "MilestoneAgent", module: "Milestone Verification", usesAi: true, canMoveFunds: false,
    responsibilities: "Reviews milestone evidence and prepares release requests for an authorised reviewer.",
    tools: [...base, "ai.analyze", "docs.read.ciphertext", "docs.decrypt.authorised", "chain.read", "payments.propose"],
    mayMessage: ["PaymentAgent", "DisputeAgent", "SecurityAgent", "TreasuryAgent"],
  },
  DocumentAgent: {
    id: "DocumentAgent", module: "Encrypted Document Vault", usesAi: false, canMoveFunds: false,
    responsibilities: "Tracks ciphertexts, recipients, hashes and versions. Never holds plaintext or keys.",
    tools: [...base, "docs.read.ciphertext", "chain.read"],
    mayMessage: ["ProcurementAgent", "GrantAgent", "MilestoneAgent", "DisputeAgent", "InvoiceFraudAgent"],
  },
  PolicyAgent: {
    id: "PolicyAgent", module: "AI Policy Builder", usesAi: true, canMoveFunds: false,
    responsibilities: "Turns natural language into a structured policy draft and explains consequences. Cannot activate policies.",
    tools: [...base, "ai.analyze", "policy.evaluate"],
    mayMessage: ["SecurityAgent", "TreasuryAgent"],
  },
  SecurityAgent: {
    id: "SecurityAgent", module: "Threat Response", usesAi: true, canMoveFunds: false,
    responsibilities: "Monitors for anomalies and permission drift; opens investigations; requests pauses/revocations.",
    tools: [...base, "chain.read", "ai.analyze", "policy.evaluate", "security.pause.request"],
    mayMessage: ["PaymentAgent", "PolicyAgent", "TreasuryAgent", "InvoiceFraudAgent"],
  },
  PayrollAgent: {
    id: "PayrollAgent", module: "Payroll", usesAi: false, canMoveFunds: false,
    responsibilities: "Prepares payroll batches from contributor records for review; deterministic arithmetic.",
    tools: [...base, "policy.evaluate", "payments.propose"],
    mayMessage: ["PaymentAgent", "TreasuryAgent", "SecurityAgent"],
  },
  RevenueAgent: {
    id: "RevenueAgent", module: "Revenue Collection", usesAi: false, canMoveFunds: false,
    responsibilities: "Issues invoices, watches on-chain receipts, reconciles receivables.",
    tools: [...base, "chain.read"],
    mayMessage: ["TreasuryAgent", "SecurityAgent"],
  },
  GovernanceAgent: {
    id: "GovernanceAgent", module: "DAO Governance", usesAi: true, canMoveFunds: false,
    responsibilities: "Summarises proposals, analyses treasury impact and policy compatibility. Does not vote or execute.",
    tools: [...base, "ai.analyze", "chain.read", "policy.evaluate"],
    mayMessage: ["TreasuryAgent", "PolicyAgent", "SecurityAgent"],
  },
  StrategyAgent: {
    id: "StrategyAgent", module: "DCA & Rebalancing", usesAi: false, canMoveFunds: false,
    responsibilities: "Deterministic DCA / rebalancing calculations, labelled simulation unless a verified venue exists.",
    tools: [...base, "chain.read", "market.read", "policy.evaluate", "payments.propose"],
    mayMessage: ["TreasuryAgent", "SecurityAgent", "PolicyAgent"],
  },
  ArbitrageAgent: {
    id: "ArbitrageAgent", module: "Arbitrage Lab", usesAi: false, canMoveFunds: false,
    responsibilities: "Collects quotes and computes net profit after fees/slippage. Simulation only in the MVP.",
    tools: [...base, "market.read"],
    mayMessage: ["SecurityAgent", "TreasuryAgent"],
  },
  DisputeAgent: {
    id: "DisputeAgent", module: "Dispute Resolution", usesAi: true, canMoveFunds: false,
    responsibilities: "Summarises evidence and proposes resolutions. Authorised reviewers/resolvers decide fund outcomes.",
    tools: [...base, "ai.analyze", "docs.read.ciphertext", "docs.decrypt.authorised", "chain.read"],
    mayMessage: ["MilestoneAgent", "SecurityAgent", "DocumentAgent"],
  },
};

export class ToolDeniedError extends Error {
  constructor(public readonly agent: AgentId, public readonly tool: string) {
    super(`${agent} is not allowed to use tool "${tool}"`);
    this.name = "ToolDeniedError";
  }
}

export function assertToolAllowed(agent: AgentId, tool: string): asserts tool is Tool {
  const spec = AGENTS[agent];
  if (!(spec.tools as readonly string[]).includes(tool)) throw new ToolDeniedError(agent, tool);
}
