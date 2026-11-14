import { redirect } from "next/navigation";
import { Card, PageHeader, btnCls, inputCls } from "@/components/ui";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create organisation" };

async function createOrganisation(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 120) redirect("/onboarding?error=" + encodeURIComponent("Name must be 1 to 120 characters."));
  const sb = await supabaseServer();
  if (!sb) redirect("/login");
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/login");

  // The creator is not a member until the membership row exists, so row-level security would hide a read-back.
  // Generate the id here and insert both rows without selecting.
  const id = crypto.randomUUID();
  const org = await sb.from("organizations").insert({ id, name, created_by: auth.user.id });
  if (org.error) redirect("/onboarding?error=" + encodeURIComponent(org.error.message));
  const mem = await sb.from("memberships").insert({ organization_id: id, user_id: auth.user.id, role: "owner" });
  if (mem.error) redirect("/onboarding?error=" + encodeURIComponent(`Organisation created but membership failed: ${mem.error.message}`));
  redirect("/settings/organization");
}

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!s.configured || !s.user) redirect("/login");
  if (s.org) redirect("/settings/organization");
  const { error } = await searchParams;
  return (
    <>
      <PageHeader title="Create your organisation" description="An organisation is the tenant that owns treasuries, policies, agents and records. You become its owner. Every row is isolated from other organisations by row-level security." />
      <Card title="Joining an existing organisation?" className="mb-4">
        <p className="text-sm text-muted">Send this user ID to the organisation owner so they can add you on their Team page. Then reload this site.</p>
        <p className="mt-2 select-all break-all font-mono text-xs">{s.user.id}</p>
      </Card>
      <Card title="Organisation">
        <form action={createOrganisation} className="max-w-md space-y-3">
          <div><label htmlFor="name" className="mb-1 block text-xs text-muted">Name</label>
            <input id="name" name="name" required maxLength={120} className={inputCls} placeholder="Nova DAO" /></div>
          <button className={btnCls} type="submit">Create organisation</button>
          {error && <p role="alert" className="text-sm text-[var(--bad)]">{error}</p>}
        </form>
      </Card>
    </>
  );
}
