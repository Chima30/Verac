import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, FlashMessages, Metric, PageHeader, Pipeline, Source, Steps, btnCls, inputCls, labelCls } from "@/components/ui";
import { formatQor } from "@/lib/approvals";
import { CATEGORY_LABEL, STATUS_TEXT, STATUS_TONE, nextAction, sumWei, wei, type AppRow, type RoundRow } from "@/lib/grants";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { createRound } from "./actions";
import { loadGrantDemo } from "./sample";

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
  let { data: gd, error } = await sb.from("grants").select("id,title,budget,status,description,requirements,categories,deadline,max_request,created_at").eq("organization_id", s.org.id).order("created_at", { ascending: false });
  const migrated = !error;
  if (error) ({ data: gd, error } = (await sb.from("grants").select("id,title,budget,status,created_at").eq("organization_id", s.org.id).order("created_at", { ascending: false })) as unknown as { data: typeof gd; error: typeof error });
  const rounds = (gd ?? []) as unknown as RoundRow[];
  const { data: ad } = await sb.from("grant_applications").select(migrated ? "id,grant_id,applicant_user_id,applicant_name,requested_amount,status,category,version,submitted_at,amendment_open,recommended_by,created_at" : "id,grant_id,applicant_user_id,applicant_name,requested_amount,status,recommended_by,created_at").eq("organization_id", s.org.id).order("created_at", { ascending: false });
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

  return (
    <>
      <PageHeader title="Grants" eyebrow="Operations"
        description={admin ? "Programmes, applications and evidence-based reviews. Agents investigate and draft; people decide; funds move only through the treasury's approval path." : "Open grant programmes and your applications."}
        badge={<Badge tone="sim" />}
        actions={admin ? <a href="#create" className={btnCls}>Open a round</a> : undefined} />
      <FlashMessages msg={sp.msg} error={sp.error ?? error?.message} />
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
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
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${pct}% of the budget awarded`}><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {admin && (
            <Card id="create" title="Open a grant round" description="Awards can never exceed the budget. A default rubric is attached; edit it before the first evaluation.">
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
            </Card>
          )}
          {admin && (
            <Card title="Sample programme" description="Three fictional applications (Alpha, Beta, Gamma) in a 20,000 QOR round, clearly labelled SAMPLE, to try the review end to end.">
              <form action={loadGrantDemo}><button className={btnCls}>Load the sample programme</button></form>
              <Source>Alpha links Verac's own public repository, so its evidence is real; a link never proves ownership. No GitHub activity or transaction is invented.</Source>
            </Card>
          )}
          <Card title="How a grant is decided">
            <Steps compact steps={[
              { label: "Applicant submits", detail: "Structured sections, budget lines and milestones that add up exactly; every version kept.", state: "step" },
              { label: "Agents investigate", detail: "Evidence from GitHub and QoreChain, rubric scores, risks and draft questions. Advisory.", state: "step" },
              { label: "A reviewer recommends", detail: "Or asks for clarification, or rejects, with a recorded reason.", state: "step" },
              { label: "A different administrator awards", detail: "Checked against the round budget in one transaction.", state: "step" },
              { label: "Milestones are reviewed", detail: "Funds move only through the treasury's approval path; pending states are shown as pending.", state: "step" },
            ]} />
            <Source>Awards are records in Verac. A transaction hash is shown only for a payment that QoreChain confirmed.</Source>
          </Card>
        </div>
      </div>
    </>
  );
}
