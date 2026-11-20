import { redirect } from "next/navigation";
import { Badge, Card, FlashMessages, HowItWorks, Notice, PageHeader, SectionHeading } from "@/components/ui";
import { DcaCalc, RebalanceCalc } from "@/components/strategies/calculators";
import { SavedList } from "@/components/strategies/saved-list";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "DCA and Rebalancing" };

const HEADER = (
  <PageHeader title="DCA & Rebalancing" eyebrow="Finance"
    description="Work out what a dollar-cost-averaging plan or a rebalance would do on numbers you type in. No market venue is connected, so these are always simulations: nothing is bought, sold or scheduled."
    badge={<Badge tone="sim" />} />
);
const CONSTRAINTS = (
  <HowItWorks title="Risk constraints that apply">
    <ul className="space-y-2 text-[13px] leading-relaxed text-muted">
      <li>StrategyAgent can only propose payments; a person approves each one.</li>
      <li>Any real spending would still be capped by the vault&apos;s on-chain per-payment and daily limits.</li>
      <li>Saved inputs are stored as paused simulations and never run on a schedule.</li>
    </ul>
  </HowItWorks>
);

export default async function Strategies({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (
    <>
      {HEADER}
      <Notice tone="neutral" className="mb-6">Saved strategies need the organisation database, which is not connected here. The calculators still work.</Notice>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2"><Card title="DCA simulator"><DcaCalc canSave={false} /></Card><Card title="Rebalancing calculator"><RebalanceCalc canSave={false} /></Card></div>
    </>
  );
  if (!s.user) redirect("/login?next=/strategies");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = (await supabaseServer())!;
  const canSave = ["owner", "administrator", "finance_manager"].includes(s.org.role);
  const { data } = await sb.from("strategies").select("id,kind,config,mode,status,created_at").eq("organization_id", s.org.id).in("kind", ["dca", "rebalance"]).order("created_at", { ascending: false });

  return (
    <>
      {HEADER}
      <FlashMessages msg={sp.msg} error={sp.error} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="DCA simulator" description="Spread one budget over several buys."><DcaCalc canSave={canSave} /></Card>
        <Card title="Rebalancing calculator" description="Bring holdings back to target shares."><RebalanceCalc canSave={canSave} /></Card>
      </div>
      <div className="mt-10">
        <div className="min-w-0"><SectionHeading title="Saved inputs" description="Stored numbers only. Every entry is a paused simulation." /><SavedList rows={(data ?? []) as never} canCancel={canSave} back="/strategies" /></div>
        {CONSTRAINTS}
      </div>
    </>
  );
}
