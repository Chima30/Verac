/**
 * Verifiable decision receipts. Built only from stored records and a fresh chain read; nothing is typed in or inferred.
 * Three kinds of statement are kept apart: what the agents RECOMMENDED, what people DECIDED, and what the chain CONFIRMED.
 * No keys, no decrypted documents, no e-mail addresses: people appear as short member ids.
 */
import type { InvoiceDecision } from "@qoreops/agent-coordinator";
import { serviceClient } from "@/lib/live/service";
import { reader } from "@/lib/server";
import { readWorkflow } from "./engine";

const shortId = (u: string | null | undefined) => (u ? `member ${u.slice(0, 8)}` : null);

export interface ReceiptPayment {
  invoiceId: string; invoiceNumber: string; transactionId: string; source: string; state: string;
  recipient: string; amountWei: string; paymentHash: string; policyVersion: number | null; expiresAt: string | null;
  requestedBy: string | null;
  approvals: Array<{ by: string; decision: string; at: string; method: string | null; onchainTx: string | null }>;
  execution: { txHash: string | null; block: number | null; confirmedAt: string | null; failure: string | null;
    chainCheck: "receipt-success" | "receipt-reverted" | "not-found" | "not-checked" | "unavailable" };
}
export interface DecisionReceipt {
  version: 1; generatedAt: string; network: "qorechain-diana (EVM chain 9800)";
  organization: { id: string; name: string | null };
  task: { id: string; state: string; createdAt: string; requestedBy: string; instruction: string | null; parsedBy: string | null };
  examined: { invoices: Array<{ id: string; number: string }>; milestones: string[]; recordsLoadedAt: string | null; vaultBlock: string | null };
  recommendations: Array<{ agent: string; summary: string; findings: number; digest: string | null; finishedAt: string }>;
  decisions: InvoiceDecision[];
  payments: ReceiptPayment[];
  messages: { count: number; kinds: Record<string, number> };
  notes: string[];
}

export async function buildReceipt(taskId: string, orgId: string): Promise<DecisionReceipt | null> {
  const w = await readWorkflow(taskId);
  if (!w || w.organization_id !== orgId) return null;
  const sb = serviceClient();
  const r = w.result ?? {};
  const prepared = (r.prepared ?? []).filter((p) => p.transactionId);
  const txIds = prepared.map((p) => p.transactionId!);
  const [org, txs, apps, msgs] = await Promise.all([
    sb.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    txIds.length ? sb.from("transactions").select("id,state,source,recipient,amount::text,payment_hash,policy_version,expires_at,requested_by,tx_hash,block_number,confirmed_at,failure_reason").in("id", txIds) : Promise.resolve({ data: [] }),
    txIds.length ? sb.from("approvals").select("subject_id,approver,decision,created_at,evidence,onchain_tx_hash").in("subject_id", txIds).order("created_at") : Promise.resolve({ data: [] }),
    sb.from("agent_messages").select("kind").eq("task_id", taskId),
  ]);
  const evm = reader().evm;
  const payments: ReceiptPayment[] = [];
  for (const p of prepared) {
    const t = ((txs.data ?? []) as Array<Record<string, unknown>>).find((x) => x.id === p.transactionId);
    if (!t) continue;
    const txHash = (t.tx_hash as string | null) ?? null;
    let chainCheck: ReceiptPayment["execution"]["chainCheck"] = "not-checked";
    // A payment is shown as confirmed only if the chain says so now, not because the database does.
    if (txHash && t.source === "LIVE_TESTNET") {
      try { const rc = await evm.getTransactionReceipt({ hash: txHash as `0x${string}` }); chainCheck = rc.status === "success" ? "receipt-success" : "receipt-reverted"; }
      catch (e) { chainCheck = /not be found|could not be found/i.test(e instanceof Error ? e.message : "") ? "not-found" : "unavailable"; }
    }
    const d = (r.decisions ?? []).find((x) => x.invoiceId === p.invoiceId);
    payments.push({
      invoiceId: p.invoiceId, invoiceNumber: d?.invoiceNumber ?? "", transactionId: String(t.id), source: String(t.source), state: String(t.state),
      recipient: String(t.recipient), amountWei: String(t.amount).split(".")[0]!, paymentHash: String(t.payment_hash), policyVersion: (t.policy_version as number | null) ?? null,
      expiresAt: (t.expires_at as string | null) ?? null, requestedBy: shortId(t.requested_by as string | null),
      approvals: ((apps.data ?? []) as Array<Record<string, unknown>>).filter((a) => a.subject_id === t.id).map((a) => ({
        by: shortId(a.approver as string)!, decision: String(a.decision), at: String(a.created_at),
        method: ((a.evidence as { auth_method?: string } | null)?.auth_method) ?? null, onchainTx: (a.onchain_tx_hash as string | null) ?? null,
      })),
      execution: { txHash, block: t.block_number ? Number(t.block_number) : null, confirmedAt: (t.confirmed_at as string | null) ?? null, failure: (t.failure_reason as string | null) ?? null, chainCheck },
    });
  }
  const kinds: Record<string, number> = {};
  for (const m of (msgs.data ?? []) as Array<{ kind: string }>) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
  const scope = new Set(r.scope ?? []);
  return {
    version: 1, generatedAt: new Date().toISOString(), network: "qorechain-diana (EVM chain 9800)",
    organization: { id: orgId, name: (org.data?.name as string | undefined) ?? null },
    task: { id: w.id, state: w.state, createdAt: w.created_at, requestedBy: shortId(w.requested_by)!, instruction: w.instruction, parsedBy: r.intent ? (r.intent.parsedBy === "gemini" ? `Gemini (${r.intent.model}), checked by fixed rules` : "fixed rules") : null },
    examined: {
      invoices: (r.snapshot?.invoices ?? []).filter((i) => scope.has(i.id)).map((i) => ({ id: i.id, number: i.invoiceNumber })),
      milestones: [...new Set((r.snapshot?.invoices ?? []).filter((i) => scope.has(i.id) && i.milestoneId).map((i) => i.milestoneId!))],
      recordsLoadedAt: r.snapshot?.loadedAt ?? null, vaultBlock: r.snapshot?.treasury.readAtBlock ?? null,
    },
    recommendations: Object.values(r.reports ?? {}).filter(Boolean).map((x) => ({ agent: x!.agent, summary: x!.recommendation, findings: x!.findings.length, digest: x!.digest ?? null, finishedAt: x!.finishedAt })),
    decisions: r.decisions ?? [],
    payments,
    messages: { count: (msgs.data ?? []).length, kinds },
    notes: [
      "Agent recommendations are advice. Eligibility is decided by fixed rules in code; approvals are made by people; execution is confirmed only by a chain receipt.",
      "Approver identities are shown as short member ids. Approvals relayed on chain are sent by the server's approver key after a person approves in Verac; see SECURITY.md for what that does and does not prove.",
      "Simulated payment requests (source SIMULATION) never reach the chain.",
    ],
  };
}

