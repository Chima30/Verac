import Link from "next/link";
import { Fragment } from "react";
import { redirect } from "next/navigation";
import { checkApplication } from "@qoreops/policy-engine";
import { ReviewButton } from "@/components/grants/review-button";
import { history as grantHistory } from "@/lib/grants/portfolio";
import { MilestonesPanel, type FundRow, type MsEvidence, type MsRow, type SubRow } from "@/components/grants/milestones-panel";
import { ApplicantClarifications, ReviewerPanels, type ClarRow, type EvidenceRow, type FlagRow, type OverrideRow, type ReviewRow } from "@/components/grants/review-panels";
import { Badge, Card, EmptyState, FlashMessages, Notice, PageHeader, Source, btnCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { formatQor } from "@/lib/approvals";
import { CATEGORY_LABEL, STATUS_TEXT, STATUS_TONE, diffVersions, nextAction, sumWei, wei, type AppRow, type RoundRow, type VersionRow } from "@/lib/grants";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { awardApplication, decideApplication } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grant application" };

const ADMIN = ["owner", "administrator"];
const EXPLORER = "https://explore.qore.network";

function Section({ title, text }: { title: string; text?: string }) {
  if (!text?.trim()) return null;
  return <div><h3 className="text-[12.5px] font-medium text-muted">{title}</h3><p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed">{text}</p></div>;
}

export default async function Application({ params, searchParams }: { params: Promise<{ appId: string }>; searchParams: Promise<{ msg?: string; error?: string; from?: string; to?: string }> }) {
  const { appId } = await params;
  const sp = await searchParams;
  const s = await getSession();
  if (!s.user) redirect(`/login?next=/grants/applications/${appId}`);
  if (!s.org) redirect("/onboarding");
  const sb = (await supabaseServer())!;
  const admin = ADMIN.includes(s.org.role);

  // Row-level security decides visibility: an applicant sees only their own; administrators see submitted applications.
  const { data: ad } = await sb.from("grant_applications").select("id,grant_id,applicant_user_id,applicant_name,requested_amount::text,status,category,content,recipient_address,version,submitted_at,amendment_open,recommended_by,pitch,created_at,updated_at,review").eq("id", appId).maybeSingle();
  if (!ad) return <EmptyState title="Application not found">It does not exist, or you are not allowed to see it.</EmptyState>;
  const a = ad as unknown as AppRow;
  const mine = a.applicant_user_id === s.user.id;
  const { data: gd } = await sb.from("grants").select("id,title,budget::text,status,description,requirements,categories,deadline,max_request::text").eq("id", a.grant_id).maybeSingle();
  const round = gd as unknown as RoundRow;
  const { data: vd } = await sb.from("grant_application_versions").select("version,requested_amount::text,category,recipient_address,content,reason,created_at,changed_by").eq("application_id", appId).order("version");
  const versions = (vd ?? []) as unknown as VersionRow[];
  const { data: md } = await sb.from("milestones").select("id,idx,title,amount::text,status,release_tx_hash,review").eq("parent_type", "grant").eq("parent_id", appId).order("idx");
  const milestones = (md ?? []) as unknown as MsRow[];
  // Phase 6 records (migration 0021). RLS limits them to reviewers, finance and the recipient.
  const msIds = milestones.map((m) => m.id);
  const [{ data: sd }, { data: fd }] = await Promise.all([
    msIds.length ? sb.from("grant_milestone_submissions").select("milestone_id,attempt,description,links,transactions,created_at").in("milestone_id", msIds) : Promise.resolve({ data: [] }),
    msIds.length ? sb.from("grant_funding_records").select("milestone_id,status,route,reasons,tx_hash,block_number,created_at,transaction_id").in("milestone_id", msIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const { data: med } = msIds.length && ["owner", "administrator", "security_reviewer"].includes(s.org.role)
    ? await sb.from("grant_evidence").select("milestone_id,claim,status,reason,url,retrieved_at").in("milestone_id", msIds).order("id")
    : { data: [] };

  let flags: ReturnType<typeof checkApplication> | null = null;
  if (admin && round) {
    const { data: others } = await sb.from("grant_applications").select("id,pitch,requested_amount::text,status").eq("grant_id", a.grant_id).neq("status", "draft");
    const awarded = sumWei((others ?? []).filter((o) => o.status === "awarded").map((o) => o.requested_amount));
    flags = checkApplication({ requested: wei(a.requested_amount), pitch: a.pitch ?? "", name: a.applicant_name }, { budget: wei(round.budget), awarded: awarded.toString(), otherPitches: (others ?? []).filter((o) => o.id !== a.id).map((o) => o.pitch ?? "") });
  }
  const reviewer = admin || s.org.role === "security_reviewer";
  // Reviewer data (RLS: owners, administrators and security reviewers only). Applicants see only clarifications sent to them.
  let review: ReviewRow | null = null, evidence: EvidenceRow[] = [], overrides: OverrideRow[] = [], riskFlags: FlagRow[] = [], conflicted = false;
  if (reviewer) {
    const { data: rv } = await sb.from("grant_reviews").select("id,task_id,created_at,rubric_version,application_version,scores,scored_points,scored_max,applicable_max,recommendation,model,report").eq("application_id", appId).order("created_at", { ascending: false }).limit(1);
    review = ((rv ?? [])[0] as unknown as ReviewRow | undefined) ?? null;
    let eq = sb.from("grant_evidence").select("id,source,subject,claim,status,reason,url,retrieved_at,task_id,observed").eq("application_id", appId).order("id");
    if (review?.task_id) eq = eq.eq("task_id", review.task_id);
    const { data: ev } = await eq;
    evidence = (ev ?? []) as unknown as EvidenceRow[];
    if (!review?.task_id && evidence.length) { const last = evidence[evidence.length - 1]!.task_id; evidence = evidence.filter((e) => e.task_id === last); }
    if (review) { const { data: ov } = await sb.from("grant_overrides").select("criterion,new_score,reason,by_user,created_at").eq("review_id", review.id).order("created_at"); overrides = (ov ?? []) as unknown as OverrideRow[]; }
    const { data: fl } = await sb.from("grant_risk_flags").select("id,code,severity,message,status,decided_reason,evidence").eq("application_id", appId).order("created_at", { ascending: false });
    riskFlags = ((fl ?? []) as unknown as FlagRow[]).sort((x, y) => (x.status === "open" ? 0 : 1) - (y.status === "open" ? 0 : 1));
    const { data: cf } = await sb.from("grant_conflicts").select("user_id").eq("application_id", appId).eq("user_id", s.user.id);
    conflicted = !!cf?.length;
  }
  let previous: ReturnType<typeof grantHistory> = [];
  if (reviewer) {
    const { data: others } = await sb.from("grant_applications").select("id,applicant_name,status,requested_amount::text,grant_id,applicant_user_id,content").eq("organization_id", s.org.id).eq("applicant_user_id", a.applicant_user_id).eq("status", "awarded").neq("id", a.id);
    if (others?.length) {
      const { data: oms } = await sb.from("milestones").select("id,parent_id,idx,title,amount::text,status").eq("parent_type", "grant").in("parent_id", others.map((o) => o.id as string));
      previous = grantHistory({ id: a.id, name: a.applicant_name, status: a.status, requested: String(a.requested_amount), grantId: a.grant_id, applicantUserId: a.applicant_user_id, content: null },
        others.map((o) => ({ id: o.id as string, name: o.applicant_name as string, status: o.status as string, requested: String(o.requested_amount), grantId: o.grant_id as string, applicantUserId: o.applicant_user_id as string, content: null })),
        (oms ?? []).map((m) => ({ id: m.id as string, parentId: m.parent_id as string, idx: m.idx as number, title: m.title as string, amount: String(m.amount), status: m.status as string })));
    }
  }
  const { data: cl } = await sb.from("grant_clarifications").select("id,questions,status,drafted_by,sent_at,response,responded_at,created_at").eq("application_id", appId).neq("status", "cancelled").order("created_at", { ascending: false });
  const clars = (cl ?? []) as unknown as ClarRow[];
  const c = a.content ?? {};
  const isOpen = ["submitted", "under_review"].includes(a.status);
  const from = versions.find((v) => v.version === Number(sp.from)) ?? versions[versions.length - 2];
  const to = versions.find((v) => v.version === Number(sp.to)) ?? versions[versions.length - 1];
  const changes = from && to && from.version !== to.version ? diffVersions(from, to) : [];
  const recipientChanged = versions.length > 1 && new Set(versions.map((v) => v.recipient_address.toLowerCase())).size > 1;

  return (
    <>
      <PageHeader title={a.applicant_name} eyebrow={round ? <Link href={`/grants/${round.id}`} className="hover:underline">{round.title}</Link> : "Grant application"}
        description={nextAction(a, admin, s.user.id)}
        badge={<Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{STATUS_TEXT[a.status] ?? a.status}</Badge>}
        actions={mine && (a.status === "draft" || a.amendment_open) ? <Link href={`/grants/${a.grant_id}/apply`} className={btnCls}>{a.status === "draft" ? "Continue the draft" : "Amend and resubmit"}</Link> : undefined} />
      <FlashMessages msg={sp.msg} error={sp.error} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <Card title="Application" description={`Version ${a.version || 1}${a.submitted_at ? `, submitted ${new Date(a.submitted_at).toLocaleString()}` : ""}. Applicant-provided: these are claims until evidence verifies them.`}>
            <div className="space-y-4">
              {!a.content || !Object.keys(a.content).length ? <Section title="Pitch (submitted before structured applications existed)" text={a.pitch ?? ""} /> : (
                <>
                  <Section title="1. Overview" text={c.overview} />
                  <Section title="2. Problem" text={c.problem} />
                  <Section title="3. Proposed solution" text={c.solution} />
                  <Section title="4. Team and contributors" text={c.team} />
                  <Section title="5. Relevant experience" text={c.experience} />
                  <Section title="6. Technical implementation" text={c.technical} />
                  <Section title="10. Timeline" text={c.timeline} />
                  <Section title="12. Success metrics" text={c.metrics} />
                </>
              )}
            </div>
          </Card>

          {mine && <ApplicantClarifications appId={a.id} clars={clars} amendmentOpen={a.amendment_open} grantId={a.grant_id} />}
          {reviewer && !mine && <ReviewerPanels appId={a.id} evidence={evidence} review={review} overrides={overrides} flags={riskFlags} clars={clars} conflicted={conflicted} admin={admin} />}

          {(c.links || c.contracts?.length || c.transactions?.length) && (
            <Card title="7. Links and on-chain references" description="As submitted. Verac never runs applicant code.">
              <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 text-[13px] sm:grid-cols-[9rem_1fr]">
                {(["website", "docs", "demo"] as const).map((k) => c.links?.[k] ? <Fragment key={k}><dt className="text-muted">{k[0]!.toUpperCase() + k.slice(1)}</dt><dd className="break-all">{c.links[k]}</dd></Fragment> : null)}
                {c.links?.repos?.length ? <><dt className="text-muted">Repositories</dt><dd className="space-y-0.5">{c.links.repos.map((r) => <span key={r} className="block break-all font-mono text-[12.5px]">{r}</span>)}</dd></> : null}
                {c.contracts?.length ? <><dt className="text-muted">Contracts</dt><dd className="space-y-0.5">{c.contracts.map((x) => <a key={x} className="block break-all font-mono text-[12.5px] underline" href={`${EXPLORER}/address/${x}`} target="_blank" rel="noreferrer">{x}</a>)}</dd></> : null}
                {c.transactions?.length ? <><dt className="text-muted">Transactions</dt><dd className="space-y-0.5">{c.transactions.map((x) => <a key={x} className="block break-all font-mono text-[12.5px] underline" href={`${EXPLORER}/tx/${x}`} target="_blank" rel="noreferrer">{x}</a>)}</dd></> : null}
              </dl>
            </Card>
          )}

          <Card title="8 to 11. Funding, budget and milestones" flush>
            <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
              <div className="border-b border-line p-5 md:border-b-0 md:border-r">
                <p className="text-[12.5px] font-medium text-muted">Requested</p>
                <p className="text-[20px] font-semibold tabular-nums">{formatQor(wei(a.requested_amount))} <span className="text-[13px] font-medium text-muted">QOR</span></p>
                <p className="mt-2 text-[12.5px] text-muted">To <span className="break-all font-mono">{a.recipient_address ?? "not given"}</span></p>
                {recipientChanged && <Notice tone="warn" className="mt-3">The recipient address changed between versions. See the version comparison.</Notice>}
                {c.budget?.length ? <table className="mt-3 w-full text-[13px]"><tbody className="divide-y divide-line">{c.budget.map((b, i) => <tr key={i}><td className="py-1.5 pr-2">{b.item}</td><td className="py-1.5 text-right tabular-nums">{formatQor(wei(b.amount))}</td></tr>)}</tbody></table> : <p className="mt-3 text-[13px] text-muted">No budget breakdown.</p>}
              </div>
              <div className="p-5">
                <p className="text-[12.5px] font-medium text-muted">Proposed milestones</p>
                {c.milestones?.length ? <ol className="mt-2 space-y-2.5 text-[13px]">{c.milestones.map((m, i) => (
                  <li key={i}><p className="font-medium">{i + 1}. {m.title} <span className="font-normal text-muted">· {formatQor(wei(m.amount))} QOR · due {m.due}</span></p><p className="text-muted">{m.deliverable}</p><p className="text-[12px] text-muted">Verified by: {m.verification}</p></li>
                ))}</ol> : <p className="mt-2 text-[13px] text-muted">No milestones proposed.</p>}
              </div>
            </div>
          </Card>

          {milestones.length > 0 && (
            <MilestonesPanel appId={a.id} milestones={milestones} plan={(c.milestones ?? []).map((m) => ({ title: m.title, deliverable: m.deliverable, verification: m.verification, due: m.due }))}
              subs={(sd ?? []) as unknown as SubRow[]} evidence={(med ?? []) as unknown as MsEvidence[]} funding={(fd ?? []) as unknown as FundRow[]}
              role={s.org.role} applicant={mine} conflicted={conflicted} />
          )}

          {versions.length > 0 && (
            <Card title="Version history" description="Every submitted state is kept. Nothing is overwritten.">
              <ol className="space-y-1 text-[13px]">{versions.map((v) => <li key={v.version}><span className="font-medium">v{v.version}</span> <span className="text-muted">· {new Date(v.created_at).toLocaleString()} · {v.reason}</span></li>)}</ol>
              {changes.length > 0 && (
                <div className="mt-4 border-t border-line pt-4">
                  <p className="text-[13px] font-medium">Changes from v{from!.version} to v{to!.version}</p>
                  <ul className="mt-2 space-y-2 text-[12.5px]">{changes.map((ch) => (
                    <li key={ch.field}><span className="font-medium">{ch.field}</span>
                      <span className="mt-0.5 block break-words rounded bg-[var(--bad-bg,#fdecec)]/40 px-2 py-1 font-mono text-[11.5px] line-through decoration-[var(--bad)]/50">{ch.before.slice(0, 600) || "(empty)"}</span>
                      <span className="mt-0.5 block break-words rounded bg-[var(--live-bg)]/40 px-2 py-1 font-mono text-[11.5px]">{ch.after.slice(0, 600) || "(empty)"}</span></li>
                  ))}</ul>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {reviewer && (
            <Card title="Previous grants" description="Earlier awarded applications from the same applicant. Past funding never implies approval.">
              {previous.length === 0 ? <p className="text-[13px] text-muted">None in this organisation.</p> : (
                <ul className="space-y-1 text-[13px]">{previous.map((p) => <li key={p.applicationId}><Link className="underline" href={`/grants/applications/${p.applicationId}`}>{p.name}</Link>: {p.released} of {p.milestones} milestones released{p.pending ? `, ${p.pending} open` : ""}</li>)}</ul>
              )}
            </Card>
          )}
          {reviewer && <a href={`/api/grants/receipt?app=${a.id}`} className={`${btnSecondaryCls} w-full justify-center`}>Download decision receipt (JSON)</a>}
          <Card title="Status">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-[13px]">
              <dt className="text-muted">Category</dt><dd>{a.category ? CATEGORY_LABEL[a.category] : "legacy application"}</dd>
              <dt className="text-muted">Version</dt><dd>v{a.version || 1}</dd>
              <dt className="text-muted">Requested</dt><dd className="tabular-nums">{formatQor(wei(a.requested_amount))} QOR</dd>
              {a.review?.decision && <><dt className="text-muted">Decision</dt><dd>{a.review.decision}{a.review.note ? `: ${a.review.note}` : ""}</dd></>}
            </dl>
          </Card>

          {admin && flags && flags.flags.length > 0 && (
            <Card title="Fixed-rule checks" description="Deterministic. A flag is for a human to look at, not a verdict.">
              <ul className="space-y-1 text-[13px]">{flags.flags.map((f) => <li key={f.code} className={f.blocking ? "text-[var(--bad)]" : "text-muted"}>{f.blocking ? "Blocking: " : "Note: "}{f.message}</li>)}</ul>
            </Card>
          )}

          {admin && a.review?.ai?.summary && (
            <Card title="Advisory AI read" description={`${a.review.ai.label ?? "AI REVIEW, ADVISORY ONLY"}${a.review.ai.model ? ` · ${a.review.ai.model}` : ""}`}>
              <p className="text-[13.5px]"><span className="font-medium">Fit {a.review.ai.fit}/10.</span> {a.review.ai.summary}</p>
              {a.review.ai.concerns?.length ? <ul className="mt-2 list-disc pl-5 text-[13px] text-muted">{a.review.ai.concerns.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
            </Card>
          )}

          {admin && conflicted && (isOpen || a.status === "recommended") && <Notice tone="warn">You declared a conflict on this application, so the decision controls are hidden.</Notice>}
          {admin && !conflicted && (isOpen || a.status === "recommended") && (
            <Card title="Decide">
              {flags?.aiEligible !== false && (isOpen || a.status === "recommended") && <div className="mb-4"><ReviewButton id={a.id} again={!!a.review?.ai} /></div>}
              {isOpen && (
                <form action={decideApplication} className="space-y-2">
                  <input type="hidden" name="id" value={a.id} />
                  <label htmlFor="note" className={labelCls}>Reason for the decision (recorded)</label>
                  <input id="note" name="note" required minLength={5} maxLength={500} className={inputCls} />
                  <div className="flex gap-2"><button name="decision" value="recommend" className={btnCls}>Recommend</button><button name="decision" value="reject" className={btnSecondaryCls}>Reject</button></div>
                </form>
              )}
              {a.status === "recommended" && (a.recommended_by === s.user.id
                ? <Notice tone="neutral">You recommended this application, so a different administrator must award it.</Notice>
                : (
                  <form action={awardApplication} className="space-y-2">
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="count" value={Math.max(1, Math.min(10, c.milestones?.length ?? 2))} />
                    <p className="text-[13px] text-muted">{c.milestones?.length ? `Awards ${formatQor(wei(a.requested_amount))} QOR with the applicant's ${c.milestones.length} milestones.` : "Awards with two equal milestones (legacy application)."} The round budget is checked in the same database transaction.</p>
                    <button className={btnCls}>Award</button>
                  </form>
                ))}
              <Source>The AI never awards, rejects or moves funds. Every decision is recorded with its author and reason.</Source>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
