import { redirect } from "next/navigation";
import { checkApplication } from "@qoreops/policy-engine";
import { Badge, Card, EmptyState, FlashMessages, Metric, Notice, PageHeader, Pipeline, Source, Steps, btnCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { ReviewButton } from "@/components/grants/review-button";
import { formatQor } from "@/lib/approvals";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { applyToGrant, awardApplication, closeGrant, createGrant, decideApplication } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grants" };

const TONE: Record<string, "approval" | "live" | "failed" | "pending" | "neutral" | "info"> = { submitted: "pending", under_review: "info", recommended: "approval", awarded: "live", rejected: "failed" };
const STAGES = [{ key: "submitted", label: "Submitted" }, { key: "under_review", label: "Under review" }, { key: "recommended", label: "Recommended" }, { key: "awarded", label: "Awarded" }, { key: "rejected", label: "Rejected" }];
const ADMIN = ["owner", "administrator"];
const wei = (v: unknown) => String(v).split(".")[0]!;

interface G { id: string; title: string; budget: string; status: string }
interface A {
  id: string; grant_id: string; applicant_user_id: string; applicant_name: string; requested_amount: string; pitch: string | null; status: string; recommended_by: string | null;
  review: { decision?: string; note?: string; ai?: { label?: string; fit?: number; summary?: string; strengths?: string[]; concerns?: string[]; questions_for_applicant?: string[] } } | null;
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <div><p className="text-[12.5px] font-medium text-muted">{title}</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13.5px]">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
}

/** What has to happen next to this application, in one sentence, for the person looking at it. */
function nextStep(a: A, admin: boolean, me: string): string {
  if (a.status === "submitted" || a.status === "under_review") return admin ? "Next: read it, optionally ask Gemini for an advisory read, then recommend or reject with a reason." : "Waiting for an administrator to review it.";
  if (a.status === "recommended") return admin ? (a.recommended_by === me ? "Next: a different administrator awards it. You recommended it, so you cannot." : "Next: award it and split it into milestones.") : "Recommended. Waiting for a second administrator to award it.";
  if (a.status === "awarded") return "Awarded. Milestones exist; evidence and payment for grant milestones are not built yet.";
  return "Rejected.";
}

