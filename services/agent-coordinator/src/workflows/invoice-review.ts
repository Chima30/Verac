import { createHash } from "node:crypto";
import { checkInvoice, type HistoryItem } from "@qoreops/policy-engine";
import type { AgentId } from "@qoreops/shared-types";
import { assertToolAllowed } from "../agents";
import { COORDINATOR, canonical, type Envelope, type MessageBus } from "../messaging";

/**
 * Contractor invoice review: six agents work over one snapshot of an organisation's own records.
 *
 * Every decision here is deterministic code. A language model may phrase the final report and may turn a typed instruction
 * into one of the allow-listed intents, but it never sees keys, never decides eligibility and never prepares a payment.
 * Agents exchange signed envelopes through the MessageBus; the coordinator verifies each one against the organisation and
 * the task before using it.
 */

export const WEI = 10n ** 18n;
export const toQor = (wei: bigint | string) => Number(BigInt(wei) / 10n ** 12n) / 1e6;

// ------------------------------------------------------------------ records (what the loader reads; never invented)
export interface InvoiceRec {
  id: string; invoiceNumber: string; vendorId: string | null; amountWei: string; token: string; recipient: string;
  invoiceDate: string | null; dueDate: string | null; status: string; notes: string | null; milestoneId: string | null;
  transactionId: string | null; createdAt: string;
}
export interface VendorRec { id: string; name: string; verified: boolean; payoutAddress: string | null }
export interface AddressChange { vendorId: string; payoutAddress: string; createdAt: string }
export interface MilestoneRec { id: string; parentId: string; parentTitle: string | null; idx: number; title: string; amountWei: string; status: string; approvedAt: string | null; reviewDecision: string | null }
export interface PaymentRec { id: string; state: string; recipient: string; amountWei: string; invoiceId: string | null; source: string; createdAt: string }
export interface TreasuryRead {
  ok: boolean; error?: string; readAtBlock?: string;
  balanceWei?: string; agentActive?: boolean; perTxCapWei?: string; remainingDailyWei?: string;
  /** Recipient (lower-case) → is it on the vault's approved list, read from the chain. */
  recipientApproved: Record<string, boolean>;
}
export interface PolicyRead { version: number | null; requiredApprovals: number; liveReady: boolean; emergencyStop: boolean }

export interface Snapshot {
  organizationId: string; today: string; loadedAt: string;
  invoices: InvoiceRec[]; vendors: VendorRec[]; addressChanges: AddressChange[]; milestones: MilestoneRec[]; payments: PaymentRec[];
  treasury: TreasuryRead; policy: PolicyRead;
}

// ------------------------------------------------------------------ intent (the only things a typed instruction can ask for)
export interface Intent { action: "review_invoices"; preparePayments: boolean; limit: number | null; invoiceNumbers: string[] }

/** Deterministic parse used when no model is available, and to check what a model returned. */
export function parseInstruction(text: string): Intent | null {
  const t = text.toLowerCase();
  if (!/\binvoices?\b|\bbills?\b|\bcontractors?\b/.test(t)) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const m = t.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b(?=[^.]{0,40}\binvoices?\b)/);
  const limit = m ? (words[m[1]!] ?? Number(m[1])) : null;
  const numbers = [...text.matchAll(/\b([A-Z]{2,5}-?\d{1,6})\b/g)].map((x) => x[1]!).filter((x) => !/^QOR/i.test(x));
  return { action: "review_invoices", preparePayments: /\b(prepare|pay|payment|payments|settle)\b/.test(t), limit: limit && limit > 0 && limit <= 50 ? limit : null, invoiceNumbers: [...new Set(numbers)].slice(0, 20) };
}

