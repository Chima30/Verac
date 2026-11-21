import { redirect } from "next/navigation";
import { Card, Notice, PageHeader, Steps, btnCls, inputCls, labelCls } from "@/components/ui";
import { CopyButton } from "@/components/ui-client";
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

/**
 * Joins the demo organisation (DEMO_ORG_ID) as a read-only auditor, so anyone (a hackathon judge, for example) can sign
 * in with their own email and explore real records. Auditors read what administrators read; the database refuses every
 * change they attempt (migration 0023, tests/security/auditor-read.test.ts). The membership is added by the server, never
 * by the browser, and only ever with the auditor role.
 */
async function joinDemo() {
  "use server";
  const demo = process.env.DEMO_ORG_ID?.trim();
  if (!demo || !/^[0-9a-f-]{36}$/i.test(demo)) redirect("/onboarding?error=" + encodeURIComponent("The demo organisation is not set up on this server."));
  const sb = await supabaseServer();
  if (!sb) redirect("/login");
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/login?next=/onboarding");
  const { serviceClient } = await import("@/lib/live/service");
  const svc = serviceClient();
  const { error } = await svc.from("memberships").upsert({ organization_id: demo, user_id: auth.user.id, role: "auditor", status: "active" }, { onConflict: "organization_id,user_id,role", ignoreDuplicates: true });
  if (error) redirect("/onboarding?error=" + encodeURIComponent(`Could not join the demo: ${error.message}`));
  redirect("/dashboard");
}

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!s.configured || !s.user) redirect("/login");
  if (s.org) redirect("/settings/organization");
  const { error } = await searchParams;
  const demoReady = !!process.env.DEMO_ORG_ID?.trim();
  return (
    <>
      <PageHeader title="Set up Verac" eyebrow="Welcome"
        description="Seven short steps take you from an empty account to your first safe workflow. Start by creating your organisation, or join one that already exists. You can return to any step later from the dashboard." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card title="Your setup">
          <Steps compact steps={[
            { label: "Create or join an organisation", detail: "You are here.", state: "current" },
            { label: "Connect a QoreX wallet", detail: "Optional. Keys never enter this site.", state: "todo" },
            { label: "Understand testnet status", detail: "Everything runs on Diana testnet with valueless QOR.", state: "todo" },
            { label: "Link your treasury", detail: "Point Verac at your TreasuryVault.", state: "todo" },
            { label: "Review default policies", detail: "Caps, approved recipients and approvals.", state: "todo" },
            { label: "Choose permitted agents", detail: "See what each agent may do.", state: "todo" },
            { label: "Try a safe first workflow", detail: "A simulated payment request needs no QOR.", state: "todo" },
          ]} />
        </Card>
        <div className="min-w-0 space-y-6">
          {demoReady && (
            <form action={joinDemo} className="flex flex-col gap-4 rounded-[4px] bg-[var(--band)] p-6 text-white sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="label-mono flex items-center gap-2 text-[var(--accent)]"><span aria-hidden className="inline-block h-[2px] w-3 bg-[var(--accent)]" />Just exploring, or judging?</p>
                <p className="mt-3 max-w-xl text-[20px] font-medium leading-[1.25] tracking-[-0.015em]">Explore the demo organisation, read-only. Real agent runs, grant reports and payments: look at everything, change nothing.</p>
              </div>
              <button className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-[4px] bg-white px-4 py-2 font-mono text-[13px] font-medium uppercase text-black">Explore the demo</button>
            </form>
          )}
          <Card title="Create an organisation" description="An organisation owns treasuries, policies, agents and records. You become its owner. Row-level security keeps every row separate from other organisations.">
            <form action={createOrganisation} className="max-w-md space-y-4">
              <div><label htmlFor="name" className={labelCls}>Organisation name</label>
                <input id="name" name="name" required maxLength={120} className={inputCls} placeholder="Nova DAO" /></div>
              <button className={btnCls} type="submit">Create organisation</button>
              {error && <Notice tone="bad" role="alert">{error}</Notice>}
            </form>
          </Card>
          <Card title="Joining an existing organisation?" description="Send this user ID to the organisation's owner. They add you on their Team page; then reload this site.">
            <div className="flex items-center gap-1 rounded-md bg-surface-2 px-3 py-2"><span className="min-w-0 flex-1 select-all break-all font-mono text-[12.5px]">{s.user.id}</span><CopyButton value={s.user.id} label="Copy user ID" /></div>
            <p className="mt-3 text-[12.5px] text-muted">This is an identifier, not a secret. You will never be asked to paste a private key or seed phrase into Verac.</p>
          </Card>
          <Card title="Words you will see">
            <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
              <div><dt className="font-medium">Testnet</dt><dd className="text-muted">A practice blockchain. QOR here has no value.</dd></div>
              <div><dt className="font-medium">Treasury vault</dt><dd className="text-muted">A smart contract holding funds, with limits agents cannot exceed.</dd></div>
              <div><dt className="font-medium">Escrow</dt><dd className="text-muted">Money set aside for a milestone, released only after review.</dd></div>
              <div><dt className="font-medium">Simulation</dt><dd className="text-muted">Recorded in Verac only. Nothing is sent to the chain.</dd></div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
