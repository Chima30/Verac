import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader, btnCls, inputCls } from "@/components/ui";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team Members" };

const ROLES = ["finance_manager", "procurement_manager", "security_reviewer", "administrator", "auditor", "employee"];

async function addMember(formData: FormData) {
  "use server";
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/settings/team");
  const userId = String(formData.get("userId") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "");
  const fail = (m: string): never => redirect("/settings/team?error=" + encodeURIComponent(m));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(userId)) fail("That is not a valid user ID.");
  if (!ROLES.includes(role)) fail("Pick a role from the list.");
  const { error } = await sb!.from("memberships").insert({ organization_id: s.org!.id, user_id: userId, role });
  if (error) fail(error.message);
  redirect("/settings/team?msg=" + encodeURIComponent("Member added."));
}

export default async function Team({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Team Members" description="Members and roles." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Team data needs a Supabase project. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/settings/team");
  if (!s.org) redirect("/onboarding");
  const sb = await supabaseServer();
  const { data, error } = await sb!.from("memberships").select("user_id, role, status, created_at").eq("organization_id", s.org.id).order("created_at");
  return (
    <>
      <PageHeader title="Team Members" description={`Members of ${s.org.name}. Visible to internal roles; row-level security hides this list from vendors and applicants.`} />
      {sp.msg && <p role="status" className="mb-4 text-sm">{sp.msg}</p>}
      {(sp.error) && <p role="alert" className="mb-4 text-sm text-[var(--bad)]">{sp.error}</p>}
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
      <Card title="Add a member" className="mt-4">
        <p className="mb-3 text-sm text-muted">There is no email invite yet. Ask the person to sign up on this site and send you their user ID (shown on this page when they open it). Your own ID is <span className="select-all break-all font-mono text-xs">{s.user.id}</span>. Approvals need at least two finance people, because nobody can approve their own request.</p>
        {s.org.role === "owner" || s.org.role === "administrator" ? (
          <form action={addMember} className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1"><label htmlFor="userId" className="mb-1 block text-xs text-muted">User ID</label><input id="userId" name="userId" required className={inputCls} placeholder="00000000-0000-0000-0000-000000000000" /></div>
            <div><label htmlFor="role" className="mb-1 block text-xs text-muted">Role</label><select id="role" name="role" className={inputCls} defaultValue="finance_manager">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
            <button className={btnCls} type="submit">Add</button>
          </form>
        ) : <p className="text-sm text-muted">Only owners and administrators can add members.</p>}
      </Card>
    </>
  );
}
