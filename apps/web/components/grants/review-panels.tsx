import { Badge, fmtUtc, Card, Notice, Source, btnCls, btnSecondaryCls, inputCls, labelCls, type Tone } from "@/components/ui";
import { toneMap } from "@/lib/states";
import { answerClarification, decideFlag, declareConflict, discardClarification, overrideScore, sendClarification } from "@/app/(app)/grants/actions";

export interface EvidenceRow { id: number; source: string; subject: string; claim: string; status: string; reason: string; url: string; retrieved_at: string; task_id: string | null; observed: Record<string, unknown> }
export interface ScoreRow { key: string; label: string; max: number; score: number | null; state: string; explanation: string; evidence_refs: string[]; missing: string[]; by: string }
export interface ReviewRow { id: string; task_id: string | null; created_at: string; rubric_version: number; application_version: number; scores: ScoreRow[]; scored_points: number; scored_max: number; applicable_max: number; recommendation: string; model: string | null; report: { recommendation?: { why?: string }; budget?: { rules?: Array<{ text: string }>; figures?: Record<string, unknown> }; milestones?: { rules?: Array<{ text: string }> }; technical?: { facts?: Array<{ text: string; refs?: string[] }>; ai?: { strengths?: string[]; concerns?: string[] } | null }; eligibility?: { eligible?: boolean; rules?: Array<{ text: string }> }; ai?: { used?: boolean; reason?: string; model?: string } } }
export interface FlagRow { id: string; code: string; severity: string; message: string; status: string; decided_reason: string | null; evidence: Record<string, unknown> }
export interface ClarRow { id: string; questions: Array<{ question: string; about?: string }>; status: string; drafted_by: string; sent_at: string | null; response: string | null; responded_at: string | null; created_at: string }
export interface OverrideRow { criterion: string; new_score: number; reason: string; by_user: string; created_at: string }

const EV_TONE = toneMap("grant_evidence");
const STATE_TEXT: Record<string, string> = { scored: "", missing: "Missing information", inapplicable: "Does not apply", source_failure: "Source unavailable", not_assessed: "Not assessed" };
const REC_TEXT: Record<string, string> = { strong_candidate: "Strong candidate", needs_clarification: "Needs clarification", further_review: "Requires further review" };