// ------------------------------------------------------------------ agent output
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export interface Finding { invoiceId: string | null; code: string; severity: Severity; message: string; evidence: string[] }
export interface AgentReport {
  agent: AgentId; taskId: string; startedAt: string; finishedAt: string;
  evidence: string[]; actions: string[]; findings: Finding[]; risks: string[];
  recommendation: string; uncertainty: string | null; errors: string[]; next: string;
  /** sha256 of the canonical report, carried in the signed message so the stored report cannot be swapped. */
  digest?: string;
}
export type Decision = "ELIGIBLE" | "HOLD" | "REJECT";
export interface InvoiceDecision {
  invoiceId: string; invoiceNumber: string; vendor: string | null; amountWei: string; recipient: string; milestoneId: string | null;
  decision: Decision; reasons: string[]; requiredApprovals: number; policyVersion: number | null;
}

const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;
const SEV_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const OPEN_STATES = new Set(["received", "held", "approved"]);
const LIVE_PENDING = new Set(["PROPOSED", "VALIDATING", "AWAITING_APPROVAL", "APPROVED", "SIMULATING", "READY", "SUBMITTED", "CONFIRMED"]);

/** Invoices in scope: outstanding (not paid, not rejected, not already linked to a payment) and, if named or counted, those. */
export function selectInvoices(s: Snapshot, intent: Intent): InvoiceRec[] {
  let open = s.invoices.filter((i) => OPEN_STATES.has(i.status));
  if (intent.invoiceNumbers.length) {
    const want = new Set(intent.invoiceNumbers.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, "")));
    const named = open.filter((i) => want.has(i.invoiceNumber.toLowerCase().replace(/[^a-z0-9]/g, "")));
    if (named.length) open = named;
  }
  open.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return intent.limit ? open.slice(0, intent.limit) : open;
}

function report(agent: AgentId, taskId: string, started: string, now: () => string, r: Omit<AgentReport, "agent" | "taskId" | "startedAt" | "finishedAt" | "digest">): AgentReport {
  const out: AgentReport = { agent, taskId, startedAt: started, finishedAt: now(), ...r };
  out.digest = createHash("sha256").update(canonical({ ...out, digest: undefined })).digest("hex");
  return out;
}
const worst = (f: Finding[]) => f.reduce<Severity>((w, x) => (SEV_RANK[x.severity] > SEV_RANK[w] ? x.severity : w), "info");

