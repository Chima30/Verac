import { redirect } from "next/navigation";
import { Badge, Card, FlashMessages, PageHeader, SectionHeading } from "@/components/ui";
import { ArbitrageCalc } from "@/components/strategies/calculators";
import { SavedList } from "@/components/strategies/saved-list";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Arbitrage Lab" };

const ABOUT = (
  <Card title="Reading the result">
    <ul className="space-y-2 text-[13px] leading-relaxed text-muted">
      <li><span className="font-medium text-ink">Gross spread</span> is the sell price minus the buy price, times the size.</li>
      <li><span className="font-medium text-ink">Fees and slippage</span> are in basis points (1 bps = 0.01%) on each side.</li>
      <li><span className="font-medium text-ink">Fixed cost</span> covers network fees and transfers between venues.</li>
      <li>A gap that survives these costs on paper can still close before both trades land.</li>
    </ul>
  </Card>
);

export default async function Arbitrage({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const s = await getSession();
  const head = <PageHeader title="Arbitrage Lab" eyebrow="Finance" description="Check whether a price gap between two venues would still make money after fees, slippage and network cost. Simulation only: prices are typed in, no quotes are collected and nothing is traded." badge={<Badge tone="sim" />} />;
  if (!s.configured) return (<>{head}<div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]"><Card title="Net profit calculator"><ArbitrageCalc canSave={false} /></Card>{ABOUT}</div></>);
  if (!s.user) redirect("/login?next=/arbitrage");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = (await supabaseServer())!;
  const canSave = ["owner", "administrator", "finance_manager"].includes(s.org.role);
  const { data } = await sb.from("strategies").select("id,kind,config,mode,status,created_at").eq("organization_id", s.org.id).eq("kind", "arbitrage").order("created_at", { ascending: false });
  return (
    <>
      {head}
      <FlashMessages msg={sp.msg} error={sp.error} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title="Net profit calculator" description="Costs are subtracted in order, so you can see what eats the spread."><ArbitrageCalc canSave={canSave} /></Card>
        {ABOUT}
      </div>
      <SectionHeading title="Saved inputs" description="Stored numbers only. Every entry is a paused simulation." />
      <SavedList rows={(data ?? []) as never} canCancel={canSave} back="/arbitrage" />
    </>
  );
}