export function ReviewerPanels({ appId, evidence, review, overrides, flags, clars, conflicted, admin, readOnly = false }: {
  appId: string; evidence: EvidenceRow[]; review: ReviewRow | null; overrides: OverrideRow[]; flags: FlagRow[]; clars: ClarRow[]; conflicted: boolean; admin: boolean;
  /** The read-only auditor (judge) account: every record shown, every control hidden. The database refuses their writes anyway. */
  readOnly?: boolean;
}) {
  const refOf = new Map(evidence.map((e, i) => [`E${i + 1}`, e]));
  return (
    <>
      {conflicted && <Notice tone="warn" title="You declared a conflict of interest">You can read this application, but you cannot decide it, override scores, settle flags or send clarifications.</Notice>}

      <Card title="Evidence" description={evidence.length ? `Collected by the Project Research Agent. Each item: source, time, what was observed, and a classification with its reason.` : "No investigation has collected evidence for this application yet."}>
        {evidence.length > 0 && (
          <ol className="space-y-3 text-[13px]">
            {evidence.map((e, i) => (
              <li key={e.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[11.5px] text-muted">E{i + 1}</span><Badge tone={EV_TONE[e.status] ?? "neutral"}>{e.status.replace("_", " ")}</Badge><span className="font-medium">{e.claim}</span></div>
                <p className="mt-1 text-muted">{e.reason}</p>
                <p className="mt-1 break-all text-[11.5px] text-muted">{e.source} · <a className="underline" href={e.url} target="_blank" rel="noreferrer">{e.url}</a> · retrieved {fmtUtc(e.retrieved_at)}</p>
              </li>
            ))}
          </ol>
        )}
        <Source>Verac reads public sources only (GitHub API, QoreChain RPC, guarded page fetches). It never clones or runs applicant code. Unavailable is not a negative finding.</Source>
      </Card>

      {review && (
        <Card title="Evaluation report" description={`Rubric v${review.rubric_version} · application v${review.application_version} · ${new Date(review.created_at).toLocaleString()} · ${review.report.ai?.used ? `AI: ${review.model}` : `AI not used${review.report.ai?.reason ? ` (${review.report.ai.reason.slice(0, 120)})` : ""}`}`}>
          <div className="flex flex-wrap items-center gap-2"><Badge tone={review.recommendation === "strong_candidate" ? "live" : review.recommendation === "needs_clarification" ? "approval" : "pending"}>{(REC_TEXT[review.recommendation] ?? review.recommendation).toUpperCase()}</Badge><span className="text-[13px] text-muted">{review.report.recommendation?.why}</span></div>
          <p className="mt-2 text-[13px]"><span className="font-semibold tabular-nums">{review.scored_points}</span> of <span className="tabular-nums">{review.scored_max}</span> scored points ({review.applicable_max} applicable). Advisory: it does not award or reject.</p>
          <table className="mt-3 w-full text-left text-[12.5px]">
            <thead className="text-[11.5px] text-muted"><tr className="border-b border-line"><th className="py-1.5 pr-2 font-medium">Criterion</th><th className="py-1.5 pr-2 font-medium">Score</th><th className="py-1.5 font-medium">Why, and on what evidence</th></tr></thead>
            <tbody className="divide-y divide-line">
              {review.scores.map((s) => {
                const ov = overrides.filter((o) => o.criterion === s.key);
                return (
                  <tr key={s.key} className="align-top">
                    <td className="py-2 pr-2"><span className="font-medium">{s.label}</span><span className="block text-[11px] text-muted">by {s.by === "rules" ? "fixed rules" : "AI, checked"}</span></td>
                    <td className="py-2 pr-2 tabular-nums">{s.state === "scored" ? `${s.score}/${s.max}` : <span className="text-muted">{STATE_TEXT[s.state] ?? s.state}</span>}{ov.map((o, i) => <span key={i} className="block text-[11px] text-[var(--warn)]">override {o.new_score}/{s.max}</span>)}</td>
                    <td className="py-2">{s.explanation}
                      {s.evidence_refs.length > 0 && <span className="mt-0.5 block text-[11px] text-muted">Sources: {s.evidence_refs.map((r) => (refOf.get(r) ? `${r} (${refOf.get(r)!.claim})` : r.replace("section:", "application section: "))).join("; ")}</span>}
                      {s.missing.length > 0 && <span className="mt-0.5 block text-[11px] text-muted">Missing: {s.missing.join("; ")}</span>}
                      {ov.map((o, i) => <span key={i} className="mt-0.5 block text-[11px]">Reviewer override: {o.reason} ({new Date(o.created_at).toLocaleDateString()})</span>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(review.report.budget?.rules?.length || review.report.milestones?.rules?.length) ? (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 text-[12.5px]">
              <div><p className="font-medium">Budget review (rules)</p><ul className="mt-1 list-disc pl-4 text-muted">{(review.report.budget?.rules ?? []).map((r, i) => <li key={i}>{r.text}</li>)}</ul></div>
              <div><p className="font-medium">Milestone review (rules)</p><ul className="mt-1 list-disc pl-4 text-muted">{(review.report.milestones?.rules ?? []).map((r, i) => <li key={i}>{r.text}</li>)}</ul></div>
            </div>
          ) : null}
          {review.report.technical?.ai && (review.report.technical.ai.strengths?.length || review.report.technical.ai.concerns?.length) ? (
            <div className="mt-4 grid grid-cols-1 gap-3 text-[12.5px] md:grid-cols-2">
              <div><p className="font-medium">AI: strengths</p><ul className="mt-1 list-disc pl-4 text-muted">{(review.report.technical.ai.strengths ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
              <div><p className="font-medium">AI: concerns</p><ul className="mt-1 list-disc pl-4 text-muted">{(review.report.technical.ai.concerns ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            </div>
          ) : null}
          {admin && !conflicted && (
            <details className="mt-4 border-t border-line pt-3">
              <summary className="cursor-pointer text-[13px] font-medium">Override a score (recorded with your reason; the report itself is not changed)</summary>
              <form action={overrideScore} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_6rem]">
                <input type="hidden" name="app" value={appId} /><input type="hidden" name="review" value={review.id} />
                <select name="criterion" aria-label="Criterion" className={inputCls}>{review.scores.filter((s) => s.state !== "inapplicable").map((s) => <option key={s.key} value={s.key}>{s.label} (max {s.max})</option>)}</select>
                <input name="score" aria-label="New score" inputMode="decimal" required className={inputCls} placeholder="score" />
                <input name="reason" aria-label="Reason" required minLength={10} maxLength={600} className={`${inputCls} sm:col-span-2`} placeholder="Why the evidence supports a different score" />
                <button className={`${btnSecondaryCls} sm:col-span-2`}>Record override</button>
              </form>
            </details>
          )}
        </Card>
      )}

      {flags.length > 0 && (
        <Card title="Risk flags" description="A flag asks a human to look. It is not proof of anything; dismiss it with a reason when it is explained.">
          <ul className="space-y-3 text-[13px]">
            {flags.map((f) => (
              <li key={f.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={f.severity === "high" ? "failed" : f.severity === "medium" ? "pending" : "neutral"}>{f.severity.toUpperCase()}</Badge><span className="font-medium">{f.code.replace(/_/g, " ")}</span><Badge tone={f.status === "open" ? "info" : "neutral"}>{f.status.toUpperCase()}</Badge></div>
                <p className="mt-1 text-muted">{f.message}</p>
                {f.decided_reason && <p className="mt-1 text-[12px]">Reviewer: {f.decided_reason}</p>}
                {f.status === "open" && !conflicted && !readOnly && (
                  <form action={decideFlag} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="app" value={appId} /><input type="hidden" name="flag" value={f.id} />
                    <input name="reason" aria-label="Reason" required minLength={5} maxLength={500} className={`${inputCls} min-w-[12rem] flex-1 text-[12.5px]`} placeholder="Reason (required)" />
                    <button name="decision" value="dismissed" className={btnSecondaryCls}>Dismiss</button>
                    <button name="decision" value="confirmed" className={btnSecondaryCls}>Confirm</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Clarification requests" description="The coordinator drafts questions; a reviewer edits and sends them. The applicant answers in their portal and may amend once.">
        {clars.length === 0 ? <p className="text-[13px] text-muted">No clarification requests.</p> : (
          <ul className="space-y-3 text-[13px]">
            {clars.map((c) => (
              <li key={c.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={c.status === "draft" ? "neutral" : c.status === "sent" ? "approval" : c.status === "answered" ? "live" : "pending"}>{c.status.toUpperCase()}</Badge><span className="text-[12px] text-muted">drafted by {c.drafted_by === "GrantCoordinator" ? "the Grant Coordinator (AI and rules)" : "a reviewer"} · {new Date(c.created_at).toLocaleString()}</span></div>
                {c.status === "draft" && admin && !conflicted ? (
                  <form action={sendClarification} className="mt-2 space-y-2">
                    <input type="hidden" name="app" value={appId} /><input type="hidden" name="clar" value={c.id} />
                    <label htmlFor={`q-${c.id}`} className={labelCls}>Edit before sending: one question per line</label>
                    <textarea id={`q-${c.id}`} name="questions" rows={Math.min(10, c.questions.length + 1)} className={`${inputCls} text-[12.5px]`} defaultValue={c.questions.map((q) => q.question).join("\n")} />
                    <div className="flex gap-2"><button className={btnCls}>Send to the applicant</button><button formAction={discardClarification} className={btnSecondaryCls}>Discard draft</button></div>
                  </form>
                ) : (
                  <ol className="mt-2 list-decimal space-y-1 pl-5">{c.questions.map((q, i) => <li key={i}>{q.question}</li>)}</ol>
                )}
                {c.response && <p className="mt-2 whitespace-pre-wrap rounded bg-surface-2/60 p-2"><span className="font-medium">Applicant&apos;s answer ({new Date(c.responded_at!).toLocaleString()}):</span> {c.response}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!conflicted && !readOnly && (
        <details className="rounded-lg border border-line bg-surface p-4 text-[13px] shadow-card">
          <summary className="cursor-pointer font-medium">Declare a conflict of interest</summary>
          <form action={declareConflict} className="mt-2 flex flex-wrap gap-2">
            <input type="hidden" name="app" value={appId} />
            <input name="note" aria-label="Describe the conflict" required minLength={5} maxLength={500} className={`${inputCls} min-w-[14rem] flex-1`} placeholder="For example: I advised this team last year" />
            <button className={btnSecondaryCls}>Declare</button>
          </form>
          <p className="mt-1 text-[12px] text-muted">After declaring, you cannot decide this application or influence its review.</p>
        </details>
      )}
    </>
  );
}

export function ApplicantClarifications({ appId, clars, amendmentOpen, grantId }: { appId: string; clars: ClarRow[]; amendmentOpen: boolean; grantId: string }) {
  if (!clars.length) return null;
  return (
    <Card title="Questions from reviewers" description="Answer here. If the answer changes your application, amend it and resubmit: reviewers see every version.">
      <ul className="space-y-4 text-[13.5px]">
        {clars.map((c) => (
          <li key={c.id}>
            <ol className="list-decimal space-y-1 pl-5">{c.questions.map((q, i) => <li key={i}>{q.question}</li>)}</ol>
            {c.status === "sent" ? (
              <form action={answerClarification} className="mt-2 space-y-2">
                <input type="hidden" name="app" value={appId} /><input type="hidden" name="clar" value={c.id} />
                <label htmlFor={`ans-${c.id}`} className={labelCls}>Your answer</label>
                <textarea id={`ans-${c.id}`} name="response" required minLength={5} maxLength={6000} rows={4} className={inputCls} />
                <button className={btnCls}>Send answer</button>
              </form>
            ) : c.response ? <p className="mt-2 whitespace-pre-wrap rounded bg-surface-2/60 p-2 text-[13px]"><span className="font-medium">Your answer:</span> {c.response}</p> : null}
          </li>
        ))}
      </ul>
      {amendmentOpen && <a href={`/grants/${grantId}/apply`} className={`${btnSecondaryCls} mt-4`}>Amend the application</a>}
    </Card>
  );
}