// ------------------------------------------------------------------ the six agents
export function invoiceAgent(s: Snapshot, scope: InvoiceRec[], taskId: string, now: () => string): AgentReport {
  assertToolAllowed("InvoiceFraudAgent", "db.read");
  const started = now();
  const vendors = new Map(s.vendors.map((v) => [v.id, v]));
  const findings: Finding[] = [];
  for (const inv of scope) {
    const v = inv.vendorId ? vendors.get(inv.vendorId) : undefined;
    const ev = [`invoice:${inv.id}`, ...(v ? [`vendor:${v.id}`] : [])];
    // History is this organisation's other invoices from the same vendor, as recorded.
    const history: HistoryItem[] = s.invoices.filter((o) => o.id !== inv.id && o.vendorId === inv.vendorId && o.vendorId)
      .map((o) => ({ vendor: v?.name ?? "unknown", invoiceNumber: o.invoiceNumber, amountQor: toQor(o.amountWei), payoutAddress: o.recipient, invoiceDate: o.invoiceDate ?? o.createdAt.slice(0, 10) }));
    const check = checkInvoice({ vendor: v?.name ?? "unknown vendor", invoiceNumber: inv.invoiceNumber, amountQor: toQor(inv.amountWei), payoutAddress: inv.recipient, invoiceDate: inv.invoiceDate ?? inv.createdAt.slice(0, 10), ...(inv.dueDate ? { dueDate: inv.dueDate } : {}), ...(inv.notes ? { notes: inv.notes } : {}) },
      history, { today: s.today, ...(s.treasury.perTxCapWei ? { perTxCapQor: toQor(s.treasury.perTxCapWei) } : {}) });
    for (const f of check.findings) {
      // The vendor record, not past invoices, is the authority for a new vendor's payout address.
      if (f.code === "NEW_VENDOR" && v?.verified && lc(v.payoutAddress) === lc(inv.recipient)) continue;
      if (f.code === "PAYOUT_CHANGED" && v?.payoutAddress && lc(v.payoutAddress) === lc(inv.recipient)) continue;
      findings.push({ invoiceId: inv.id, code: f.code, severity: f.severity, message: f.message, evidence: ev });
    }
    if (!v) findings.push({ invoiceId: inv.id, code: "NO_VENDOR_RECORD", severity: "high", message: "The invoice is not linked to a vendor record, so the payout address cannot be checked.", evidence: ev });
    else {
      if (!v.verified) findings.push({ invoiceId: inv.id, code: "VENDOR_NOT_VERIFIED", severity: "medium", message: `Vendor ${v.name} is not marked as verified.`, evidence: ev });
      if (!v.payoutAddress) findings.push({ invoiceId: inv.id, code: "NO_PAYOUT_ON_FILE", severity: "high", message: `Vendor ${v.name} has no payout address on file to compare with.`, evidence: ev });
      else if (lc(v.payoutAddress) !== lc(inv.recipient))
        findings.push({ invoiceId: inv.id, code: "RECIPIENT_MISMATCH", severity: "high", message: `The invoice asks for payment to ${short(inv.recipient)}, but ${v.name}'s approved payout address is ${short(v.payoutAddress)}.`, evidence: ev });
    }
    if (inv.dueDate && inv.dueDate < s.today) findings.push({ invoiceId: inv.id, code: "OVERDUE", severity: "info", message: `Due on ${inv.dueDate}, which has passed.`, evidence: ev });
  }
  const flagged = new Set(findings.filter((f) => SEV_RANK[f.severity] >= 3).map((f) => f.invoiceId));
  return report("InvoiceFraudAgent", taskId, started, now, {
    evidence: scope.map((i) => `invoice:${i.id}`), actions: [`Read ${scope.length} outstanding invoice${scope.length === 1 ? "" : "s"}`, "Compared each with the vendor record and the vendor's earlier invoices", "Ran the fixed invoice-fraud rules"],
    findings, risks: [...flagged].map((id) => `invoice:${id}`), recommendation: flagged.size ? `Hold ${flagged.size} invoice${flagged.size === 1 ? "" : "s"} for review before any payment.` : "No invoice shows a fraud signal.",
    uncertainty: null, errors: [], next: "Milestone check",
  });
}

export function milestoneAgent(s: Snapshot, scope: InvoiceRec[], taskId: string, now: () => string): AgentReport {
  assertToolAllowed("MilestoneAgent", "db.read");
  const started = now();
  const ms = new Map(s.milestones.map((m) => [m.id, m]));
  const findings: Finding[] = [];
  for (const inv of scope) {
    const m = inv.milestoneId ? ms.get(inv.milestoneId) : undefined;
    const ev = [`invoice:${inv.id}`, ...(m ? [`milestone:${m.id}`] : [])];
    if (!m) { findings.push({ invoiceId: inv.id, code: "NO_MILESTONE", severity: "medium", message: "The invoice is not linked to a milestone, so there is no approved work to pay against.", evidence: ev }); continue; }
    const label = `${m.parentTitle ?? "project"} milestone ${m.idx} (${m.title})`;
    if (m.status === "approved") {
      findings.push({ invoiceId: inv.id, code: "MILESTONE_APPROVED", severity: "info", message: `${label} was accepted by a reviewer${m.approvedAt ? ` on ${m.approvedAt.slice(0, 10)}` : ""}.`, evidence: ev });
      if (m.approvedAt && inv.createdAt < m.approvedAt) findings.push({ invoiceId: inv.id, code: "INVOICED_BEFORE_APPROVAL", severity: "low", message: "The invoice was recorded before the milestone was accepted.", evidence: ev });
    } else if (m.status === "released") {
      findings.push({ invoiceId: inv.id, code: "MILESTONE_ALREADY_PAID", severity: "critical", message: `${label} has already been released. Paying this invoice would pay the work twice.`, evidence: ev });
    } else if (m.status === "disputed") {
      findings.push({ invoiceId: inv.id, code: "MILESTONE_DISPUTED", severity: "high", message: `${label} is in dispute.`, evidence: ev });
    } else {
      findings.push({ invoiceId: inv.id, code: "MILESTONE_NOT_APPROVED", severity: "high", message: `${label} is ${m.status === "evidence_submitted" ? "waiting for a reviewer to accept the evidence" : "still waiting for the contractor's evidence"}. It has not been approved.`, evidence: ev });
    }
    if (BigInt(inv.amountWei) > BigInt(m.amountWei))
      findings.push({ invoiceId: inv.id, code: "AMOUNT_ABOVE_MILESTONE", severity: "high", message: `The invoice asks for ${toQor(inv.amountWei)} QOR, more than the ${toQor(m.amountWei)} QOR agreed for this milestone.`, evidence: ev });
  }
  const blocked = findings.filter((f) => SEV_RANK[f.severity] >= 3).length;
  return report("MilestoneAgent", taskId, started, now, {
    evidence: [...new Set(findings.flatMap((f) => f.evidence.filter((e) => e.startsWith("milestone:"))))], actions: ["Looked up the milestone each invoice bills for", "Checked its recorded status and reviewer decision", "Compared the invoice amount with the agreed milestone amount"],
    findings, risks: [], recommendation: blocked ? "Do not pay invoices whose milestone is not approved or is already paid." : "Every linked milestone is approved.", uncertainty: null, errors: [], next: "Security review",
  });
}

