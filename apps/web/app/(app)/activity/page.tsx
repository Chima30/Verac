import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader, chipCls } from "@/components/ui";
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
      <PageHeader title="Activity" description={seeAll ? "Everything recorded for this organisation, newest first. Owners, administrators, security reviewers and auditors see all members' actions." : "The actions you took, newest first. Only owners, administrators, security reviewers and auditors can see everyone's."} badge={<Badge tone="neutral">RECORDED BY THE APP DATABASE</Badge>} />
      {error && <p role="alert" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-bg)] px-4 py-3 text-[13.5px] text-[var(--bad)]">{error.message}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link className={chip(!f.module)} href={href({ mine: f.mine })}>All modules</Link>
        {Object.entries(MODULE_LABELS).map(([k, v]) => <Link key={k} className={chip(f.module === k)} href={href({ module: k, mine: f.mine })}>{v}</Link>)}
        {seeAll && <Link className={`${chip(f.mine)} ml-auto`} href={href({ module: f.module, mine: !f.mine })}>{f.mine ? "Showing only mine" : "Only my actions"}</Link>}
      </div>

      {rows.length === 0 ? <EmptyState title="Nothing here">{f.module || f.before ? "No events match this filter." : "No events have been recorded for you yet. Actions in the other modules show up here."}</EmptyState> : (
        <Card title={`${rows.length} event${rows.length === 1 ? "" : "s"}`}>
          <ul className="divide-y divide-line text-[13.5px]">{rows.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
              <span><strong>{actorLabel(e.actor, s.user!.id)}</strong> {describe(e)}.</span>
              <span className="text-[12.5px] text-muted"><Badge tone="neutral">{moduleLabel(e.action)}</Badge> {new Date(e.created_at).toUTCString()}</span>
            </li>
          ))}</ul>
          {more && <div className="mt-3"><Link className={chip(false)} href={href({ module: f.module, mine: f.mine, before: rows[rows.length - 1]!.id })}>Older events</Link></div>}
        </Card>
      )}
      <p className="mt-4 text-[12.5px] text-muted">The database rejects edits and deletes of these records, but they are not signed or anchored on-chain, so this feed is not tamper-proof against someone with direct database access. Actors are shown by short member id; names are not looked up. For the on-chain record see Live Proof.</p>
    </>
  );
}
