import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team Members" };

export default async function Team() {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Team Members" description="Members and roles." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Team data needs a Supabase project. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/settings/team");
  if (!s.org) redirect("/onboarding");
  const sb = await supabaseServer();
  const { data, error } = await sb!.from("memberships").select("user_id, role, status, created_at").eq("organization_id", s.org.id).order("created_at");
  return (
    <>
      <PageHeader title="Team Members" description={`Members of ${s.org.name}. Visible to internal roles; row-level security hides this list from vendors and applicants.`} />
      {error && <p role="alert" className="mb-4 text-sm text-[var(--bad)]">{error.message}</p>}
      <Card title={`${data?.length ?? 0} member${data?.length === 1 ? "" : "s"}`}>
        <ul className="divide-y divide-line text-sm">
          {(data ?? []).map((m) => (
            <li key={`${m.user_id}-${m.role}`} className="flex items-center justify-between gap-3 py-2.5">
              <span className="font-mono text-xs">{m.user_id === s.user!.id ? `${s.user!.email ?? m.user_id} (you)` : m.user_id}</span>
              <span className="flex items-center gap-2"><Badge tone="neutral">{m.role}</Badge><span className="text-xs text-muted">{m.status}</span></span>
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-4 text-sm text-muted">Inviting people is not built yet: there is no email service configured, so no invite is sent from this page.</p>
    </>
  );
}
