import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, FlashMessages, Metric, PageHeader, Pipeline, Source, btnCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { formatQor } from "@/lib/approvals";
import { CATEGORY_LABEL, STATUS_TEXT, STATUS_TONE, criteriaFor, sumWei, wei, type AppRow, type RoundRow, type RubricRow } from "@/lib/grants";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { closeGrant, saveRubric } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grant round" };

const ADMIN = ["owner", "administrator"];
const CATS = ["software", "research", "education", "community", "other"];
const STAGES = ["submitted", "under_review", "clarification_requested", "recommended", "awarded", "rejected"].map((k) => ({ key: k, label: STATUS_TEXT[k]!.toLowerCase().replace(/^\w/, (x) => x.toUpperCase()) }));

export default async function Round({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string; status?: string; category?: string; sort?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await getSession();
  if (!s.user) redirect(`/login?next=/grants/${id}`);
  if (!s.org) redirect("/onboarding");
  const sb = (await supabaseServer())!;
  const admin = ADMIN.includes(s.org.role);
  const applicant = s.org.role === "grant_applicant";

  const { data: g, error } = await sb.from("grants").select("id,title,budget,status,description,requirements,categories,deadline,max_request,created_at").eq("id", id).eq("organization_id", s.org.id).maybeSingle();
  if (!g) return <EmptyState title="Round not found">{error?.message ?? "It may belong to another organisation."}</EmptyState>;
  const round = g as unknown as RoundRow;
  const { data: rd } = await sb.from("grant_rubrics").select("id,version,criteria,locked_at,created_at").eq("grant_id", id).order("version", { ascending: false });
  const rubrics = (rd ?? []) as unknown as RubricRow[];
  const rubric = rubrics[0];
  const { data: ad } = await sb.from("grant_applications").select("*").eq("grant_id", id).order("created_at");
  const apps = (ad ?? []) as unknown as AppRow[];
  const mine = apps.find((a) => a.applicant_user_id === s.user!.id);
  const live = apps.filter((a) => a.status !== "draft");

  const budget = BigInt(wei(round.budget));
  const awarded = sumWei(live.filter((a) => a.status === "awarded").map((a) => a.requested_amount));
  const requested = sumWei(live.filter((a) => a.status !== "rejected").map((a) => a.requested_amount));
  const open = round.status === "open" && (!round.deadline || new Date(round.deadline) > new Date());

  // Filters and sort for the table (administrators)
  let rows = live;
  if (sp.status) rows = rows.filter((a) => a.status === sp.status);
  if (sp.category) rows = rows.filter((a) => a.category === sp.category);
  if (sp.sort === "amount") rows = [...rows].sort((x, y) => (BigInt(wei(y.requested_amount)) > BigInt(wei(x.requested_amount)) ? 1 : -1));
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ status: sp.status, category: sp.category, sort: sp.sort, ...patch }).filter(([, v]) => v) as Array<[string, string]>);
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader title={round.title} eyebrow="Grant round"
        description={round.description ?? "No description yet."}
        badge={<Badge tone={open ? "info" : "neutral"}>{open ? "OPEN" : round.status === "open" ? "DEADLINE PASSED" : round.status.toUpperCase()}</Badge>}
        actions={<><Link href="/grants" className={btnSecondaryCls}>All rounds</Link>
          {applicant && open && !mine && <Link href={`/grants/${id}/apply`} className={btnCls}>Start an application</Link>}
          {applicant && mine && <Link href={mine.status === "draft" || mine.amendment_open ? `/grants/${id}/apply` : `/grants/applications/${mine.id}`} className={btnCls}>{mine.status === "draft" ? "Continue your draft" : mine.amendment_open ? "Amend your application" : "Your application"}</Link>}
          {(admin || s.org.role === "security_reviewer") && <Link href={`/grants/${id}/intelligence`} className={btnCls}>Investigate with agents</Link>}</>} />
      <FlashMessages msg={sp.msg} error={sp.error} />

      <section aria-label="Round figures" className="mb-6 rounded-lg border border-line bg-surface p-5 shadow-card">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
          <Metric label="Budget" value={<>{formatQor(budget.toString())} <span className="text-[13px] font-medium text-muted">QOR</span></>} sub={round.max_request ? `max ${formatQor(wei(round.max_request))} QOR each` : "no per-application maximum"} />
          <Metric label="Awarded" value={<>{formatQor(awarded.toString())} <span className="text-[13px] font-medium text-muted">QOR</span></>} sub={`${formatQor((budget - awarded).toString())} QOR left`} />
          <Metric label="Requested (not rejected)" value={<>{formatQor(requested.toString())} <span className="text-[13px] font-medium text-muted">QOR</span></>} tone={requested > budget - awarded ? "warn" : undefined} sub={requested > budget - awarded ? "more than the budget left" : "within the budget left"} />
          <Metric label="Applications" value={live.length} sub={round.deadline ? `deadline ${new Date(round.deadline).toLocaleDateString()}` : "no deadline"} />
        </dl>
        {live.length > 0 && <div className="mt-5 border-t border-line pt-5"><Pipeline label="Applications by stage" stages={STAGES} counts={live.reduce<Record<string, number>>((c, a) => ({ ...c, [a.status]: (c[a.status] ?? 0) + 1 }), {})} /></div>}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          {admin ? (
            <Card title="Applications" description="Drafts are private to applicants and not listed." flush>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 text-[12.5px]">
                <span className="text-muted">Status:</span>
                <Link className={!sp.status ? "font-semibold" : "text-muted hover:underline"} href={qs({ status: undefined })}>All</Link>
                {STAGES.map((st) => <Link key={st.key} className={sp.status === st.key ? "font-semibold" : "text-muted hover:underline"} href={qs({ status: st.key })}>{st.label}</Link>)}
                <span className="ml-3 text-muted">Category:</span>
                <Link className={!sp.category ? "font-semibold" : "text-muted hover:underline"} href={qs({ category: undefined })}>All</Link>
                {(round.categories ?? CATS).map((c) => <Link key={c} className={sp.category === c ? "font-semibold" : "text-muted hover:underline"} href={qs({ category: c })}>{CATEGORY_LABEL[c]}</Link>)}
                <span className="ml-3 text-muted">Sort:</span>
                <Link className={sp.sort !== "amount" ? "font-semibold" : "text-muted hover:underline"} href={qs({ sort: undefined })}>Oldest first</Link>
                <Link className={sp.sort === "amount" ? "font-semibold" : "text-muted hover:underline"} href={qs({ sort: "amount" })}>Largest request</Link>
              </div>
              {rows.length === 0 ? <p className="px-5 py-8 text-center text-[13.5px] text-muted">{live.length ? "No application matches these filters." : "No applications submitted yet."}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[13.5px]">
                    <thead className="text-[12px] text-muted"><tr className="border-b border-line"><th className="px-5 py-2 font-medium">Applicant</th><th className="px-3 py-2 font-medium">Category</th><th className="px-3 py-2 text-right font-medium">Requested</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Version</th><th className="px-5 py-2 font-medium">Submitted</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {rows.map((a) => (
                        <tr key={a.id} className="hover:bg-surface-2/50">
                          <td className="px-5 py-2.5"><Link href={`/grants/applications/${a.id}`} className="font-medium underline decoration-line-strong underline-offset-[3px] hover:decoration-current">{a.applicant_name}</Link></td>
                          <td className="px-3 py-2.5 text-muted">{a.category ? CATEGORY_LABEL[a.category] : "legacy"}</td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatQor(wei(a.requested_amount))} <span className="text-[11.5px] font-medium text-muted">QOR</span></td>
                          <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{STATUS_TEXT[a.status] ?? a.status}</Badge></td>
                          <td className="px-3 py-2.5 tabular-nums text-muted">v{a.version || 1}</td>
                          <td className="px-5 py-2.5 text-muted">{a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : new Date(a.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ) : (
            <Card title="What this round funds">
              {round.requirements ? <p className="whitespace-pre-wrap text-[14px]">{round.requirements}</p> : <p className="text-[13.5px] text-muted">No specific requirements were published.</p>}
              <p className="mt-3 text-[13px] text-muted">Categories: {(round.categories ?? CATS).map((c) => CATEGORY_LABEL[c]).join(", ")}.</p>
            </Card>
          )}
          {admin && round.requirements && <Card title="Programme requirements"><p className="whitespace-pre-wrap text-[14px]">{round.requirements}</p></Card>}
        </div>

        <div className="space-y-6">
          <Card title={`Evaluation rubric${rubric ? ` · version ${rubric.version}` : ""}`} description={rubric?.locked_at ? `Locked by the first evaluation on ${new Date(rubric.locked_at).toLocaleDateString()}. Changes create a new version; earlier reports keep theirs.` : "Editable until the first evaluation."}>
            {!rubric ? <p className="text-[13.5px] text-muted">This round was opened before rubrics existed. An administrator can add one below.</p> : (
              <ul className="space-y-2 text-[13.5px]">
                {rubric.criteria.map((c) => (
                  <li key={c.key} className="flex items-baseline justify-between gap-3">
                    <span><span className="font-medium">{c.label}</span>{c.applies_to?.length ? <span className="text-[12px] text-muted"> · {c.applies_to.map((x) => CATEGORY_LABEL[x]).join(", ")}</span> : null}{c.guidance && <span className="block text-[12.5px] text-muted">{c.guidance}</span>}</span>
                    <span className="shrink-0 tabular-nums text-muted">{c.max} pts</span>
                  </li>
                ))}
                {(round.categories ?? CATS).map((cat) => <li key={cat} className="text-[12px] text-muted">{CATEGORY_LABEL[cat]}: {criteriaFor(rubric.criteria, cat).reduce((t, c) => t + c.max, 0)} points in total</li>)}
              </ul>
            )}
            {admin && (
              <details className="mt-4 border-t border-line pt-4">
                <summary className="cursor-pointer text-[13px] font-medium">Edit the rubric</summary>
                <form action={saveRubric} className="mt-3 space-y-3">
                  <input type="hidden" name="grant" value={id} />
                  <input type="hidden" name="rows" value={12} />
                  {Array.from({ length: Math.min(12, (rubric?.criteria.length ?? 0) + 2) }).map((_, i) => {
                    const c = rubric?.criteria[i];
                    return (
                      <div key={i} className="space-y-1.5 rounded-md border border-line p-2.5">
                        <input type="hidden" name={`key-${i}`} defaultValue={c?.key ?? ""} />
                        <div className="grid grid-cols-[1fr_4.5rem] gap-2">
                          <input aria-label={`Criterion ${i + 1} label`} name={`label-${i}`} className={`${inputCls} text-[13px]`} placeholder={c ? "" : "New criterion (optional)"} defaultValue={c?.label ?? ""} />
                          <input aria-label={`Criterion ${i + 1} maximum points`} name={`max-${i}`} type="number" min={1} max={100} className={`${inputCls} text-[13px]`} defaultValue={c?.max ?? 10} />
                        </div>
                        <input aria-label={`Criterion ${i + 1} guidance`} name={`guidance-${i}`} className={`${inputCls} text-[12.5px]`} placeholder="Guidance for reviewers" defaultValue={c?.guidance ?? ""} />
                        <div className="flex flex-wrap gap-x-3 text-[12px] text-muted">
                          {CATS.map((cat) => <label key={cat} className="flex items-center gap-1"><input type="checkbox" name={`applies-${i}-${cat}`} defaultChecked={!c?.applies_to?.length || c.applies_to.includes(cat)} />{CATEGORY_LABEL[cat]}</label>)}
                        </div>
                      </div>
                    );
                  })}
                  {rubric?.locked_at && <div><label htmlFor="r-reason" className={labelCls}>Reason for the new version</label><input id="r-reason" name="reason" required minLength={5} maxLength={200} className={inputCls} /></div>}
                  <button className={btnCls}>Save rubric</button>
                  <p className="text-[12px] text-muted">Leave a label empty to remove that criterion. Unticking every category is the same as ticking all of them.</p>
                </form>
              </details>
            )}
            {rubrics.length > 1 && <p className="mt-3 text-[12px] text-muted">Earlier versions: {rubrics.slice(1).map((r) => `v${r.version}`).join(", ")}.</p>}
          </Card>
          {admin && round.status === "open" && (
            <Card title="Round controls">
              <form action={closeGrant}><input type="hidden" name="id" value={id} /><button className={btnSecondaryCls}>Close to new applications</button></form>
              <Source>Closing stops new applications. Reviews, clarifications and awards continue.</Source>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
