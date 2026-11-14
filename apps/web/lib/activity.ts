/** Turns audit_events rows into readable lines. Unknown actions are shown as recorded, never guessed at. */

export interface AuditRow { id: number; actor: string; action: string; subject: string | null; detail: Record<string, unknown> | null; created_at: string }

export const MODULE_LABELS: Record<string, string> = {
  payment: "Approvals", payroll: "Payroll", procurement: "Procurement", milestone: "Milestones", dispute: "Disputes", governance: "Governance",
  grant: "Grants", revenue: "Revenue", vault: "Document Vault", vendor: "Vendors",
};

const SENTENCES: Record<string, string> = {
  "payment.approval_requested": "requested approval for a payment (simulation, no QOR moves)",
  "payment.approve": "approved a payment request",
  "payment.reject": "rejected a payment request",
  "payment.approval_expired": "payment request expired without enough approvals",
  "payroll.submitted": "submitted a payroll batch for approval",
  "procurement.opened": "opened a tender",
  "procurement.bid_submitted": "submitted a sealed bid",
  "procurement.bidding_closed": "closed bidding on a tender",
  "procurement.awarded": "awarded a tender",
  "procurement.seal_key_published": "published a reading key (procurement)",
  "milestone.evidence_submitted": "submitted sealed milestone evidence",
  "milestone.approve": "accepted a milestone",
  "milestone.reject": "rejected milestone evidence",
  "milestone.payment_requested": "requested payment for a milestone",
  "dispute.opened": "opened a dispute",
  "dispute.note_added": "added a statement to a dispute",
  "dispute.summary_saved": "saved an AI summary on a dispute",
  "dispute.resolved": "resolved a dispute",
  "governance.proposal_created": "created a proposal",
  "governance.analysis_saved": "saved an AI summary on a proposal",
  "governance.voting_opened": "opened voting",
  "governance.vote_cast": "cast a vote",
  "governance.finalized": "closed voting and counted the result",
  "grant.created": "opened a grant round",
  "grant.closed": "closed a grant round",
  "grant.applied": "applied to a grant round",
  "grant.ai_review_saved": "saved an AI review on a grant application",
  "grant.recommend": "recommended a grant application",
  "grant.reject": "rejected a grant application",
  "grant.awarded": "awarded a grant application",
  "revenue.recorded": "recorded money owed",
  "revenue.marked_paid": "marked a record paid",
  "revenue.voided": "voided a revenue record",
  "vault.seal_key_published": "published a reading key (vault)",
  "vault.uploaded": "uploaded a sealed document",
  "vault.fetched": "fetched a sealed document",
  "vault.deleted": "deleted a sealed document",
  "vendor.payout_address_set": "changed their payout address",
};

export const moduleOf = (action: string) => action.split(".")[0] ?? action;
export const moduleLabel = (action: string) => MODULE_LABELS[moduleOf(action)] ?? moduleOf(action);

/** "you" for the signed-in user, "system" for system events, otherwise a short id. Names are not looked up, so none are invented. */
export function actorLabel(actor: string, me: string): string {
  if (actor === me) return "You";
  if (actor === "system") return "System";
  return /^[0-9a-f-]{36}$/i.test(actor) ? `Member ${actor.slice(0, 8)}` : actor;
}

export function describe(e: Pick<AuditRow, "action" | "detail">): string {
  const base = SENTENCES[e.action];
  if (!base) return `recorded "${e.action}"`;
  const d = e.detail ?? {};
  if (e.action === "governance.vote_cast" && typeof d.choice === "string") return `${base}: ${d.choice}`;
  if (e.action === "governance.finalized" && typeof d.status === "string") return `${base}: ${d.status}`;
  if (e.action === "dispute.resolved" && typeof d.outcome === "string") return `${base}: ${d.outcome === "accept_work" ? "work accepted" : "sent back for new evidence"}`;
  if (e.action === "vault.uploaded" && typeof d.readers === "number") return `${base} for ${d.readers} reader${d.readers === 1 ? "" : "s"}`;
  return base;
}

export const PAGE_SIZE = 50;

/** Parses the filter query string into safe values; anything unexpected is dropped. */
export function parseFilters(sp: { module?: string; before?: string; mine?: string }) {
  const module = sp.module && /^[a-z_]{1,24}$/.test(sp.module) ? sp.module : undefined;
  const before = sp.before && /^\d{1,15}$/.test(sp.before) ? Number(sp.before) : undefined;
  return { module, before, mine: sp.mine === "1" };
}
