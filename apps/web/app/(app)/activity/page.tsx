import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, FlashMessages, PageHeader, chipCls } from "@/components/ui";
import { MODULE_LABELS, PAGE_SIZE, actorLabel, describe, moduleLabel, parseFilters, type AuditRow } from "@/lib/activity";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity" };

const SEE_ALL = ["owner", "administrator", "security_reviewer", "auditor"];

function href(f: { module?: string; mine?: boolean; before?: number }) {
  const p = new URLSearchParams();
  if (f.module) p.set("module", f.module);
  if (f.mine) p.set("mine", "1");
  if (f.before) p.set("before", String(f.before));
  const q = p.toString();
  return q ? `/activity?${q}` : "/activity";
}

export default async function Activity({ searchParams }: { searchParams: Promise<{ module?: string; before?: string; mine?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Activity" description="What happened, in order." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">The activity feed reads your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/activity");
  if (!s.org) redirect("/onboarding");
  const f = parseFilters(await searchParams);
  const seeAll = SEE_ALL.includes(s.org.role);
  const mine = f.mine || !seeAll;
  const sb = (await supabaseServer())!;

  let query = sb.from("audit_events").select("id,actor,action,subject,detail,created_at").eq("organization_id", s.org.id).order("id", { ascending: false }).limit(PAGE_SIZE + 1);
  if (f.module) query = query.like("action", `${f.module}.%`);
  if (mine) query = query.eq("actor", s.user.id);
  if (f.before) query = query.lt("id", f.before);
  const { data, error } = await query;
  const all = (data ?? []) as unknown as AuditRow[];
  const rows = all.slice(0, PAGE_SIZE);
  const more = all.length > PAGE_SIZE;

  const chip = chipCls;

  return (
    <>
      <PageHeader title="Activity" eyebrow="Overview" description={seeAll ? "Everything recorded for this organisation, newest first. Owners, administrators, security reviewers and auditors see all members' actions." : "The actions you took, newest first. Only owners, administrators, security reviewers and auditors can see everyone's."} badge={<Badge tone="neutral">RECORDED BY THE APP DATABASE</Badge>} />
      <FlashMessages error={error?.message} />

      <div role="group" aria-label="Filter by module" className="mb-5 flex flex-wrap items-center gap-1.5">
        <Link className={chip(!f.module)} href={href({ mine: f.mine })}>All modules</Link>
        {Object.entries(MODULE_LABELS).map(([k, v]) => <Link key={k} className={chip(f.module === k)} href={href({ module: k, mine: f.mine })}>{v}</Link>)}
        {seeAll && <Link className={`${chip(f.mine)} ml-auto`} href={href({ module: f.module, mine: !f.mine })}>{f.mine ? "Showing only mine" : "Only my actions"}</Link>}
      </div>

      {rows.length === 0 ? <EmptyState title="Nothing here">{f.module || f.before ? "No events match this filter." : "No events have been recorded for you yet. Actions in the other modules show up here."}</EmptyState> : (
        <Card title={`${rows.length} event${rows.length === 1 ? "" : "s"}`} description="Newest first, grouped by day (UTC).">
          {[...new Set(rows.map((e) => e.created_at.slice(0, 10)))].map((day) => (
            <section key={day} className="mb-5 last:mb-0">
              <h3 className="sticky top-14 z-[1] -mx-5 bg-surface/95 px-5 py-1.5 text-[12px] font-medium text-muted backdrop-blur">{new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</h3>
              <ol className="relative mt-2 space-y-3 border-l border-line pl-5">
                {rows.filter((e) => e.created_at.startsWith(day)).map((e) => (
                  <li key={e.id} className="relative">
                    <span aria-hidden className="absolute -left-[24.5px] top-[7px] size-2 rounded-full border-2 border-surface bg-[var(--subtle)]" />
                    <p className="text-[13.5px]"><span className="font-medium">{actorLabel(e.actor, s.user!.id)}</span> {describe(e)}.</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted"><span className="rounded bg-surface-2 px-1.5 py-0.5">{moduleLabel(e.action)}</span><span>{new Date(e.created_at).toISOString().slice(11, 16)} UTC</span></p>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {more && <div className="mt-4 border-t border-line pt-4"><Link className={chip(false)} href={href({ module: f.module, mine: f.mine, before: rows[rows.length - 1]!.id })}>Older events</Link></div>}
        </Card>
      )}
      <p className="mt-4 text-[12.5px] text-muted">The database rejects edits and deletes of these records, but they are not signed or anchored on-chain, so this feed is not tamper-proof against someone with direct database access. Actors are shown by short member id; names are not looked up. For the on-chain record see Live Proof.</p>
    </>
  );
}
