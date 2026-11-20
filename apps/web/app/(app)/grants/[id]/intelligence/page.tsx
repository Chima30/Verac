import Link from "next/link";
import { redirect } from "next/navigation";
import { allocate, type Score } from "@qoreops/agent-coordinator";
import { InvestigationControls } from "@/components/grants/investigation";
import { Badge, Card, EmptyState, FlashMessages, Notice, PageHeader, Source, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { formatQor } from "@/lib/approvals";
import { G_STEPS, G_STEP_LABEL, type GResult, type GStep } from "@/lib/grants/engine";
import { classify } from "@/lib/grants/queries";
import { disagreements } from "@/lib/grants/portfolio";
import { CATEGORY_LABEL, wei } from "@/lib/grants";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grant intelligence" };

const REC: Record<string, { text: string; tone: "live" | "approval" | "pending" }> = {
  strong_candidate: { text: "STRONG CANDIDATE", tone: "live" }, needs_clarification: { text: "NEEDS CLARIFICATION", tone: "approval" }, further_review: { text: "FURTHER REVIEW", tone: "pending" },
};
const STATE_TEXT: Record<string, string> = { QUEUED: "Queued", RUNNING: "Running", AWAITING_HUMAN: "Package ready for reviewers", COMPLETED: "Completed", FAILED: "Failed", CANCELLED: "Cancelled", PAUSED_AI_UNAVAILABLE: "Paused: AI unavailable" };

interface Rev { id: string; application_id: string; recommendation: string; scored_points: number; scored_max: number; applicable_max: number; scores: Score[]; report: { missing?: Array<{ about: string; question: string }>; budget?: { rules?: Array<{ text: string }> } }; created_at: string; rubric_version: number }

export default async function Intelligence({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ task?: string; q?: string; pool?: string; by?: string; msg?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await getSession();
  if (!s.user) redirect(`/login?next=/grants/${id}/intelligence`);
  if (!s.org) redirect("/onboarding");
  if (!["owner", "administrator", "security_reviewer"].includes(s.org.role)) return <EmptyState title="Reviewers only">Grant investigations are visible to owners, administrators and security reviewers.</EmptyState>;
  const admin = ["owner", "administrator"].includes(s.org.role);
  const sb = (await supabaseServer())!;
  const { data: g } = await sb.from("grants").select("id,title,budget::text").eq("id", id).eq("organization_id", s.org.id).maybeSingle();
  if (!g) return <EmptyState title="Round not found" />;
  const { data: td, error: te } = await sb.from("agent_tasks").select("id,state,instruction,steps,result,error,created_at,updated_at").eq("organization_id", s.org.id).eq("kind", "grant_review").filter("result->>grant_id", "eq", id).order("created_at", { ascending: false }).limit(20);
  const tasks = (td ?? []) as Array<{ id: string; state: string; instruction: string | null; steps: GStep[]; result: GResult; error: string | null; created_at: string; updated_at: string }>;
  const task = tasks.find((t) => t.id === sp.task) ?? tasks[0];

  const { data: apps } = await sb.from("grant_applications").select("id,applicant_name,category,requested_amount::text,status").eq("grant_id", id).neq("status", "draft");
  const appName = new Map((apps ?? []).map((a) => [a.id as string, a.applicant_name as string]));
  const { data: rv } = await sb.from("grant_reviews").select("id,application_id,recommendation,scored_points,scored_max,applicable_max,scores,report,created_at,rubric_version").in("application_id", (apps ?? []).map((a) => a.id as string)).order("created_at", { ascending: false });
  const latest = new Map<string, Rev>();
  for (const r of (rv ?? []) as unknown as Rev[]) if (!latest.has(r.application_id)) latest.set(r.application_id, r);
  const { data: fl } = await sb.from("grant_risk_flags").select("application_id,code,severity,status").in("application_id", (apps ?? []).map((a) => a.id as string)).eq("status", "open");
  const awarded = (apps ?? []).filter((a) => a.status === "awarded").reduce((t, a) => t + BigInt(wei(a.requested_amount)), 0n);
  const remaining = BigInt(wei(g.budget)) - awarded;

  // Allocation simulator (deterministic, advisory)
  const poolWei = sp.pool && /^\d{1,12}(\.\d{1,6})?$/.test(sp.pool) ? BigInt(Math.round(Number(sp.pool) * 1e6)) * 10n ** 12n : remaining;
  const by = sp.by === "cost" ? "cost" : sp.by === "all" ? "all" : "score";
  const simItems = [...latest.values()].filter((r) => by === "all" || r.recommendation === "strong_candidate").map((r) => {
    const a = (apps ?? []).find((x) => x.id === r.application_id)!;
    const req = BigInt(wei(a.requested_amount));
    return { id: r.application_id, name: appName.get(r.application_id) ?? "?", requestedWei: req, value: by === "cost" ? -Number(req / 10n ** 15n) : r.scored_max ? Number(r.scored_points) / Number(r.scored_max) : 0 };
  });
  const sim = allocate(simItems, poolWei);

  // Stored-result questions
  const kind = sp.q ? classify(sp.q) : null;
  let answer: React.ReactNode = null;
  if (kind === "incomplete_budgets") {
    const hits = [...latest.values()].filter((r) => (r.report.missing ?? []).some((m) => m.about === "budget::text"));
    answer = hits.length ? <ul className="list-disc space-y-1 pl-5">{hits.map((r) => <li key={r.id}><Link className="underline" href={`/grants/applications/${r.application_id}`}>{appName.get(r.application_id)}</Link>: {(r.report.missing ?? []).filter((m) => m.about === "budget::text").map((m) => m.question).join(" ")}</li>)}</ul> : <p>No application's latest report has a budget question.</p>;
  } else if (kind === "verified_deployments") {
    const { data: ev } = await sb.from("grant_evidence").select("application_id,subject,claim,url,status,retrieved_at").eq("source", "qorechain").eq("status", "VERIFIED").in("application_id", (apps ?? []).map((a) => a.id as string));
    answer = ev?.length ? <ul className="list-disc space-y-1 pl-5">{ev.map((e, i) => <li key={i}><span className="font-medium">{appName.get(e.application_id as string)}</span>: {e.claim} (<a className="font-mono text-[12px] underline" href={e.url as string} target="_blank" rel="noreferrer">{String(e.subject).slice(0, 14)}…</a>, checked {new Date(e.retrieved_at as string).toLocaleString()})</li>)}</ul> : <p>No application has QoreChain evidence classified as verified. Run an investigation first, or no contracts or transactions were supplied.</p>;
  } else if (kind === "milestones") {
    const funded = (apps ?? []).filter((a) => a.status === "awarded");
    const { data: ms } = await sb.from("milestones").select("parent_id,idx,title,status,amount::text").eq("parent_type", "grant").in("parent_id", funded.map((a) => a.id as string)).order("idx");
    answer = funded.length ? <ul className="space-y-1">{funded.map((a) => <li key={a.id}><span className="font-medium">{a.applicant_name}</span>: {(ms ?? []).filter((m) => m.parent_id === a.id).map((m) => `${m.idx}. ${m.title} (${m.status})`).join("; ") || "no milestones"}</li>)}</ul> : <p>No application in this round has been awarded.</p>;
  } else if (kind === "shortlist" || kind === "compare") {
    answer = <p>See the {kind === "shortlist" ? "allocation scenarios" : "comparison"} below; they use the latest report of each application.</p>;
  } else if (sp.q) answer = <p>That question is not one Verac answers from stored results. To investigate, phrase it as an instruction to review the applications.</p>;

  const reviewIds = (rv ?? []).map((r) => r.id as string);
  const { data: ovd } = reviewIds.length ? await sb.from("grant_overrides").select("review_id,criterion,new_score,reason").in("review_id", reviewIds) : { data: [] };
  const { data: dec } = await sb.from("audit_events").select("subject,action,detail").eq("organization_id", s.org.id).in("action", ["grant.recommend", "grant.reject"]).in("subject", (apps ?? []).map((a) => a.id as string));
  const disagree = disagreements(
    ((rv ?? []) as unknown as Rev[]).map((r) => ({ id: r.id, applicationId: r.application_id, recommendation: r.recommendation, scores: r.scores as unknown as Array<{ key: string; label: string; max: number; score: number | null; by: string }> })).reverse(),
    ((ovd ?? []) as Array<Record<string, unknown>>).map((o) => ({ reviewId: o.review_id as string, criterion: o.criterion as string, newScore: Number(o.new_score), reason: o.reason as string })),
    ((dec ?? []) as Array<Record<string, unknown>>).map((d) => ({ applicationId: d.subject as string, decision: String(d.action).replace("grant.", ""), note: ((d.detail as { reason?: string } | null)?.reason) ?? "" })),
  );
  const criteria = [...new Set([...latest.values()].flatMap((r) => r.scores.map((x) => x.key)))];
  const pkg = task?.result?.package;

  return (
    <>
      <PageHeader title="Grant intelligence" eyebrow={<Link href={`/grants/${id}`} className="hover:underline">{g.title}</Link>}
        description="Agents investigate and draft; reviewers decide. Nothing here awards, rejects or pays."
        badge={<Badge tone="sim">ADVISORY</Badge>} actions={<Link href={`/grants/${id}`} className={btnSecondaryCls}>Back to the round</Link>} />
      <FlashMessages msg={sp.msg} error={sp.error ?? te?.message} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          {admin && <Card title="Ask Verac"><InvestigationControls grantId={id} activeTaskId={task?.id ?? null} activeState={task?.state ?? null} /></Card>}
          {sp.q && <Card title="Answer from stored results" description={`"${sp.q.slice(0, 160)}"`}><div className="text-[13.5px]">{answer}</div><Source>Computed from Verac's records and recorded evidence. No model was used.</Source></Card>}

          {!task ? <EmptyState title="No investigation yet">{admin ? "Run the instruction above to have the agents review this round." : "An administrator has not run an investigation for this round."}</EmptyState> : (
            <Card title="Investigation" description={`${STATE_TEXT[task.state] ?? task.state} · started ${new Date(task.created_at).toLocaleString()}`}>
              {task.instruction && <p className="mb-4 rounded-md bg-surface-2/60 p-3 text-[13px] text-muted">{task.instruction}</p>}
              <ol className="space-y-3">
                {G_STEPS.map((k) => {
                  const st = task.steps.find((x) => x.key === k);
                  const tone = !st ? "neutral" : st.status === "done" ? "live" : st.status === "failed" ? "failed" : "info";
                  return (
                    <li key={k} className="flex gap-3">
                      <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${!st ? "bg-surface-3" : st.status === "done" ? "bg-[var(--live)]" : "bg-[var(--accent)]"}`} />
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-medium">{G_STEP_LABEL[k]} <Badge tone={tone}>{!st ? "NOT STARTED" : st.status === "done" ? "DONE" : st.status.toUpperCase()}</Badge></p>
                        {st && <p className="text-[12.5px] text-muted">{st.summary}{st.finishedAt ? ` · ${new Date(st.finishedAt).toLocaleTimeString()}` : ""}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {task.error && <Notice tone="warn" className="mt-4">Last error (the step is retried): {task.error}</Notice>}
            </Card>
          )}

          {pkg && (
            <Card title="Review package" description={pkg.summary} flush>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="text-[12px] text-muted"><tr className="border-b border-line"><th className="px-5 py-2 font-medium">Application</th><th className="px-3 py-2 font-medium">Recommendation</th><th className="px-3 py-2 text-right font-medium">Rubric</th><th className="px-3 py-2 text-right font-medium">Requested</th><th className="px-3 py-2 font-medium">Flags</th><th className="px-5 py-2 font-medium">Open items</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {pkg.items.map((i) => (
                      <tr key={i.applicationId}>
                        <td className="px-5 py-2.5"><Link className="font-medium underline decoration-line-strong underline-offset-[3px]" href={`/grants/applications/${i.applicationId}`}>{i.name}</Link><span className="block text-[11.5px] text-muted">{i.category ? CATEGORY_LABEL[i.category] : ""}</span></td>
                        <td className="px-3 py-2.5"><Badge tone={REC[i.recommendation]?.tone ?? "neutral"}>{REC[i.recommendation]?.text ?? i.recommendation}</Badge><span className="mt-0.5 block text-[11.5px] text-muted">{i.why}</span></td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{i.scoredPoints}/{i.scoredMax}<span className="block text-[11.5px] text-muted">{i.unscored ? `${i.unscored} not scored` : `of ${i.applicableMax} applicable`}</span></td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatQor(i.requestedWei)}</td>
                        <td className="px-3 py-2.5">{i.flags.length ? i.flags.map((f) => <Badge key={f.code} tone={f.severity === "high" ? "failed" : "pending"} className="mr-1">{f.code.replace(/_/g, " ")}</Badge>) : <span className="text-muted">none</span>}</td>
                        <td className="px-5 py-2.5 text-muted">{i.questions ? `${i.questions} question(s)` : "none"}{!i.aiAssessed && <span className="block text-[11.5px]">AI not assessed</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pkg.conflicts.length > 0 && <div className="border-t border-line px-5 py-3"><p className="text-[12.5px] font-medium">Conflicting conclusions</p><ul className="mt-1 list-disc pl-5 text-[12.5px] text-muted">{pkg.conflicts.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
              <p className="border-t border-line px-5 py-3 text-[12px] text-muted">AI: {pkg.ai.assessed} assessed{pkg.ai.model ? ` with ${pkg.ai.model}` : ""}, {pkg.ai.notAssessed} not assessed (reviewers can score those manually). Scores are advisory; missing information is not counted as zero.</p>
            </Card>
          )}

          {latest.size > 0 && (
            <Card title="Compare applications" description="Latest report of each application. Criteria that could not be scored are shown as such, not as zero." flush>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="text-[11.5px] text-muted"><tr className="border-b border-line"><th className="px-5 py-2 font-medium">Criterion</th>{[...latest.values()].map((r) => <th key={r.id} className="px-3 py-2 font-medium"><Link className="underline" href={`/grants/applications/${r.application_id}`}>{appName.get(r.application_id)}</Link></th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {criteria.map((k) => (
                      <tr key={k}><td className="px-5 py-2 text-muted">{[...latest.values()].flatMap((r) => r.scores).find((x) => x.key === k)?.label ?? k}</td>
                        {[...latest.values()].map((r) => { const x = r.scores.find((y) => y.key === k); return <td key={r.id} className="px-3 py-2 tabular-nums">{!x ? "–" : x.state === "scored" ? `${x.score}/${x.max}` : <span className="text-muted">{x.state.replace("_", " ")}</span>}</td>; })}</tr>
                    ))}
                    <tr className="font-medium"><td className="px-5 py-2">Requested</td>{[...latest.values()].map((r) => <td key={r.id} className="px-3 py-2 tabular-nums">{formatQor(wei((apps ?? []).find((a) => a.id === r.application_id)?.requested_amount))} QOR</td>)}</tr>
                    <tr><td className="px-5 py-2 text-muted">Open flags</td>{[...latest.values()].map((r) => <td key={r.id} className="px-3 py-2">{(fl ?? []).filter((f) => f.application_id === r.application_id).map((f) => f.code).join(", ") || "none"}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Allocation scenarios" description="One possible way to spend a pool, never a decision. Whole applications only.">
            <form className="space-y-2" method="get">
              {task && <input type="hidden" name="task" value={task.id} />}
              <div><label htmlFor="pool" className={labelCls}>Pool (QOR)</label><input id="pool" name="pool" inputMode="decimal" className={inputCls} defaultValue={sp.pool ?? formatQor(remaining.toString())} /></div>
              <div><label htmlFor="by" className={labelCls}>Priority</label>
                <select id="by" name="by" defaultValue={by} className={inputCls}>
                  <option value="score">Strong candidates, highest rubric percentage first</option>
                  <option value="cost">Strong candidates, smallest request first (fund the most projects)</option>
                  <option value="all">Every reviewed application, highest rubric percentage first</option>
                </select></div>
              <button className={btnSecondaryCls}>Recalculate</button>
            </form>
            <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1 text-[13px]">
              <dt className="text-muted">Pool</dt><dd className="tabular-nums">{formatQor(poolWei.toString())} QOR</dd>
              <dt className="text-muted">Funded</dt><dd>{sim.funded.map((x) => appName.get(x)).join(", ") || "none"}</dd>
              <dt className="text-muted">Total</dt><dd className="tabular-nums">{formatQor(sim.totalWei.toString())} QOR, {formatQor(sim.leftWei.toString())} left</dd>
            </dl>
            {sim.skipped.length > 0 && <ul className="mt-2 list-disc pl-5 text-[12.5px] text-muted">{sim.skipped.map((x) => <li key={x.id}>{appName.get(x.id)}: {x.reason}</li>)}</ul>}
            <Source>Trade-off: ordering by score funds the best-rated first; ordering by request size funds more projects. Neither is objectively correct.</Source>
          </Card>
          <Card title="Reviewer disagreement" description="Where people scored or decided differently from the report. Each entry carries the reviewer's reason.">
            {disagree.length === 0 ? <p className="text-[13px] text-muted">No overrides or decisions against a recommendation yet.</p> : (
              <ul className="space-y-2 text-[13px]">{disagree.map((d, i) => <li key={i}><Link className="font-medium underline" href={`/grants/applications/${d.applicationId}`}>{appName.get(d.applicationId)}</Link>: {d.text}<span className="block text-[12px] text-muted">Reason: {d.reason || "not recorded"}</span></li>)}</ul>
            )}
          </Card>
          {tasks.length > 1 && (
            <Card title="Earlier investigations">
              <ul className="space-y-1 text-[13px]">{tasks.map((t) => <li key={t.id}><Link className={t.id === task?.id ? "font-semibold" : "underline"} href={`?task=${t.id}`}>{new Date(t.created_at).toLocaleString()}</Link> <span className="text-muted">· {STATE_TEXT[t.state] ?? t.state}</span></li>)}</ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
