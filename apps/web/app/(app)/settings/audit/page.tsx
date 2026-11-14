import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit History" };

export default async function Audit() {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Audit History" description="Append-only record of operations." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">The audit log lives in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/settings/audit");
  if (!s.org) redirect("/onboarding");
  const sb = await supabaseServer();
  const { data, error } = await sb!.from("audit_events").select("id, actor, action, subject, created_at").eq("organization_id", s.org.id).order("created_at", { ascending: false }).limit(100);
  return (
    <>
      <PageHeader title="Audit History" description="Append-only: the database rejects updates and deletes. Only owners, administrators, security reviewers and auditors can read it." />
      {error && <p role="alert" className="mb-4 text-sm text-[var(--fail-text)]">{error.message}</p>}
      {!data || data.length === 0 ? (
        <EmptyState title="No audit events yet">Users cannot write audit events directly. The database functions behind each module write them, so this list fills as people use Approvals, Procurement, Payroll and the other modules. See the readable <a className="underline" href="/activity">Activity feed</a>. For the on-chain record see Live Proof.</EmptyState>
      ) : (
        <Card title={`Latest ${data.length}`}>
          <ul className="divide-y divide-line text-sm">{data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><span className="font-mono text-xs">{e.action}</span> {e.subject ?? ""}</span><span className="text-xs text-text-2">{e.actor} · {new Date(e.created_at).toISOString()}</span></li>
          ))}</ul>
        </Card>
      )}
    </>
  );
}
