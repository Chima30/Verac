import type { RunTx } from "./live-run";

export type ProofKind = "deployment" | "payment" | "escrow-funding" | "escrow-release" | "rejected" | "authorisation";
export const KIND_LABEL: Record<ProofKind, string> = {
  deployment: "Deployments", payment: "Payments and funding", "escrow-funding": "Escrow funding", "escrow-release": "Escrow releases",
  rejected: "Rejected operations", authorisation: "Authorisation changes",
};

/** Puts each recorded transaction in one bucket. Pure and unit tested: the label wording is the only input. */
export function classify(t: Pick<RunTx, "group" | "label" | "expect">): ProofKind {
  const l = t.label.toLowerCase();
  if (t.expect === "reverted") return "rejected";
  if (t.group === "Deployment" || l.startsWith("deploy ")) return "deployment";
  if (l.startsWith("release")) return "escrow-release";
  if (l.includes("escrow") && (l.includes("fund") || l.includes("create project"))) return "escrow-funding";
  if (/^payment:|\b(pays|fund vault|deposit|fund agent|fund the)\b/.test(l)) return "payment";
  return "authorisation";
}

/** The written record each run came from, in the repository's docs folder. */
export function evidenceDoc(group: string): string {
  if (group.includes("2026-11-15") && group.toLowerCase().includes("payment")) return "docs/LIVE_PAYMENT_2026-11-15.md";
  if (group.includes("2026-11-15")) return "docs/LIVE_SETUP_2026-11-15.md";
  return "docs/LIVE_RUN_2026-11-14.md";
}

/** The contract a step acted on, when the label names it. */
export function contractOf(label: string): string | null {
  const l = label.toLowerCase();
  if (l.includes("policymanager") || l.includes("policy version")) return "PolicyManager";
  if (l.includes("milestoneescrow") || l.includes("escrow") || l.includes("milestone") || l.startsWith("release")) return "MilestoneEscrow";
  if (l.includes("auditanchor")) return "AuditAnchor";
  if (l.includes("organizationregistry")) return "OrganizationRegistry";
  if (l.includes("vault") || l.includes("agent limits") || l.includes("agent pays") || l.includes("recipient") || l.includes("approver") || l.includes("payment") || l.includes("cap")) return "TreasuryVault";
  return null;
}

export type Verification = "verified" | "refused-as-expected" | "mismatch" | "pending" | "unverifiable";
export function verification(expect: "success" | "reverted", actual: "success" | "reverted" | "not found" | "unavailable"): Verification {
  if (actual === "unavailable") return "unverifiable";
  if (actual === "not found") return "mismatch";
  if (actual !== expect) return "mismatch";
  return expect === "reverted" ? "refused-as-expected" : "verified";
}