/** A plain-text rendering for people who do not read JSON. */
export function receiptText(x: DecisionReceipt): string {
  const qor = (w: string) => `${Number(BigInt(w) / 10n ** 12n) / 1e6} QOR`;
  const L: string[] = [];
  L.push(`VERAC DECISION RECEIPT`, `Generated ${x.generatedAt} on ${x.network}`, ``);
  L.push(`Organisation: ${x.organization.name ?? x.organization.id}`, `Task: ${x.task.id} (${x.task.state}), started ${x.task.createdAt} by ${x.task.requestedBy}`, `Instruction: "${x.task.instruction ?? ""}"`, `Understood by: ${x.task.parsedBy ?? "n/a"}`, ``);
  L.push(`EXAMINED`, `Invoices: ${x.examined.invoices.map((i) => i.number).join(", ") || "none"}`, `Milestones: ${x.examined.milestones.length}`, `Records loaded: ${x.examined.recordsLoadedAt ?? "n/a"}; vault read at block ${x.examined.vaultBlock ?? "n/a"}`, ``);
  L.push(`AGENT RECOMMENDATIONS (advice only)`);
  for (const r of x.recommendations) L.push(`- ${r.agent}: ${r.summary} [${r.findings} findings, digest ${r.digest?.slice(0, 16) ?? "n/a"}…]`);
  L.push(``, `POLICY DECISIONS (fixed rules)`);
  for (const d of x.decisions) L.push(`- ${d.invoiceNumber}: ${d.decision}, ${qor(d.amountWei)} to ${d.recipient}. ${d.reasons[0] ?? ""}`);
  L.push(``, `PAYMENTS`);
  if (!x.payments.length) L.push(`None prepared.`);
  for (const p of x.payments) {
    L.push(`- ${p.invoiceNumber}: ${qor(p.amountWei)} to ${p.recipient} (${p.source}), state ${p.state}`, `  payment hash ${p.paymentHash}, policy v${p.policyVersion ?? "?"}, requested by ${p.requestedBy}`);
    for (const a of p.approvals) L.push(`  ${a.decision} by ${a.by} at ${a.at}${a.method ? ` (${a.method})` : ""}${a.onchainTx ? `, relayed in ${a.onchainTx}` : ""}`);
    L.push(`  execution: ${p.execution.txHash ? `${p.execution.txHash} block ${p.execution.block ?? "?"}, chain check ${p.execution.chainCheck}` : "not executed"}${p.execution.failure ? `, failure: ${p.execution.failure}` : ""}`);
  }
  L.push(``, `MESSAGES: ${x.messages.count} signed agent messages (${Object.entries(x.messages.kinds).map(([k, n]) => `${k} ${n}`).join(", ")})`, ``, ...x.notes.map((n) => `Note: ${n}`));
  return L.join("\n");
}
