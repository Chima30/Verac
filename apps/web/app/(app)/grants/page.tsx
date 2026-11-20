import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, FlashMessages, HowItWorks, Metric, PageHeader, Pipeline, Source, Stat, StatRow, Steps, btnCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { Panel } from "@/components/ui-client";
import { formatQor } from "@/lib/approvals";
import { CATEGORY_LABEL, STATUS_TEXT, STATUS_TONE, nextAction, sumWei, wei, type AppRow, type RoundRow } from "@/lib/grants";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { createRound } from "./actions";
import { loadGrantDemo } from "./sample";
import { PortfolioCard } from "@/components/grants/portfolio-card";
import { alerts as buildAlerts, portfolio, type PApp } from "@/lib/grants/portfolio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grants" };

const ADMIN = ["owner", "administrator"];
const CATS = ["software", "research", "education", "community", "other"];
const STAGES = ["submitted", "under_review", "clarification_requested", "recommended", "awarded", "rejected"].map((k) => ({ key: k, label: STATUS_TEXT[k]!.toLowerCase().replace(/^\w/, (x) => x.toUpperCase()) }));
const isOpen = (g: RoundRow) => g.status === "open" && (!g.deadline || new Date(g.deadline) > new Date());

export default async function Grants({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Grants" description="Grant programmes, applications, reviews and milestones." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Grants live in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/grants");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = (await supabaseServer())!;
  const admin = ADMIN.includes(s.org.role);
  const applicant = s.org.role === "grant_applicant";

  // Newer columns first; fall back to the original ones if migration 0019 has not been applied yet.
  let { data: gd, error } = await sb.from("grants").select("id,title,budget::text,status,description,requirements,categories,deadline,max_request::text,created_at").eq("organization_id", s.org.id).order("created_at", { ascending: false });
  const migrated = !error;
  if (error) ({ data: gd, error } = (await sb.from("grants").select("id,title,budget::text,status,created_at").eq("organization_id", s.org.id).order("created_at", { ascending: false })) as unknown as { data: typeof gd; error: typeof error });
  const rounds = (gd ?? []) as unknown as RoundRow[];
  const { data: ad } = await sb.from("grant_applications").select(migrated ? "id,grant_id,applicant_user_id,applicant_name,requested_amount::text,status,category,version,submitted_at,amendment_open,recommended_by,created_at" : "id,grant_id,applicant_user_id,applicant_name,requested_amount::text,status,recommended_by,created_at").eq("organization_id", s.org.id).order("created_at", { ascending: false });
  const apps = (ad ?? []) as unknown as AppRow[];
  const live = apps.filter((a) => a.status !== "draft");

  const open = rounds.filter(isOpen);
  const budget = sumWei(rounds.filter((g) => g.status === "open").map((g) => g.budget));
  const awarded = sumWei(live.filter((a) => a.status === "awarded").map((a) => a.requested_amount));
  const requested = sumWei(live.filter((a) => !["rejected"].includes(a.status)).map((a) => a.requested_amount));
  const awaiting = live.filter((a) => ["submitted", "under_review"].includes(a.status)).length;
  const clarifying = live.filter((a) => a.status === "clarification_requested").length;
  const toAward = live.filter((a) => a.status === "recommended").length;
  const myApps = apps.filter((a) => a.applicant_user_id === s.user!.id);

  // Portfolio and alerts (administrators; needs migrations 0019 to 0021, otherwise empty).
  let pf: ReturnType<typeof portfolio> | null = null, al: ReturnType<typeof buildAlerts> = [];
  if (admin && migrated) {
    const awardedIds = live.filter((a) => a.status === "awarded").map((a) => a.id);
    const { data: full } = await sb.from("grant_applications").select("id,applicant_name,status,requested_amount::text,grant_id,applicant_user_id,content").eq("organization_id", s.org.id).in("status", ["recommended", "awarded"]);
    const pApps: PApp[] = (full ?? []).map((a) => ({ id: a.id as string, name: a.applicant_name as string, status: a.status as string, requested: String(a.requested_amount), grantId: a.grant_id as string, applicantUserId: a.applicant_user_id as string, content: a.content as PApp["content"] }));
    const { data: msd } = awardedIds.length ? await sb.from("milestones").select("id,parent_id,idx,title,amount::text,status").eq("parent_type", "grant").in("parent_id", awardedIds) : { data: [] };
    const msIds = (msd ?? []).map((m) => m.id as string);
    const [{ data: fdd }, { data: sdd }, { data: fld }, { data: act }] = await Promise.all([
      msIds.length ? sb.from("grant_funding_records").select("milestone_id,status,created_at").in("milestone_id", msIds) : Promise.resolve({ data: [] }),
      msIds.length ? sb.from("grant_milestone_submissions").select("milestone_id,created_at").in("milestone_id", msIds) : Promise.resolve({ data: [] }),
      pApps.length ? sb.from("grant_risk_flags").select("application_id,code,severity,status").in("application_id", pApps.map((a) => a.id)).eq("status", "open") : Promise.resolve({ data: [] }),
      awardedIds.length ? sb.from("grant_evidence").select("application_id,observed,retrieved_at").in("application_id", awardedIds).like("claim", "%development activity%").order("retrieved_at", { ascending: false }) : Promise.resolve({ data: [] }),
    ]);
    const ms = (msd ?? []).map((m) => ({ id: m.id as string, parentId: m.parent_id as string, idx: m.idx as number, title: m.title as string, amount: String(m.amount), status: m.status as string }));
    const fund = ((fdd ?? []) as Array<Record<string, unknown>>).map((f) => ({ milestoneId: f.milestone_id as string, status: f.status as string, createdAt: f.created_at as string }));
    const latestAct = new Map<string, { applicationId: string; newestCommit: string | null; retrievedAt: string }>();
    for (const e of (act ?? []) as Array<Record<string, unknown>>) if (!latestAct.has(e.application_id as string)) latestAct.set(e.application_id as string, { applicationId: e.application_id as string, newestCommit: ((e.observed as { newestCommit?: string } | null)?.newestCommit) ?? null, retrievedAt: e.retrieved_at as string });
    pf = portfolio(pApps, ms, fund);
    al = buildAlerts(pApps, ms, fund, ((sdd ?? []) as Array<Record<string, unknown>>).map((x) => ({ milestoneId: x.milestone_id as string, createdAt: x.created_at as string })),
      ((fld ?? []) as Array<Record<string, unknown>>).map((f) => ({ applicationId: f.application_id as string, code: f.code as string, severity: f.severity as string, status: f.status as string })), [...latestAct.values()]);
  }

  return (
    <>
      <PageHeader title="Grants" eyebrow="Operations"
        description={admin ? "Programmes, applications and evidence-based reviews. Agents investigate and draft; people decide; funds move only through the treasury's approval path." : "Open grant programmes and your applications."}
        badge={<Badge tone="sim" />}
        actions={admin ? <><form action={loadGrantDemo}><button className={btnSecondaryCls} title="Three fictional applications (Alpha, Beta, Gamma) in a 20,000 QOR round, clearly labelled SAMPLE">Load sample programme</button></form><a href="#create" className={btnCls}>Open a round</a></> : undefined} />
      <FlashMessages msg={sp.msg} error={sp.error ?? error?.message} />
      {admin && rounds.length > 0 && (
        <StatRow>
          <Stat tint="blush" label="Open budget" value={formatQor(sumWei(rounds.filter(isOpen).map((g) => g.budget)).toString())} sub={`QOR across ${rounds.filter(isOpen).length} open round${rounds.filter(isOpen).length === 1 ? "" : "s"}`} />
          <Stat tint="blush" label="Awarded" value={formatQor(sumWei(live.filter((a) => a.status === "awarded").map((a) => a.requested_amount)).toString())} sub="QOR committed to awarded projects" />
          <Stat tint="peach" label="Needs a person" value={String(live.filter((a) => ["submitted", "under_review", "clarification_requested", "recommended"].includes(a.status)).length)} sub="applications to review, clarify or award" />
        </StatRow>
      )}
      {!migrated && admin && <p className="mb-4 text-[13px] text-[var(--warn)]">The database is missing migration 0019 (structured applications and rubrics). Apply supabase/migrations/0019_grants_portal.sql to use the full grants workflow.</p>}

      {admin && (
        <section aria-label="Programme overview" className="mb-6 rounded-lg border border-line bg-surface p-5 shadow-card">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
            <Metric label="Open rounds" value={open.length} sub={`${formatQor(budget.toString())} QOR budgeted in open rounds`} />
            <Metric label="Requested (not rejected)" value={<>{formatQor(requested.toString())} <span className="text-[13px] font-medium text-muted">QOR</span></>} sub={`${live.length} application${live.length === 1 ? "" : "s"} received`} />
            <Metric label="Awarded" value={<>{formatQor(awarded.toString())} <span className="text-[13px] font-medium text-muted">QOR</span></>} sub="recorded awards; payments are separate" />
            <Metric label="Waiting on you" value={awaiting + toAward} tone={awaiting + toAward ? "warn" : undefined} sub={`${awaiting} to review, ${toAward} to award, ${clarifying} awaiting applicants`} />
          </dl>
          {live.length > 0 && <div className="mt-5 border-t border-line pt-5"><Pipeline label="Applications by stage" stages={STAGES} counts={live.reduce<Record<string, number>>((c, a) => ({ ...c, [a.status]: (c[a.status] ?? 0) + 1 }), {})} /></div>}
        </section>
      )}

      {pf && pf.awardedCount > 0 && <div className="mb-6"><PortfolioCard p={pf} alerts={al} /></div>}
      {pf && pf.awardedCount === 0 && al.length > 0 && <div className="mb-6"><PortfolioCard p={pf} alerts={al} /></div>}

      <>
        <div className="min-w-0 space-y-6">
          {applicant && (
            <Card title="Your applications" description="What you need to do next is shown on each one.">
              {myApps.length === 0 ? <p className="text-[13.5px] text-muted">You have not started an application yet. Pick an open round below.</p> : (
                <ul className="divide-y divide-line">
                  {myApps.map((a) => {
                    const g = rounds.find((r) => r.id === a.grant_id);
                    const href = a.status === "draft" || a.amendment_open ? `/grants/${a.grant_id}/apply` : `/grants/applications/${a.id}`;
                    return (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                        <span className="min-w-0"><Link href={href} className="text-[14px] font-medium hover:underline">{a.applicant_name}</Link><span className="block text-[12.5px] text-muted">{g?.title} · {nextAction(a, false, s.user!.id)}</span></span>
                        <span className="flex items-center gap-2"><span className="tabular-nums text-[13.5px] font-semibold">{formatQor(wei(a.requested_amount))} QOR</span><Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{STATUS_TEXT[a.status] ?? a.status}</Badge></span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}

          {rounds.length === 0 ? <EmptyState title="No grant rounds yet" action={admin ? <a href="#create" className={btnCls}>Open the first round</a> : undefined}>{admin ? "A round has a budget, requirements, categories, a deadline and a published rubric." : "No round is open right now. Check back later."}</EmptyState> : (
            <Card title={admin ? "Rounds" : "Grant programmes"} flush>
              <ul className="divide-y divide-line">
                {rounds.filter((g) => admin || isOpen(g) || myApps.some((a) => a.grant_id === g.id)).map((g) => {
                  const ga = live.filter((a) => a.grant_id === g.id);
                  const aw = sumWei(ga.filter((a) => a.status === "awarded").map((a) => a.requested_amount));
                  const b = BigInt(wei(g.budget));
                  const pct = b > 0n ? Number((aw * 1000n) / b) / 10 : 0;
                  return (
                    <li key={g.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="min-w-0"><Link href={`/grants/${g.id}`} className="text-[15px] font-semibold hover:underline">{g.title}</Link>
                          <span className="block text-[12.5px] text-muted">{g.description ? `${g.description.slice(0, 160)}${g.description.length > 160 ? "…" : ""}` : "No description."}</span>
                          <span className="block text-[12px] text-muted">{(g.categories ?? CATS).map((c) => CATEGORY_LABEL[c]).join(" · ")}{g.deadline ? ` · closes ${new Date(g.deadline).toLocaleDateString()}` : ""}</span></span>
                        <Badge tone={isOpen(g) ? "info" : "neutral"}>{isOpen(g) ? "OPEN" : g.status === "open" ? "DEADLINE PASSED" : g.status.toUpperCase()}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]">
                        <span><span className="font-semibold tabular-nums">{formatQor(aw.toString())}</span> <span className="text-muted">of {formatQor(b.toString())} QOR awarded{admin ? ` · ${ga.length} application${ga.length === 1 ? "" : "s"}` : ""}</span></span>
                        <Link href={`/grants/${g.id}`} className="font-medium text-accent-text hover:underline">{admin ? "Review applications" : isOpen(g) ? "Read and apply" : "View"}</Link>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${pct}% of the budget awarded`}><div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>

        <>
          {admin && (
            <Panel id="create" title="Open a grant round" description="Awards can never exceed the budget. A default rubric is attached; edit it before the first evaluation.">
              <form action={createRound} className="space-y-3">
                <div><label htmlFor="g-title" className={labelCls}>Title</label><input id="g-title" name="title" required minLength={3} maxLength={160} className={inputCls} placeholder="Web3 Developer Grants" /></div>
                <div><label htmlFor="g-desc" className={labelCls}>Description</label><textarea id="g-desc" name="description" rows={2} maxLength={4000} className={inputCls} /></div>
                <div><label htmlFor="g-req" className={labelCls}>Requirements (published to applicants)</label><textarea id="g-req" name="requirements" rows={3} maxLength={4000} className={inputCls} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label htmlFor="g-budget" className={labelCls}>Budget (QOR)</label><input id="g-budget" name="budget" required inputMode="decimal" className={inputCls} placeholder="20000" /></div>
                  <div><label htmlFor="g-max" className={labelCls}>Max per application</label><input id="g-max" name="max" inputMode="decimal" className={inputCls} placeholder="optional" /></div>
                </div>
                <div><label htmlFor="g-deadline" className={labelCls}>Deadline (optional)</label><input id="g-deadline" name="deadline" type="date" className={inputCls} /></div>
                <fieldset><legend className={labelCls}>Project categories accepted</legend>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">{CATS.map((c) => <label key={c} className="flex items-center gap-1.5"><input type="checkbox" name={`cat-${c}`} defaultChecked />{CATEGORY_LABEL[c]}</label>)}</div>
                </fieldset>
                <button className={btnCls}>Open round</button>
              </form>
            </Panel>
          )}
          <HowItWorks title="How a grant is decided">
            <Steps compact steps={[
              { label: "Applicant submits", detail: "Structured sections, budget lines and milestones that add up exactly; every version kept.", state: "step" },
              { label: "Agents investigate", detail: "Evidence from GitHub and QoreChain, rubric scores, risks and draft questions. Advisory.", state: "step" },
              { label: "A reviewer recommends", detail: "Or asks for clarification, or rejects, with a recorded reason.", state: "step" },
              { label: "A different administrator awards", detail: "Checked against the round budget in one transaction.", state: "step" },
              { label: "Milestones are reviewed", detail: "Funds move only through the treasury's approval path; pending states are shown as pending.", state: "step" },
            ]} />
            <Source>Awards are records in Verac. A transaction hash is shown only for a payment that QoreChain confirmed.</Source>
          </HowItWorks>
        </>
      </>
    </>
  );
}