export function securityAgent(s: Snapshot, scope: InvoiceRec[], prior: Finding[], taskId: string, now: () => string): AgentReport {
  assertToolAllowed("SecurityAgent", "policy.evaluate");
  const started = now();
  const findings: Finding[] = [];
  const recentChange = new Map<string, AddressChange>();
  for (const c of s.addressChanges) if (Date.parse(s.today) - Date.parse(c.createdAt) < 30 * 86_400_000) recentChange.set(c.vendorId, c);
  for (const inv of scope) {
    const ev = [`invoice:${inv.id}`];
    // Replay / duplicate payment: an existing payment request for this invoice, or one to the same recipient for the same amount.
    const linked = s.payments.filter((p) => p.invoiceId === inv.id && LIVE_PENDING.has(p.state));
    if (inv.transactionId || linked.length) findings.push({ invoiceId: inv.id, code: "PAYMENT_ALREADY_EXISTS", severity: "critical", message: "A payment request already exists for this invoice. A second one would be a duplicate.", evidence: [...ev, ...linked.map((p) => `transaction:${p.id}`)] });
    const twin = s.payments.find((p) => p.invoiceId !== inv.id && lc(p.recipient) === lc(inv.recipient) && p.amountWei === inv.amountWei && LIVE_PENDING.has(p.state) && Date.parse(s.today) - Date.parse(p.createdAt) < 30 * 86_400_000);
    if (twin) findings.push({ invoiceId: inv.id, code: "SAME_PAYMENT_RECENTLY", severity: "high", message: `A payment of the same amount to the same address was requested on ${twin.createdAt.slice(0, 10)}.`, evidence: [...ev, `transaction:${twin.id}`] });
    if (inv.vendorId && recentChange.has(inv.vendorId)) findings.push({ invoiceId: inv.id, code: "PAYOUT_RECENTLY_CHANGED", severity: "medium", message: `The vendor's payout address was changed on ${recentChange.get(inv.vendorId)!.createdAt.slice(0, 10)}. Confirm the change through a channel already on file.`, evidence: [...ev, `vendor:${inv.vendorId}`] });
    const injected = prior.find((f) => f.invoiceId === inv.id && f.code === "INSTRUCTION_IN_INVOICE");
    if (injected) findings.push({ invoiceId: inv.id, code: "PROMPT_INJECTION", severity: "high", message: "The invoice text tries to instruct an automated reviewer. It is treated as suspicious content, never as an instruction.", evidence: ev });
  }
  // The same recipient appearing on several invoices in one batch can be an attempt to split a payment under a limit.
  const byRecipient = new Map<string, InvoiceRec[]>();
  for (const inv of scope) byRecipient.set(lc(inv.recipient), [...(byRecipient.get(lc(inv.recipient)) ?? []), inv]);
  for (const [r, list] of byRecipient) if (list.length > 1) findings.push({ invoiceId: null, code: "SPLIT_PATTERN", severity: "medium", message: `${list.length} invoices in this batch pay the same address ${short(r)}.`, evidence: list.map((i) => `invoice:${i.id}`) });
  if (s.policy.emergencyStop) findings.push({ invoiceId: null, code: "EMERGENCY_STOP", severity: "high", message: "The emergency stop is on. No payment can be executed until it is lifted.", evidence: ["config:LIVE_EMERGENCY_STOP"] });
  const holds = new Set(findings.filter((f) => SEV_RANK[f.severity] >= 3 && f.invoiceId).map((f) => f.invoiceId));
  return report("SecurityAgent", taskId, started, now, {
    evidence: ["payments:existing", "vendors:address-history"], actions: ["Checked for existing payment requests (duplicate and replay)", "Checked recent payout-address changes", "Looked for instructions hidden in invoice text", "Looked for split-payment patterns"],
    findings, risks: [...holds].map((i) => `invoice:${i}`), recommendation: holds.size ? `Recommend a hold on ${holds.size} invoice${holds.size === 1 ? "" : "s"}.` : "No security hold needed.", uncertainty: null, errors: [], next: "Treasury check",
  });
}

