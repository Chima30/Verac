import { Badge, Card, Metric, Notice, Source, btnCls, btnSecondaryCls, inputCls, labelCls, type Tone } from "@/components/ui";
import { labelMap, stateOf, toneMap } from "@/lib/states";
import { checkMilestone, decideMilestone, fundMilestone, submitMilestoneEvidence } from "@/app/(app)/grants/milestone-actions";
import { formatQor } from "@/lib/approvals";

export interface MsRow { id: string; idx: number; title: string; amount: string; status: string; release_tx_hash: string | null; review: { decision?: string; note?: string; at?: string } | null }
export interface SubRow { milestone_id: string; attempt: number; description: string; links: string[]; transactions: string[]; created_at: string }
export interface MsEvidence { milestone_id: string; claim: string; status: string; reason: string; url: string; retrieved_at: string }
export interface FundRow { milestone_id: string | null; status: string; route: string; reasons: string[]; tx_hash: string | null; block_number: number | null; created_at: string; transaction_id: string | null }
export interface PlanMs { title: string; deliverable: string; verification: string; due: string }

const MS_TONE = toneMap("milestone");
const EV_TONE = toneMap("grant_evidence");
const FUND_TEXT = labelMap("grant_funding");
const EXPLORER = "https://explore.qore.network";
const w = (v: unknown) => BigInt(String(v ?? "0").split(".")[0]!);

