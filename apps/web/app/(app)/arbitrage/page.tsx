import { redirect } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ArbitrageCalc } from "@/components/strategies/calculators";
import { SavedList } from "@/components/strategies/saved-list";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Arbitrage Lab" };

export default async function Arbitrage({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const s = await getSession();
  const head = <PageHeader title="Arbitrage Lab" description="Check whether a price gap between two venues would still make money after fees, slippage and network cost. Simulation only: prices are typed in, no quotes are collected and nothing is traded." badge={<Badge tone="sim" />} />;
  if (!s.configured) return (<>{head}<Card title="Net profit calculator"><ArbitrageCalc canSave={false} /></Card></>);
  if (!s.user) redirect("/login?next=/arbitrage");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = (await supabaseServer())!;
  const canSave = ["owner", "administrator", "finance_manager"].includes(s.org.role);
  const { data } = await sb.from("strategies").select("id,kind,config,mode,status,created_at").eq("organization_id", s.org.id).eq("kind", "arbitrage").order("created_at", { ascending: false });
  return (
    <>
      {head}
      {sp.msg && <p role="status" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--live)_25%,transparent)] bg-[var(--live-bg)] px-4 py-3 text-[13.5px]">{sp.msg}</p>}
      {sp.error && <p role="alert" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-bg)] px-4 py-3 text-[13.5px] text-[var(--bad)]">{sp.error}</p>}
      <Card title="Net profit calculator"><ArbitrageCalc canSave={canSave} /></Card>
      <h2 className="mb-2 mt-6 text-[13.5px] font-medium">Saved inputs</h2>
      <SavedList rows={(data ?? []) as never} canCancel={canSave} back="/arbitrage" />
    </>
  );
}
