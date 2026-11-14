import { AGENTS } from "@qoreops/agent-coordinator";
import { Badge, Card, KV, PageHeader, Stat } from "@/components/ui";
import { aiStatus, chainSnapshot } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const [chain, ai] = [await chainSnapshot(), aiStatus()];
  const agents = Object.values(AGENTS);
  return (
    <>
      <PageHeader title="Dashboard" description="Live connection status for QoreChain Diana testnet and the AI provider. Organisation data appears once a Supabase project and sign-in are configured." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="QoreChain Diana" value={chain.ok ? "Connected" : "Unreachable"} badge={<Badge tone={chain.ok ? "live" : "unavailable"} />} sub={chain.ok ? `EVM chain id ${chain.chainId}` : chain.error} />
        <Stat label="Latest EVM block" value={chain.block ?? "n/a"} badge={chain.block ? <Badge tone="live" /> : undefined} />
        <Stat label="Gemini" value={ai.status === "configured" ? ai.model : ai.status === "unconfigured" ? "No API key" : "Invalid config"} badge={<Badge tone={ai.status === "configured" ? "live" : "unavailable"}>{ai.status === "configured" ? "CONFIGURED" : "UNAVAILABLE"}</Badge>} sub={ai.status === "configured" ? "Free tier only" : ai.message} />
        <Stat label="Agents defined" value={agents.length} sub={`${agents.filter((a) => a.canMoveFunds).length} can move funds, via the pipeline only`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Network"><KV rows={[["Native chain", "qorechain-diana"], ["EVM chain id", "9800"], ["Mainnet", "disabled (refused at startup)"],
          ["Abstract accounts", chain.aa ? (chain.aa.enabled ? `enabled, max ${chain.aa.maxSessionKeys} session keys, ${chain.aa.maxSpendingRules} rules` : "disabled") : "unknown"]]} /></Card>
        <Card title="What is not connected yet" right={<Badge tone="pending" />}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>Supabase project and sign-in: organisation, treasury and task data is not shown.</li>
            <li>Treasury contracts are not deployed, so there are no vault balances or transactions to display.</li>
            <li>No testnet transaction has been sent from this app.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