export function MilestonesPanel({ appId, milestones, plan, subs, evidence, funding, role, applicant, conflicted }: {
  appId: string; milestones: MsRow[]; plan: PlanMs[]; subs: SubRow[]; evidence: MsEvidence[]; funding: FundRow[]; role: string; applicant: boolean; conflicted: boolean;
}) {
  const admin = ["owner", "administrator"].includes(role);
  const reviewer = admin || role === "security_reviewer";
  const finance = admin || role === "finance_manager";
  const award = milestones.reduce((t, m) => t + w(m.amount), 0n);
  const released = funding.filter((f) => f.status === "confirmed").reduce((t, f) => t + w(milestones.find((m) => m.id === f.milestone_id)?.amount), 0n);
  const requested = funding.filter((f) => f.status === "requested").reduce((t, f) => t + w(milestones.find((m) => m.id === f.milestone_id)?.amount), 0n);
  const next = milestones.find((m) => m.status !== "released");
  const nextDue = next ? plan[next.idx - 1]?.due : null;
  const overdue = nextDue && new Date(nextDue) < new Date() && next?.status === "pending";

  return (
    <Card id="milestones" title="Funded grant: milestones and payments" description="Recipients submit evidence, agents check it, administrators decide, and the treasury pays only through its approval path. Released means confirmed on chain.">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        <Metric label="Awarded" value={<>{formatQor(award.toString())} <span className="text-[12px] font-medium text-muted">QOR</span></>} sub={`${milestones.length} milestone${milestones.length === 1 ? "" : "s"}`} />
        <Metric label="Released" value={<>{formatQor(released.toString())} <span className="text-[12px] font-medium text-muted">QOR</span></>} sub="confirmed on chain" tone={released > 0n ? "live" : undefined} />
        <Metric label="Requested" value={<>{formatQor(requested.toString())} <span className="text-[12px] font-medium text-muted">QOR</span></>} sub="awaiting signatures or the chain" />
        <Metric label="Remaining" value={<>{formatQor((award - released).toString())} <span className="text-[12px] font-medium text-muted">QOR</span></>} sub={nextDue ? `next due ${nextDue}${overdue ? " (overdue)" : ""}` : "all milestones closed"} tone={overdue ? "warn" : undefined} />
      </dl>

      <ol className="mt-5 space-y-4">
        {milestones.map((m) => {
          const p = plan[m.idx - 1];
          const mySubs = subs.filter((s) => s.milestone_id === m.id).sort((a, b) => b.attempt - a.attempt);
          const myEv = evidence.filter((e) => e.milestone_id === m.id);
          const myFund = funding.filter((f) => f.milestone_id === m.id);
          const prevOk = m.idx === 1 || ["approved", "released"].includes(milestones.find((x) => x.idx === m.idx - 1)?.status ?? "");
          const openPayment = myFund.some((f) => ["requested", "confirmed"].includes(f.status));
          return (
            <li key={m.id} className="rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-semibold">{m.idx}. {m.title} <span className="font-normal text-muted">· {formatQor(String(m.amount))} QOR{p?.due ? ` · due ${p.due}` : ""}</span></p>
                <Badge tone={MS_TONE[m.status] ?? "neutral"}>{stateOf("milestone", m.status).label}</Badge>
              </div>
              {p && <p className="mt-1 text-[13px] text-muted">{p.deliverable} <span className="block text-[12px]">Verified by: {p.verification}</span></p>}

              {mySubs.length > 0 && (
                <div className="mt-3 space-y-2">
                  {mySubs.map((s) => (
                    <div key={s.attempt} className="rounded-md bg-surface-2/60 p-3 text-[13px]">
                      <p className="text-[12px] text-muted">Evidence, attempt {s.attempt} · {new Date(s.created_at).toLocaleString()}</p>
                      <p className="mt-1 whitespace-pre-wrap">{s.description}</p>
                      {[...s.links, ...s.transactions].length > 0 && <ul className="mt-1 space-y-0.5 text-[12px]">{s.links.map((l) => <li key={l} className="break-all">{l}</li>)}{s.transactions.map((t) => <li key={t}><a className="break-all font-mono underline" href={`${EXPLORER}/tx/${t}`} target="_blank" rel="noreferrer">{t}</a></li>)}</ul>}
                    </div>
                  ))}
                </div>
              )}
              {m.review?.note && <p className="mt-2 text-[12.5px]"><span className="font-medium">Reviewer ({m.review.decision}):</span> {m.review.note}</p>}

              {reviewer && myEv.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-[12.5px]">
                  {myEv.map((e, i) => <li key={i}><Badge tone={EV_TONE[e.status] ?? "neutral"}>{stateOf("grant_evidence", e.status).label}</Badge> {e.claim.replace(/^Milestone evidence \(attempt \d+\): /, "")}. <span className="text-muted">{e.reason}</span> <a className="text-muted underline" href={e.url} target="_blank" rel="noreferrer">source</a></li>)}
                </ul>
              )}

              {applicant && m.status === "pending" && prevOk && (
                <form action={submitMilestoneEvidence} className="mt-3 space-y-2 border-t border-line pt-3">
                  <input type="hidden" name="app" value={appId} /><input type="hidden" name="ms" value={m.id} />
                  <label htmlFor={`d-${m.id}`} className={labelCls}>What was delivered</label>
                  <textarea id={`d-${m.id}`} name="description" required minLength={20} maxLength={6000} rows={3} className={inputCls} />
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div><label htmlFor={`l-${m.id}`} className={labelCls}>Links, one per line (releases, pull requests, docs, demos)</label><textarea id={`l-${m.id}`} name="links" rows={3} className={`${inputCls} text-[12.5px]`} placeholder="https://github.com/owner/repo/releases/tag/v1.0" /></div>
                    <div><label htmlFor={`t-${m.id}`} className={labelCls}>Transaction hashes, one per line (optional)</label><textarea id={`t-${m.id}`} name="txs" rows={3} className={`${inputCls} font-mono text-[12px]`} placeholder="0x…" /></div>
                  </div>
                  <button className={btnCls}>Submit evidence</button>
                </form>
              )}
              {applicant && m.status === "pending" && !prevOk && <p className="mt-2 text-[12.5px] text-muted">Evidence opens after milestone {m.idx - 1} is approved.</p>}

              {reviewer && m.status === "evidence_submitted" && (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  <form action={checkMilestone}><input type="hidden" name="app" value={appId} /><input type="hidden" name="ms" value={m.id} /><button className={btnSecondaryCls}>Check the evidence (Milestone Agent)</button></form>
                  {admin && !conflicted && (
                    <form action={decideMilestone} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="app" value={appId} /><input type="hidden" name="ms" value={m.id} />
                      <input name="reason" aria-label="Reason" required minLength={5} maxLength={500} className={`${inputCls} min-w-[14rem] flex-1`} placeholder="Reason (recorded)" />
                      <button name="decision" value="approve" className={btnCls}>Approve milestone</button>
                      <button name="decision" value="reject" className={btnSecondaryCls}>Send back</button>
                    </form>
                  )}
                </div>
              )}

              {myFund.length > 0 && (
                <ul className="mt-3 space-y-2 text-[12.5px]">
                  {myFund.map((f, i) => (
                    <li key={i} className="rounded-md border border-line p-2.5">
                      <Badge tone={f.status === "confirmed" ? "live" : f.status === "requested" ? "approval" : f.status === "awaiting_authorised_path" ? "pending" : "failed"}>{FUND_TEXT[f.status] ?? f.status}</Badge> <span className="text-muted">{new Date(f.created_at).toLocaleString()}{f.route !== "none" ? ` · ${f.route === "treasury_v2" ? "TreasuryVault V2" : "TreasuryVault"}` : ""}</span>
                      {f.reasons.length > 0 && <ul className="mt-1 list-disc pl-5 text-muted">{f.reasons.map((r, j) => <li key={j}>{r}</li>)}</ul>}
                      {f.tx_hash && <p className="mt-1"><a className="break-all font-mono underline" href={`${EXPLORER}/tx/${f.tx_hash}`} target="_blank" rel="noreferrer">{f.tx_hash}</a>{f.block_number ? ` · block ${f.block_number}` : ""}</p>}
                      {f.status === "requested" && <p className="mt-1 text-muted">Waiting for administrators&apos; signatures and execution in <a className="underline" href="/approvals">Approvals</a>.</p>}
                    </li>
                  ))}
                </ul>
              )}
              {finance && m.status === "approved" && !openPayment && (
                <form action={fundMilestone} className="mt-3 border-t border-line pt-3">
                  <input type="hidden" name="app" value={appId} /><input type="hidden" name="ms" value={m.id} />
                  <button className={btnCls}>Request payment through the treasury</button>
                  <p className="mt-1 text-[12px] text-muted">Verac checks the vault&apos;s real limits first. If the payment does not fit a restricted path, it records why instead of paying; it never splits a milestone.</p>
                </form>
              )}
              {m.status === "released" && m.release_tx_hash && <Notice tone="live" className="mt-3">Released on chain: <a className="break-all font-mono underline" href={`${EXPLORER}/tx/${m.release_tx_hash}`} target="_blank" rel="noreferrer">{m.release_tx_hash}</a></Notice>}
            </li>
          );
        })}
      </ol>
      <Source>Agents check evidence and record findings. Approving a milestone and paying it are separate human steps; the chain confirms payment.</Source>
    </Card>
  );
}
