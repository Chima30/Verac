import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { DcaCalc, RebalanceCalc } from "@/components/strategies/calculators";
import { SavedList } from "@/components/strategies/saved-list";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "DCA and Rebalancing" };

export default async function Strategies({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="DCA and Rebalancing" description="Scheduled buys and portfolio rebalancing, as simulations." badge={<Badge tone="sim" />} /><EmptyState title="Supabase is not connected">Saved strategies live in your database. The calculators below still work without it.</EmptyState><div className="mt-4 grid gap-4 lg:grid-cols-2"><Card title="DCA simulator"><DcaCalc canSave={false} /></Card><Card title="Rebalancing calculator"><RebalanceCalc canSave={false} /></Card></div></>);
  if (!s.user) redirect("/login?next=/strategies");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = (await supabaseServer())!;
  const canSave = ["owner", "administrator", "finance_manager"].includes(s.org.role);
  const { data } = await sb.from("strategies").select("id,kind,config,mode,status,created_at").eq("organization_id", s.org.id).in("kind", ["dca", "rebalance"]).order("created_at", { ascending: false });

  return (
    <>
      <PageHeader title="DCA and Rebalancing" description="Work out what a dollar-cost-averaging plan or a rebalance would do on numbers you type in. There is no market venue connected, so these are always simulations: nothing is bought, sold or scheduled." badge={<Badge tone="sim" />} />
      {sp.msg && <p role="status" className="mb-4 rounded-md border border-line bg-surface px-3 py-2 text-sm">{sp.msg}</p>}
      {sp.error && <p role="alert" className="mb-4 text-sm text-[var(--bad)]">{sp.error}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="DCA simulator"><DcaCalc canSave={canSave} /></Card>
        <Card title="Rebalancing calculator"><RebalanceCalc canSave={canSave} /></Card>
      </div>
      <h2 className="mb-2 mt-6 text-sm font-medium">Saved inputs</h2>
      <SavedList rows={(data ?? []) as never} canCancel={canSave} back="/strategies" />
    </>
  );
}