export function treasuryAgent(s: Snapshot, scope: InvoiceRec[], taskId: string, now: () => string): AgentReport {
  assertToolAllowed("TreasuryAgent", "chain.read");
  const started = now();
  const t = s.treasury;
  const findings: Finding[] = [];
  const errors: string[] = [];
  if (!t.ok) {
    errors.push(`Could not read the vault from the chain: ${t.error ?? "unknown error"}.`);
  } else {
    if (!t.agentActive) findings.push({ invoiceId: null, code: "AGENT_RULE_INACTIVE", severity: "high", message: "The payment agent's spending rule on the vault is not active.", evidence: ["chain:TreasuryVault.agentState"] });
    for (const inv of scope) {
      const ev = [`invoice:${inv.id}`, "chain:TreasuryVault"];
      const amt = BigInt(inv.amountWei);
      if (t.recipientApproved[lc(inv.recipient)] === false) findings.push({ invoiceId: inv.id, code: "RECIPIENT_NOT_ON_VAULT", severity: "high", message: `The vault does not list ${short(inv.recipient)} as an approved recipient, so the contract would refuse the payment.`, evidence: ev });
      if (t.perTxCapWei && amt > BigInt(t.perTxCapWei)) findings.push({ invoiceId: inv.id, code: "ABOVE_PER_PAYMENT_CAP", severity: "high", message: `${toQor(amt)} QOR is above the agent's on-chain cap of ${toQor(t.perTxCapWei)} QOR per payment.`, evidence: ev });
      if (inv.token !== "0x0000000000000000000000000000000000000000") findings.push({ invoiceId: inv.id, code: "TOKEN_NOT_SUPPORTED", severity: "high", message: "Only native QOR payments are wired to execution.", evidence: ev });
    }
  }
  return report("TreasuryAgent", taskId, started, now, {
    evidence: t.ok ? [`chain:block:${t.readAtBlock}`] : [], actions: ["Read the vault balance, the agent's caps and today's remaining allowance from Diana testnet", "Checked each recipient against the vault's approved list"],
    findings, risks: [], recommendation: t.ok ? `Vault holds ${toQor(t.balanceWei ?? "0")} QOR; the agent may spend ${toQor(t.remainingDailyWei ?? "0")} QOR more today.` : "Treasury state is unknown; nothing can be prepared.",
    uncertainty: t.ok ? null : "Chain read failed; treasury limits could not be confirmed.", errors, next: "Policy decision",
  });
}