export default async function Grants({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Grants" description="Grant rounds, applications and awards." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Grants live in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/grants");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = (await supabaseServer())!;
  const admin = ADMIN.includes(s.org.role);
  const applicant = s.org.role === "grant_applicant";

  const { data: gd, error } = await sb.from("grants").select("id,title,budget,status").eq("organization_id", s.org.id).order("created_at", { ascending: false });
  const grants = (gd ?? []) as unknown as G[];
  const { data: ad } = await sb.from("grant_applications").select("id,grant_id,applicant_user_id,applicant_name,requested_amount,pitch,status,recommended_by,review").eq("organization_id", s.org.id).order("created_at");
  const apps = (ad ?? []) as unknown as A[];

  const open = grants.filter((g) => g.status === "open");
  const sum = (xs: string[]) => xs.reduce((t, x) => t + BigInt(wei(x)), 0n);
  const budgetOpen = sum(open.map((g) => g.budget));
  const awardedAll = sum(apps.filter((a) => a.status === "awarded").map((a) => a.requested_amount));
  const toReview = apps.filter((a) => a.status === "submitted" || a.status === "under_review").length;
  const toAward = apps.filter((a) => a.status === "recommended").length;

  return (
    <>
      <PageHeader title="Grants" eyebrow="Operations"
        description="Rounds with a fixed budget, applications, a two-person award and milestones. Gemini can give an advisory read of a pitch; it never awards or rejects."
        badge={<Badge tone="sim" />}
        actions={admin ? <a href="#create" className={btnCls}>Open a round</a> : undefined} />
      <FlashMessages msg={sp.msg} error={sp.error ?? error?.message} />

      <section aria-label="Programme overview" className="mb-6 rounded-lg border border-line bg-surface p-5 shadow-card">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
          <Metric label="Open rounds" value={open.length} sub={`${formatQor(budgetOpen.toString())} QOR budgeted`} />
          <Metric label="Awarded so far" value={<>{formatQor(awardedAll.toString())} <span className="text-[13px] font-medium text-muted">QOR</span></>} sub="recorded in Verac, not paid" />
          <Metric label="Waiting for review" value={toReview} tone={toReview && admin ? "warn" : undefined} />
          <Metric label="Waiting for an award" value={toAward} tone={toAward && admin ? "warn" : undefined} />
        </dl>
        {apps.length > 0 && <div className="mt-5 border-t border-line pt-5"><Pipeline label="Applications by stage" stages={STAGES} counts={apps.reduce<Record<string, number>>((c, a) => ({ ...c, [a.status]: (c[a.status] ?? 0) + 1 }), {})} /></div>}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {grants.length === 0 ? <EmptyState title="No grant rounds yet" action={admin ? <a href="#create" className={btnCls}>Open the first round</a> : undefined}>{admin ? "A round has a title and a budget. Applications can never be awarded beyond it." : applicant ? "No round is open for applications right now. Check back later." : "An owner or administrator opens rounds."}</EmptyState> : grants.map((g) => {
            const mine = apps.filter((a) => a.grant_id === g.id);
            const awarded = mine.filter((a) => a.status === "awarded").reduce((t, a) => t + BigInt(wei(a.requested_amount)), 0n);
            const budget = BigInt(wei(g.budget));
            const pct = budget > 0n ? Number((awarded * 1000n) / budget) / 10 : 0;
            const applied = mine.some((a) => a.applicant_user_id === s.user!.id);
            return (
              <Card key={g.id} title={g.title} description={`${mine.length} application${mine.length === 1 ? "" : "s"}`}
                right={<><Badge tone={g.status === "open" ? "info" : "neutral"}>{g.status === "open" ? "OPEN" : g.status.toUpperCase()}</Badge>
                  {admin && g.status === "open" && <form action={closeGrant}><input type="hidden" name="id" value={g.id} /><button className={`${btnSecondaryCls} min-h-8 text-[12.5px]`}>Close round</button></form>}</>}>
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                    <span><span className="font-semibold tabular-nums">{formatQor(awarded.toString())}</span> <span className="text-muted">of {formatQor(wei(g.budget))} QOR awarded</span></span>
                    <span className="text-muted tabular-nums">{formatQor((budget - awarded).toString())} QOR left</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${pct}% of the budget awarded`}><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                </div>

                {applicant && g.status === "open" && !applied && (
                  <form action={applyToGrant} className="mt-5 space-y-3 rounded-lg border border-line bg-surface-2/50 p-4">
                    <p className="text-[14px] font-medium">Apply to this round</p>
                    <input type="hidden" name="grant" value={g.id} />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
                      <div><label htmlFor={`n-${g.id}`} className={labelCls}>Your name or team</label><input id={`n-${g.id}`} name="name" required maxLength={120} className={inputCls} /></div>
                      <div><label htmlFor={`a-${g.id}`} className={labelCls}>Amount (QOR)</label><input id={`a-${g.id}`} name="amount" required inputMode="decimal" className={inputCls} /></div>
                    </div>
                    <div><label htmlFor={`p-${g.id}`} className={labelCls}>Pitch</label><textarea id={`p-${g.id}`} name="pitch" required minLength={20} maxLength={6000} rows={5} className={inputCls} placeholder="What will you build, and why does it fit this round?" /></div>
                    <div className="flex flex-wrap items-center gap-3"><button className={btnCls}>Apply</button><span className="text-[12.5px] text-muted">Applications are plain text, not encrypted. Do not paste secrets.</span></div>
                  </form>
                )}
                {applicant && applied && <Notice tone="info" className="mt-4">You have applied to this round. Its status is below.</Notice>}

                {mine.length > 0 && (
                  <ul className="-mx-5 mt-5 divide-y divide-line border-t border-line">
                    {mine.map((a) => {
                      const check = checkApplication({ requested: wei(a.requested_amount), pitch: a.pitch ?? "", name: a.applicant_name }, { budget: wei(g.budget), awarded: awarded.toString(), otherPitches: mine.filter((o) => o.id !== a.id).map((o) => o.pitch ?? "") });
                      const isOpen = ["submitted", "under_review"].includes(a.status);
                      const ai = a.review?.ai;
                      const blocking = check.flags.filter((f) => f.blocking).length;
                      const needsMe = admin && (isOpen || (a.status === "recommended" && a.recommended_by !== s.user!.id));
                      return (
                        <li key={a.id}>
                          <details className="group" open={needsMe && mine.length <= 3}>
                            <summary className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-2/50">
                              <span className="min-w-0 flex-1"><span className="text-[13.5px] font-medium">{a.applicant_name}</span>
                                <span className="block text-[12.5px] text-muted">{nextStep(a, admin, s.user!.id)}</span></span>
                              {admin && blocking > 0 && <Badge tone="failed">{blocking} BLOCKING</Badge>}
                              {ai?.fit !== undefined && <span className="text-[12.5px] text-muted">AI fit {ai.fit}/10</span>}
                              <span className="text-[14px] font-semibold tabular-nums">{formatQor(wei(a.requested_amount))} <span className="text-[12px] font-medium text-muted">QOR</span></span>
                              <Badge tone={TONE[a.status] ?? "neutral"}>{a.status.replace("_", " ").toUpperCase()}</Badge>
                            </summary>
                            <div className="space-y-4 px-5 pb-5">
                              <p className="whitespace-pre-wrap break-words rounded-md bg-surface-2/60 p-3 text-[13.5px] leading-relaxed">{a.pitch}</p>
                              {admin && check.flags.length > 0 && (
                                <div><p className="text-[12.5px] font-medium text-muted">Fixed-rule checks</p>
                                  <ul className="mt-1 space-y-1 text-[13.5px]">{check.flags.map((f) => <li key={f.code} className={f.blocking ? "text-[var(--bad)]" : "text-muted"}>{f.blocking ? "Blocking: " : "Note: "}{f.message}</li>)}</ul></div>
                              )}
                              {ai?.summary && (
                                <div className="space-y-3 rounded-lg border border-[color-mix(in_srgb,var(--sim)_25%,transparent)] bg-[var(--sim-bg)]/50 p-4">
                                  <div className="flex flex-wrap items-center gap-2"><Badge tone="sim">{ai.label ?? "AI REVIEW"}</Badge><span className="text-[12.5px] text-muted">Advice only. It does not decide.</span></div>
                                  <p className="text-[13.5px]"><span className="font-medium">Fit {ai.fit}/10.</span> {ai.summary}</p>
                                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2"><List title="Strengths" items={ai.strengths} /><List title="Concerns" items={ai.concerns} /></div>
                                  <List title="Questions for the applicant" items={ai.questions_for_applicant} />
                                </div>
                              )}
                              {a.review?.decision && <p className="text-[13.5px] text-muted">Decision: {a.review.decision}{a.review.note ? ` (${a.review.note})` : ""}</p>}
                              {admin && (isOpen || a.status === "recommended") && check.aiEligible && <ReviewButton id={a.id} again={!!ai} />}
                              {admin && isOpen && (
                                <form action={decideApplication} className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
                                  <input type="hidden" name="id" value={a.id} />
                                  <div className="min-w-[14rem] flex-1"><label htmlFor={`note-${a.id}`} className={labelCls}>Reason for the decision</label><input id={`note-${a.id}`} name="note" required minLength={5} maxLength={500} className={inputCls} /></div>
                                  <button name="decision" value="recommend" className={btnCls}>Recommend</button>
                                  <button name="decision" value="reject" className={btnSecondaryCls}>Reject</button>
                                </form>
                              )}
                              {admin && a.status === "recommended" && (a.recommended_by === s.user!.id
                                ? <Notice tone="neutral">You recommended this application, so a different administrator must award it.</Notice>
                                : (
                                  <form action={awardApplication} className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
                                    <input type="hidden" name="id" value={a.id} />
                                    <div><label htmlFor={`c-${a.id}`} className={labelCls}>Equal milestones</label><input id={`c-${a.id}`} name="count" type="number" min={1} max={10} defaultValue={2} className={`${inputCls} w-24`} /></div>
                                    <button className={btnCls}>Award</button>
                                  </form>
                                ))}
                            </div>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>

        <div className="space-y-6">
          {admin && (
            <Card id="create" title="Open a grant round" description="Awards can never exceed the budget you set here.">
              <form action={createGrant} className="space-y-3">
                <div><label htmlFor="g-title" className={labelCls}>Title</label><input id="g-title" name="title" required minLength={3} maxLength={160} className={inputCls} placeholder="Developer tooling round" /></div>
                <div><label htmlFor="g-budget" className={labelCls}>Budget (QOR)</label><input id="g-budget" name="budget" required inputMode="decimal" className={inputCls} placeholder="100" /></div>
                <button className={btnCls}>Open round</button>
              </form>
            </Card>
          )}
          <Card title="How a grant is decided">
            <Steps compact steps={[
              { label: "Applicant applies", detail: "Name, amount and pitch, against an open round.", state: "step" },
              { label: "Fixed rules check it", detail: "Budget left, duplicates and missing details. Blocking flags stop an award.", state: "step" },
              { label: "Optional AI read", detail: "Gemini summarises fit, strengths and concerns. Advice only.", state: "step" },
              { label: "One administrator recommends", detail: "With a written reason.", state: "step" },
              { label: "A different administrator awards", detail: "And splits it into equal milestones.", state: "step" },
            ]} />
            <Source>Awards are recorded in Verac only. No QOR is sent and no on-chain escrow is created for grants yet.</Source>
          </Card>
        </div>
      </div>
    </>
  );
}
