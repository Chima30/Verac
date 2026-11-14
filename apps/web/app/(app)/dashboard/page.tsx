import { AGENTS } from "@qoreops/agent-coordinator";
import { Badge, Card, KV, PageHeader, Stat } from "@/components/ui";
import { aiStatus, chainSnapshot, contractSnapshot } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const [chain, ai, contracts] = [await chainSnapshot(), aiStatus(), await contractSnapshot()];
  const agents = Object.values(AGENTS);
  return (
    <>
      <PageHeader title="Dashboard" description="Status of QoreChain Diana testnet and the AI provider, read fresh each time you open this page." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2"><Stat large label="Latest EVM block, Diana testnet" value={chain.block ?? "n/a"} badge={chain.block ? <Badge tone="live" /> : <Badge tone="unavailable" />} sub={chain.ok ? `Chain id ${chain.chainId}. Mainnet is disabled.` : chain.error} /></div>
        <Stat label="QoreChain Diana" value={chain.ok ? "Connected" : "Unreachable"} badge={<Badge tone={chain.ok ? "live" : "unavailable"} />} sub={chain.ok ? "Reads succeed" : "Reads are failing"} />
        <Stat label="Gemini" value={ai.status === "configured" ? <span className="type-heading">{ai.model}</span> : ai.status === "unconfigured" ? "No API key" : "Invalid config"} badge={<Badge tone={ai.status === "configured" ? "live" : "unavailable"}>{ai.status === "configured" ? "CONFIGURED" : "UNAVAILABLE"}</Badge>} sub={ai.status === "configured" ? "Free tier only" : ai.message} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Network"><KV rows={[["Native chain", "qorechain-diana"], ["EVM chain id", "9800"], ["Mainnet", "disabled (refused at startup)"],
          ["Abstract accounts", chain.aa ? (chain.aa.enabled ? `enabled, max ${chain.aa.maxSessionKeys} session keys, ${chain.aa.maxSpendingRules} rules` : "disabled") : "unknown"],
          ["Agents defined", `${agents.length}, of which ${agents.filter((a) => a.canMoveFunds).length} can move funds, via the pipeline only`]]} /></Card>
        <Card title="Not wired yet" right={<Badge tone="pending" />}>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            <li>This app does not send transactions. Payments, escrow funding and releases are recorded here as approvals. The testnet ones so far were run from scripts (see docs/LIVE_RUN_2026-11-14.md).</li>
            <li>{ai.status === "configured" ? "AI calls use the free tier only and never change a decision made by the fixed rules." : "AI features are off until a Gemini key is configured on this server."}</li>
            <li>Document checksums are stored but not anchored on-chain.</li>
          </ul>
        </Card>
      </div>
      <Card title="Deployed contracts (Diana testnet)" className="mt-4" right={<Badge tone={contracts.error ? "unavailable" : "live"} />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead><tr className="border-b border-line text-xs text-text-2"><th className="py-2 pr-3 font-medium">Contract</th><th className="py-2 pr-3 font-medium">Address</th><th className="py-2 pr-3 font-medium">Code on-chain</th><th className="py-2 font-medium">Balance (QOR)</th></tr></thead>
            <tbody>{contracts.rows.map((c) => (
              <tr key={c.name} className="border-b border-line last:border-0">
                <td className="py-2 pr-3">{c.name}</td><td className="py-2 pr-3 font-mono text-xs break-all">{c.address}</td>
                <td className="py-2 pr-3">{c.hasCode === null ? "unknown" : c.hasCode ? "yes" : "NO"}</td><td className="py-2 font-mono">{c.balanceQor ?? "n/a"}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-text-2">Not source-verified on an explorer; no external audit.</p>
      </Card>
    </>
  );
}
