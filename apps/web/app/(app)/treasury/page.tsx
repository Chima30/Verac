import { AddressLookup } from "@/components/address-lookup";
import { Badge, Card, EmptyState, KV, PageHeader, Stat } from "@/components/ui";
import { formatWei, tokenLabel, vaultSnapshot } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const metadata = { title: "Treasury" };

export default async function Treasury() {
  const v = await vaultSnapshot();
  return (
    <>
      <PageHeader title="Treasury" description="The TreasuryVault deployed on Diana testnet, read live from the chain on every page load. Nothing here is stored or simulated: if the node cannot be reached, this page says so instead of showing old numbers." badge={v.ok ? <Badge tone="live" /> : <Badge tone="unavailable" />} />
      {!v.ok ? <EmptyState title="Could not read the chain">{v.error}</EmptyState> : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Vault balance" value={`${formatWei(v.balance!)} QOR`} sub={`read at block ${v.readAtBlock}`} />
            <Stat label="Status" value={v.paused ? "PAUSED" : "Active"} sub={v.paused ? "All payments are frozen" : "Payments allowed within each agent's limits"} />
            <Stat label="Human approvals" value={`${v.approvalThreshold} of ${v.approverCount} approver${v.approverCount === 1 ? "" : "s"}`} sub="needed above an agent's auto-approve amount" />
          </div>

          <Card title="Contract">
            <KV rows={[
              ["TreasuryVault", <span key="a" className="break-all font-mono text-xs">{v.address}</span>],
              ["Owner", <span key="o" className="break-all font-mono text-xs">{v.owner}</span>],
              ["PolicyManager", <span key="p" className="break-all font-mono text-xs">{v.policyManager}{v.policyVersion ? ` (active policy version ${v.policyVersion})` : ""}</span>],
            ]} />
            <p className="mt-3 text-xs text-text-2">Testnet only. The owner is a single throwaway testnet key, acceptable here and not for anything real. The contract is not source-verified on an explorer and has had no external audit.</p>
          </Card>

          <Card title="Agent spending rules" right={<Badge tone="live" />}>
            {v.eventsError && <p className="text-sm text-[var(--fail-text)]">Could not read the rules: {v.eventsError}</p>}
            {v.rules.length === 0 && !v.eventsError ? <p className="text-sm text-text-2">No agent has been given limits.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-xs text-text-2"><tr><th className="py-1 pr-3">Agent</th><th className="pr-3">Token</th><th className="pr-3">Per payment</th><th className="pr-3">Per day</th><th className="pr-3">No approval up to</th><th className="pr-3">Left today</th><th>State</th></tr></thead>
                <tbody>{v.rules.map((r) => (
                  <tr key={r.agent + r.token} className="border-t border-line">
                    <td className="py-2 pr-3 font-mono text-xs">{r.agent.slice(0, 10)}…{r.agent.slice(-4)}</td><td className="pr-3">{tokenLabel(r.token)}</td>
                    <td className="pr-3">{formatWei(r.perTxCap)}</td><td className="pr-3">{formatWei(r.dailyCap)}</td><td className="pr-3">{formatWei(r.autoApproveCap)}</td><td className="pr-3">{formatWei(r.remainingToday)}</td>
                    <td>{r.active ? <Badge tone="live">ACTIVE</Badge> : <Badge tone="failed">REVOKED</Badge>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <p className="mt-3 text-xs text-text-2">The contract enforces these limits: a payment above them reverts on chain. The denied attempt is on the Live Proof page.</p>
          </Card>

          <Card title="Recent vault activity">
            {v.events.length === 0 ? <p className="text-sm text-text-2">No events found.</p> : (
              <ul className="divide-y divide-line text-sm">{v.events.map((e) => (
                <li key={e.tx + e.kind + e.block} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span><span className="font-mono text-xs">{e.kind}</span> {e.detail}</span><span className="text-xs text-text-2">block {e.block.toString()}</span></div>
                  <div className="break-all font-mono text-[11px] text-text-2">{e.tx}</div>
                </li>
              ))}</ul>
            )}
            <p className="mt-3 text-xs text-text-2">Only successful transactions emit events. Payments the contract refused revert and leave no event; see Live Proof for those.</p>
          </Card>
          <Card title="Look up any address"><AddressLookup focus="balance" /></Card>
        </div>
      )}
    </>
  );
}
