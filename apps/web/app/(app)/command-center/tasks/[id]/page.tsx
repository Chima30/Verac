import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Bot, Download, FileText, Landmark, ScrollText, ShieldAlert, Waypoints, Wallet, Receipt } from "lucide-react";
import type { AgentReport, Finding, InvoiceDecision } from "@qoreops/agent-coordinator";
import { CancelWorkflow, WorkflowRunner } from "@/components/agents/workflow-client";
import { Badge, Card, Notice, PageHeader, ShortHash, Source, StatusDot, btnSecondaryCls, fmtUtc, relTime, type Tone } from "@/components/ui";
import { formatQor } from "@/lib/approvals";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { STEP_LABEL, STEP_ORDER, type StepRecord, type WorkflowRow } from "@/lib/workflows/engine";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent workflow" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISION: Record<InvoiceDecision["decision"], { tone: Tone; text: string }> = { ELIGIBLE: { tone: "live", text: "ELIGIBLE" }, HOLD: { tone: "approval", text: "ON HOLD" }, REJECT: { tone: "failed", text: "REJECTED" } };
const SEV: Record<string, Tone> = { critical: "failed", high: "failed", medium: "approval", low: "pending", info: "info" };
const AGENT_ICON = { InvoiceFraudAgent: Receipt, MilestoneAgent: Waypoints, SecurityAgent: ShieldAlert, TreasuryAgent: Landmark, PolicyAgent: ScrollText, PaymentAgent: Wallet } as const;
const AGENT_TILE = { InvoiceFraudAgent: "orange", MilestoneAgent: "teal", SecurityAgent: "red", TreasuryAgent: "green", PolicyAgent: "amber", PaymentAgent: "blue" } as const;
const TX_STATE: Record<string, { tone: Tone; text: string }> = {
  AWAITING_APPROVAL: { tone: "approval", text: "Awaiting administrator approval" }, APPROVED: { tone: "info", text: "Approved, not yet executed" }, READY: { tone: "info", text: "Executing" },
  SUBMITTED: { tone: "sim", text: "Submitted to chain" }, CONFIRMED: { tone: "live", text: "Confirmed on Diana testnet" }, REJECTED: { tone: "failed", text: "Rejected" }, FAILED: { tone: "failed", text: "Failed" }, CANCELLED: { tone: "pending", text: "Expired" },
};

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const s = await getSession();
  if (!s.configured || !s.user) redirect(`/login?next=/command-center/tasks/${id}`);
  if (!s.org) redirect("/onboarding");
  const sb = (await supabaseServer())!;
  const { data } = await sb.from("agent_tasks").select("id,organization_id,requested_by,state,instruction,steps,result,error,attempts,created_at,updated_at,lease_until").eq("id", id).eq("organization_id", s.org.id).eq("kind", "invoice_review").maybeSingle();
  if (!data) notFound();
  const w = data as unknown as WorkflowRow;
  const r = w.result ?? {};
  const steps = (w.steps ?? []) as StepRecord[];
  const doneSteps = new Map<string, StepRecord>();
  for (const st of steps) if (st.status === "done") doneSteps.set(st.key, st);
  const failed = steps.filter((x) => x.status === "failed");
  const active = ["QUEUED", "RUNNING"].includes(w.state);
  const decisions = r.decisions ?? [];
  const invoices = new Map((r.snapshot?.invoices ?? []).map((i) => [i.id, i]));
  const vendors = new Map((r.snapshot?.vendors ?? []).map((v) => [v.id, v]));
  const milestones = new Map((r.snapshot?.milestones ?? []).map((m) => [m.id, m]));
  const reports = r.reports ?? {};
  const findingsFor = (invoiceId: string): Finding[] => Object.values(reports).flatMap((x) => (x?.findings ?? []).filter((f) => f.invoiceId === invoiceId && !f.code.startsWith("DECISION_") && !f.code.startsWith("PREPARED_")));

  const prepared = r.prepared ?? [];
  const txIds = prepared.map((p) => p.transactionId).filter(Boolean) as string[];
  const { data: txRows } = txIds.length ? await sb.from("transactions").select("id,state,source,tx_hash,block_number,payment_hash,required_approvals,vault_version").in("id", txIds) : { data: [] };
  const tx = new Map(((txRows ?? []) as Array<{ id: string; state: string; source: string; tx_hash: string | null; block_number: number | null; payment_hash: string; required_approvals: number; vault_version?: number | null }>).map((t) => [t.id, t]));
  const mine = w.requested_by === s.user.id;
  const t = r.snapshot?.treasury;

  // The real timeline, extended past the agents with what happened to each prepared payment.
  const payState = [...tx.values()];
  const timeline: Array<{ label: string; at: string | null; state: "done" | "now" | "todo" | "failed"; detail?: string }> = STEP_ORDER.map((k) => {
    const done = doneSteps.get(k);
    const f = failed.filter((x) => x.key === k).at(-1);
    return { label: STEP_LABEL[k], at: done?.finishedAt ?? null, state: done ? "done" : f && w.state === "FAILED" ? "failed" : active && STEP_ORDER.find((x) => !doneSteps.has(x)) === k ? "now" : "todo", detail: done?.summary ?? f?.summary };
  });
  if (prepared.some((p) => p.transactionId)) {
    const approved = payState.some((p) => ["APPROVED", "READY", "SUBMITTED", "CONFIRMED"].includes(p.state));
    const submitted = payState.some((p) => ["SUBMITTED", "CONFIRMED"].includes(p.state));
    const confirmed = payState.some((p) => p.state === "CONFIRMED");
    timeline.push({ label: "Awaiting administrator approval", at: null, state: approved ? "done" : "now" });
    timeline.push({ label: "Execution submitted", at: null, state: submitted ? "done" : "todo" });
    timeline.push({ label: "Execution confirmed", at: null, state: confirmed ? "done" : "todo", detail: confirmed ? "Receipt read back from Diana testnet." : undefined });
  }

  const stateBadge: Record<string, { tone: Tone; text: string }> = {
    QUEUED: { tone: "pending", text: "QUEUED" }, RUNNING: { tone: "info", text: "RUNNING" }, AWAITING_HUMAN: { tone: "approval", text: "AWAITING APPROVAL" },
    COMPLETED: { tone: "live", text: "COMPLETED" }, FAILED: { tone: "failed", text: "FAILED" }, CANCELLED: { tone: "pending", text: "CANCELLED" }, PAUSED_AI_UNAVAILABLE: { tone: "pending", text: "PAUSED" },
  };

  return (
    <>
      <PageHeader title="Invoice review" icon={Bot} tile="violet" eyebrow={<Link href="/command-center" className="hover:text-ink">← AI Command Center</Link>}
        badge={<Badge tone={stateBadge[w.state]?.tone ?? "neutral"}>{stateBadge[w.state]?.text ?? w.state}</Badge>}
        description={<>&ldquo;{w.instruction}&rdquo;</>}
        meta={<><span>Started {fmtUtc(w.created_at)}{mine ? " by you" : ""}</span><span>Updated {relTime(w.updated_at)}</span>{r.intent && <span>Understood by {r.intent.parsedBy === "gemini" ? `Gemini (${r.intent.model}), checked by fixed rules` : "fixed rules"}</span>}</>}
        actions={<>
          {(w.state === "COMPLETED" || w.state === "AWAITING_HUMAN") && <>
            <a href={`/api/agent/workflows/${w.id}/receipt`} className={btnSecondaryCls}><Download size={14} aria-hidden />Receipt (JSON)</a>
            <a href={`/api/agent/workflows/${w.id}/receipt?format=text`} className={btnSecondaryCls}><FileText size={14} aria-hidden />Receipt (text)</a>
          </>}
          {!["COMPLETED", "FAILED", "CANCELLED"].includes(w.state) && <CancelWorkflow id={w.id} />}
        </>} />

      <WorkflowRunner id={w.id} active={active} />
      {w.state === "FAILED" && <Notice tone="bad" className="mb-6" title="This workflow stopped">{w.error}</Notice>}

      {r.summary && (
        <section aria-label="Result" className="mb-6 rounded-lg border border-line bg-surface p-5 shadow-card sm:p-6">
          <p className="text-[12.5px] font-medium text-subtle">Result, written from the decisions below</p>
          <p className="mt-2 max-w-4xl text-[17px] leading-relaxed">{r.summary}</p>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          {decisions.length > 0 && (
            <Card title="Invoices examined" description="Decided by fixed rules from the agents' findings. Open an invoice for the evidence." flush>
              <ul className="-mx-5 divide-y divide-line">
                {decisions.map((d) => {
                  const inv = invoices.get(d.invoiceId);
                  const v = inv?.vendorId ? vendors.get(inv.vendorId) : undefined;
                  const m = d.milestoneId ? milestones.get(d.milestoneId) : undefined;
                  const p = prepared.find((x) => x.invoiceId === d.invoiceId);
                  const txr = p?.transactionId ? tx.get(p.transactionId) : undefined;
                  const fs = findingsFor(d.invoiceId).sort((a, b) => ["critical", "high", "medium", "low", "info"].indexOf(a.severity) - ["critical", "high", "medium", "low", "info"].indexOf(b.severity));
                  return (
                    <li key={d.invoiceId}>
                      <details className="group" open={decisions.length <= 3}>
                        <summary className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-surface-2/50">
                          <span className="min-w-0 flex-1"><span className="text-[14.5px] font-semibold">{d.invoiceNumber}</span> <span className="text-[13px] text-muted">{d.vendor ?? "no vendor"}</span>
                            <span className="block text-[13px] text-muted">{d.reasons[0]}</span></span>
                          <span className="text-[14px] font-semibold tabular-nums">{formatQor(d.amountWei)} <span className="text-[12px] font-medium text-muted">QOR</span></span>
                          <Badge tone={DECISION[d.decision].tone}>{DECISION[d.decision].text}</Badge>
                        </summary>
                        <div className="grid grid-cols-1 gap-5 px-5 pb-5 lg:grid-cols-[1fr_15rem]">
                          <div className="min-w-0">
                            <h3 className="text-[12.5px] font-medium text-muted">What the agents found</h3>
                            {fs.length === 0 ? <p className="mt-1 text-[13px] text-muted">No issues.</p> : (
                              <ul className="mt-2 space-y-2">{fs.map((f, k) => (
                                <li key={k} className="flex gap-2.5 text-[13.5px]"><StatusDot tone={SEV[f.severity] ?? "neutral"}><span className="sr-only">{f.severity}</span></StatusDot><span className="min-w-0">{f.message} <span className="font-mono text-[11px] text-subtle">{f.code}</span></span></li>
                              ))}</ul>
                            )}
                            {d.reasons.length > 1 && <><h3 className="mt-4 text-[12.5px] font-medium text-muted">Why this decision</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-[13px]">{d.reasons.map((x, k) => <li key={k}>{x}</li>)}</ul></>}
                          </div>
                          <dl className="space-y-2.5 rounded-lg bg-surface-2/60 p-3.5 text-[12.5px]">
                            <div><dt className="text-muted">Pay to</dt><dd><ShortHash value={d.recipient} /></dd></div>
                            {v && <div><dt className="text-muted">Vendor record</dt><dd>{v.payoutAddress ? <ShortHash value={v.payoutAddress} /> : "no payout on file"}{v.verified ? "" : " · not verified"}</dd></div>}
                            <div><dt className="text-muted">Milestone</dt><dd>{m ? <Link href="/milestones" className="hover:underline">{m.parentTitle ? `${m.parentTitle}, ` : ""}{m.idx}. {m.title}</Link> : "none"}{m && <span className="block text-muted">{m.status.replace("_", " ")} · {formatQor(m.amountWei)} QOR</span>}</dd></div>
                            <div><dt className="text-muted">Approvals required</dt><dd>{txr && Number(txr.vault_version) === 2 ? `${txr.required_approvals} administrators, each signing with their own ML-DSA-87 key on TreasuryVault V2` : `${d.requiredApprovals} administrator${d.requiredApprovals === 1 ? "" : "s"}`} · policy v{d.policyVersion ?? "none"}</dd></div>
                            {p && <div><dt className="text-muted">Payment</dt><dd>{p.mode === "NOT_PREPARED" ? <span className="text-[var(--bad)]">Not prepared: {p.error}</span> : txr ? <><Badge tone={TX_STATE[txr.state]?.tone ?? "neutral"}>{p.mode === "LIVE_TESTNET" ? "LIVE" : "SIMULATION"}</Badge><span className="mt-1 block">{TX_STATE[txr.state]?.text ?? txr.state}</span>{txr.tx_hash && <a className="block font-mono text-[11.5px] text-accent-text hover:underline" href={`https://explore.qore.network/tx/${txr.tx_hash}`} target="_blank" rel="noreferrer">{txr.tx_hash.slice(0, 12)}… block {txr.block_number}</a>}<Link href="/approvals" className="mt-1 block font-medium text-accent-text hover:underline">Open in Approvals</Link></> : <span className="text-muted">Visible to finance roles</span>}</dd></div>}
                          </dl>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {Object.keys(reports).length > 0 && (
            <section aria-labelledby="agents-h">
              <h2 id="agents-h" className="mb-3 text-[17px] font-bold tracking-[-0.02em]">Agent reports</h2>
              <div className="space-y-3">
                {(Object.entries(reports) as Array<[keyof typeof AGENT_ICON, AgentReport]>).map(([k, rep]) => {
                  const Icon = AGENT_ICON[k];
                  return (
                    <details key={k} className="group rounded-lg border border-line bg-surface shadow-card">
                      <summary className="flex items-center gap-3 px-4 py-3">
                        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg text-white" style={{ background: `var(--tile-${AGENT_TILE[k]})` }}><Icon size={15} /></span>
                        <span className="min-w-0 flex-1"><span className="text-[14px] font-semibold">{k}</span><span className="block truncate text-[12.5px] text-muted">{rep.recommendation}</span></span>
                        <span className="hidden text-[12px] text-subtle sm:inline">{rep.findings.length} finding{rep.findings.length === 1 ? "" : "s"} · {relTime(rep.finishedAt)}</span>
                      </summary>
                      <div className="grid grid-cols-1 gap-4 border-t border-line px-4 py-4 text-[13px] md:grid-cols-2">
                        <div><h3 className="text-[12px] font-medium text-muted">Actions performed</h3><ul className="mt-1 list-disc space-y-0.5 pl-5">{rep.actions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
                        <div><h3 className="text-[12px] font-medium text-muted">Evidence read</h3><p className="mt-1 break-words font-mono text-[11.5px] text-muted">{rep.evidence.join(", ") || "none"}</p></div>
                        {rep.findings.length > 0 && <div className="md:col-span-2"><h3 className="text-[12px] font-medium text-muted">Findings</h3><ul className="mt-1 space-y-1">{rep.findings.map((f, i) => <li key={i} className="flex gap-2"><StatusDot tone={SEV[f.severity] ?? "neutral"}><span className="sr-only">{f.severity}</span></StatusDot><span>{f.invoiceId && invoices.get(f.invoiceId) ? <span className="font-medium">{invoices.get(f.invoiceId)!.invoiceNumber}: </span> : null}{f.message}</span></li>)}</ul></div>}
                        {(rep.errors.length > 0 || rep.uncertainty) && <div className="md:col-span-2"><Notice tone="warn">{[...rep.errors, rep.uncertainty].filter(Boolean).join(" ")}</Notice></div>}
                        <p className="text-[12px] text-subtle md:col-span-2">Next: {rep.next} · report digest <span className="font-mono">{rep.digest?.slice(0, 16)}…</span>, carried in a signed message to the coordinator</p>
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Timeline" description="Real steps with the time each finished.">
            <ol className="relative space-y-4">
              {timeline.map((x, i) => (
                <li key={i} className="relative flex gap-3">
                  {i < timeline.length - 1 && <span aria-hidden className={`absolute left-[9px] top-5 -bottom-4 w-px ${x.state === "done" ? "bg-[var(--live)]/50" : "bg-line"}`} />}
                  <span aria-hidden className={`relative z-[1] mt-0.5 grid size-[19px] shrink-0 place-items-center rounded-full ${x.state === "done" ? "bg-[var(--live)] text-white" : x.state === "now" ? "border-2 border-accent bg-surface" : x.state === "failed" ? "bg-[var(--bad)] text-white" : "border border-line-strong bg-surface"}`}>{x.state === "done" ? "✓" : x.state === "failed" ? "!" : ""}</span>
                  <div className="min-w-0">
                    <p className={`text-[13.5px] ${x.state === "todo" ? "text-subtle" : "font-medium"}`}>{x.label}<span className="sr-only"> ({x.state})</span></p>
                    {x.at && <p className="text-[11.5px] text-subtle">{new Date(x.at).toISOString().slice(11, 19)} UTC</p>}
                    {x.detail && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{x.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {t && (
            <Card title="Treasury checks" description={t.ok ? `Read from Diana testnet at block ${Number(t.readAtBlock).toLocaleString("en-US")}.` : "The chain could not be read."}>
              {t.ok ? (
                <dl className="space-y-2 text-[13px]">
                  <div className="flex justify-between gap-3"><dt className="text-muted">Vault balance</dt><dd className="font-semibold tabular-nums">{formatQor(t.balanceWei ?? "0")} QOR</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Agent cap per payment</dt><dd className="tabular-nums">{formatQor(t.perTxCapWei ?? "0")} QOR</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Left today</dt><dd className="tabular-nums">{formatQor(t.remainingDailyWei ?? "0")} QOR</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Agent rule</dt><dd>{t.agentActive ? "active" : <span className="text-[var(--bad)]">inactive</span>}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Policy version</dt><dd>{r.snapshot?.policy.version ?? "none"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Live execution</dt><dd>{r.snapshot?.policy.emergencyStop ? "emergency stop" : r.snapshot?.policy.liveReady ? "ready" : "off (simulation)"}</dd></div>
                </dl>
              ) : <p className="text-[13px] text-[var(--bad)]">{t.error}</p>}
              <Source>The contract enforces these limits again when a payment executes; a payment the agents mark eligible can still be refused on chain.</Source>
            </Card>
          )}

          <Card title="What the agents could not do">
            <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-muted">
              <li>Approve or execute a payment. A different administrator approves on Approvals, with their password.</li>
              <li>Change a decision. Eligibility comes from fixed rules; Gemini only parsed the instruction.</li>
              <li>Read sealed documents. Only invoice fields and records were used.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
