import { redirect } from "next/navigation";
import { Badge, Card, KV, PageHeader, btnCls } from "@/components/ui";
import deployment from "../../../../../../deployments/diana-testnet.json";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organisation" };

async function linkContracts() {
  "use server";
  const sb = await supabaseServer();
  if (!sb) redirect("/login");
  const s = await getSession();
  if (!s.user || !s.org) redirect("/onboarding");
  const contracts = Object.fromEntries(Object.entries(deployment.contracts).map(([k, v]) => [k, v.address]));
  const { data, error } = await sb.from("organizations")
    .update({ treasury_address: deployment.contracts.TreasuryVault.address, contracts })
    .eq("id", s.org.id).select("id");
  if (error) redirect("/settings/organization?error=" + encodeURIComponent(error.message));
  if (!data || data.length === 0) redirect("/settings/organization?error=" + encodeURIComponent("Not permitted: only owners and administrators can change this."));
  redirect("/settings/organization?linked=1");
}

export default async function OrganisationPage({ searchParams }: { searchParams: Promise<{ error?: string; linked?: string }> }) {
  const s = await getSession();
  if (!s.configured) {
    return (<><PageHeader title="Organisation" description="Organisation profile." badge={<Badge tone="unavailable" />} />
      <Card><p className="text-sm text-text-2">No Supabase project is connected to this deployment, so organisations are unavailable. Setup steps are in docs/SUPABASE_SETUP.md.</p></Card></>);
  }
  if (!s.user) redirect("/login?next=/settings/organization");
  if (!s.org) redirect("/onboarding");
  const { error, linked } = await searchParams;
  const o = s.org;
  const isLinked = Boolean(o.treasuryAddress);
  return (
    <>
      <PageHeader title="Organisation" description="Your tenant. Data below is read from your Supabase project as you, so row-level security decides what you can see." />
      {s.error && <p role="alert" className="mb-4 text-sm text-[var(--fail-text)]">{s.error}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profile"><KV rows={[["Name", o.name], ["Your role", o.role], ["Signed in as", s.user.email ?? s.user.id], ["Organisation id", o.id]]} /></Card>
        <Card title="Treasury contracts" right={<Badge tone={isLinked ? "live" : "pending"}>{isLinked ? "LINKED" : "NOT LINKED"}</Badge>}>
          {isLinked ? (
            <KV rows={[...(Object.values(o.contracts).includes(o.treasuryAddress ?? "") ? [] : [["Treasury vault", o.treasuryAddress ?? ""] as [string, string]]), ...Object.entries(o.contracts).map(([k, v]): [string, string] => [k, String(v)])]} />
          ) : (
            <form action={linkContracts} className="space-y-3">
              <p className="text-sm text-text-2">Record the contracts deployed to Diana testnet on 2026-11-14 (see Live Proof) as this organisation&apos;s treasury. This only saves addresses to your database; it moves no funds.</p>
              <button className={btnCls} type="submit">Link deployed testnet contracts</button>
            </form>
          )}
          {linked && <p role="status" className="mt-3 text-sm text-[var(--ok-text)]">Saved.</p>}
          {error && <p role="alert" className="mt-3 text-sm text-[var(--fail-text)]">{error}</p>}
        </Card>
      </div>
    </>
  );
}