/** Deterministic final decision per invoice. A model's text never feeds into this function. */
export function policyAgent(s: Snapshot, scope: InvoiceRec[], all: Finding[], taskId: string, now: () => string): { report: AgentReport; decisions: InvoiceDecision[] } {
  assertToolAllowed("PolicyAgent", "policy.evaluate");
  const started = now();
  const vendors = new Map(s.vendors.map((v) => [v.id, v]));
  const REJECT = new Set(["DUPLICATE_INVOICE", "MILESTONE_ALREADY_PAID", "PAYMENT_ALREADY_EXISTS", "INVALID_ADDRESS", "INVALID_AMOUNT"]);
  let room = s.treasury.ok ? BigInt(s.treasury.remainingDailyWei ?? "0") : 0n;
  let funds = s.treasury.ok ? BigInt(s.treasury.balanceWei ?? "0") : 0n;
  const decisions: InvoiceDecision[] = [];
  for (const inv of scope) {
    const mine = all.filter((f) => f.invoiceId === inv.id || (f.invoiceId === null && SEV_RANK[f.severity] >= 3));
    const reasons: string[] = [];
    let decision: Decision = "ELIGIBLE";
    const rej = mine.filter((f) => REJECT.has(f.code));
    if (rej.length) { decision = "REJECT"; reasons.push(...rej.map((f) => f.message)); }
    else {
      const holds = mine.filter((f) => SEV_RANK[f.severity] >= 3 || (f.severity === "medium" && ["NO_MILESTONE", "VENDOR_NOT_VERIFIED", "PAYOUT_RECENTLY_CHANGED"].includes(f.code)));
      if (holds.length) { decision = "HOLD"; reasons.push(...holds.map((f) => f.message)); }
    }
    if (decision === "ELIGIBLE") {
      const amt = BigInt(inv.amountWei);
      if (!s.treasury.ok) { decision = "HOLD"; reasons.push("The vault could not be read, so the limits are unknown."); }
      else if (amt > funds) { decision = "HOLD"; reasons.push(`The vault holds ${toQor(funds)} QOR, less than the ${toQor(amt)} QOR requested.`); }
      else if (amt > room) { decision = "HOLD"; reasons.push(`Only ${toQor(room)} QOR of today's agent allowance remains after the invoices above; this one waits for tomorrow's allowance.`); }
      else { room -= amt; funds -= amt; reasons.push("Invoice matches the vendor record, the milestone is approved, and the amount fits the vault's per-payment cap, today's allowance and the balance."); }
    }
    if (s.policy.version === null && decision === "ELIGIBLE") { decision = "HOLD"; reasons.push("No policy version is active on the PolicyManager."); }
    decisions.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, vendor: inv.vendorId ? vendors.get(inv.vendorId)?.name ?? null : null, amountWei: inv.amountWei, recipient: inv.recipient, milestoneId: inv.milestoneId, decision, reasons, requiredApprovals: s.policy.requiredApprovals, policyVersion: s.policy.version });
  }
  const n = (d: Decision) => decisions.filter((x) => x.decision === d).length;
  return {
    decisions,
    report: report("PolicyAgent", taskId, started, now, {
      evidence: [`policy:version:${s.policy.version ?? "none"}`], actions: ["Applied the fixed payment policy to every finding", "Allocated today's allowance in invoice order", `Set ${s.policy.requiredApprovals} administrator approval${s.policy.requiredApprovals === 1 ? "" : "s"} for every payment`],
      findings: decisions.map((d) => ({ invoiceId: d.invoiceId, code: `DECISION_${d.decision}`, severity: d.decision === "ELIGIBLE" ? "info" : d.decision === "HOLD" ? "medium" : "high", message: d.reasons[0] ?? d.decision, evidence: [`invoice:${d.invoiceId}`] })),
      risks: [], recommendation: `${n("ELIGIBLE")} eligible, ${n("HOLD")} on hold, ${n("REJECT")} rejected.`, uncertainty: null, errors: [], next: n("ELIGIBLE") ? "Prepare payment requests" : "Report",
    }),
  };
}

// ------------------------------------------------------------------ messages
export const WORKFLOW_AGENTS = ["InvoiceFraudAgent", "MilestoneAgent", "SecurityAgent", "TreasuryAgent", "PolicyAgent", "PaymentAgent"] as const;

/**
 * One agent turn over the bus: the coordinator hands work to the agent, the agent verifies the handoff, does its work and
 * reports back; the coordinator verifies the report against the organisation and task and checks the digest matches the
 * stored report. Returns every envelope so the caller can persist them.
 */
export function exchange(bus: MessageBus, org: string, taskId: string, agent: AgentId, subject: string, rep: AgentReport): Envelope[] {
  const handoff = bus.sign({ from: COORDINATOR, to: agent, organizationId: org, taskId, kind: "task.handoff", payload: { taskId, subject: subject.slice(0, 128) } });
  bus.verify(handoff, { recipient: agent, organizationId: org, taskId });
  const sev = worst(rep.findings);
  const back = bus.sign({ from: agent, to: COORDINATOR, organizationId: org, taskId, kind: "finding.report", payload: {
    taskId, subject: subject.slice(0, 128), severity: sev === "critical" ? "high" : sev, summary: rep.recommendation.slice(0, 1000),
    evidenceRefs: rep.evidence.slice(0, 20), digest: rep.digest,
  } });
  const got = bus.verify(back, { recipient: COORDINATOR, organizationId: org, taskId });
  const check = createHash("sha256").update(canonical({ ...rep, digest: undefined })).digest("hex");
  if ((got.payload as { digest?: string }).digest !== check) throw new Error(`${agent}'s report does not match its signed digest`);
  return [handoff, back];
}

/** InvoiceFraudAgent warns SecurityAgent directly about high-risk invoices (an allowed agent-to-agent channel). */
export function alertSecurity(bus: MessageBus, org: string, taskId: string, findings: Finding[]): Envelope[] {
  const out: Envelope[] = [];
  for (const f of findings.filter((x) => SEV_RANK[x.severity] >= 3 && x.invoiceId).slice(0, 10)) {
    const env = bus.sign({ from: "InvoiceFraudAgent", to: "SecurityAgent", organizationId: org, taskId, kind: "security.alert", payload: { taskId, subject: `invoice:${f.invoiceId}`, severity: f.severity === "critical" ? "critical" : "high", summary: f.message.slice(0, 1000) } });
    bus.verify(env, { recipient: "SecurityAgent", organizationId: org, taskId });
    out.push(env);
  }
  return out;
}

// ------------------------------------------------------------------ the report (facts only; a model may only reword it)
export function summarise(decisions: InvoiceDecision[], prepared: Array<{ invoiceId: string; mode: "LIVE_TESTNET" | "SIMULATION" | "NOT_PREPARED"; error?: string }>): string {
  if (decisions.length === 0) return "No outstanding invoices were found for this organisation. Nothing was prepared and no funds moved.";
  const n = (d: Decision) => decisions.filter((x) => x.decision === d);
  const parts = [`${decisions.length} invoice${decisions.length === 1 ? "" : "s"} reviewed.`];
  const el = n("ELIGIBLE"), ho = n("HOLD"), re = n("REJECT");
  if (el.length) parts.push(`${el.length} ${el.length === 1 ? "is" : "are"} eligible for approval (${el.map((d) => d.invoiceNumber).join(", ")}).`);
  for (const d of ho) parts.push(`${d.invoiceNumber} is on hold: ${d.reasons[0]}`);
  for (const d of re) parts.push(`${d.invoiceNumber} is rejected: ${d.reasons[0]}`);
  const live = prepared.filter((p) => p.mode === "LIVE_TESTNET").length, sim = prepared.filter((p) => p.mode === "SIMULATION").length;
  const failed = prepared.filter((p) => p.mode === "NOT_PREPARED");
  if (live) parts.push(`I prepared ${live} live testnet payment request${live === 1 ? "" : "s"} for administrator approval.`);
  if (sim) parts.push(`I prepared ${sim} simulated payment request${sim === 1 ? "" : "s"}, because live execution is not configured here.`);
  for (const f of failed) parts.push(`A payment for ${decisions.find((d) => d.invoiceId === f.invoiceId)?.invoiceNumber ?? "one invoice"} could not be prepared: ${f.error}`);
  parts.push("No funds have moved.");
  return parts.join(" ");
}
