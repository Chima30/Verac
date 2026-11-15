import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { AddressLookup } from "@/components/address-lookup";
import { LivePayments } from "@/components/live/live-payments";
import { Badge, Card, EmptyState, Metric, Notice, PageHeader, ShortHash, Source, StatusDot, Steps, btnCls } from "@/components/ui";
import { Hash } from "@/components/ui-client";
import { InteractiveAreaChart } from "@/components/ui/interactive-area-chart";
import { windowed } from "@/lib/dashboard";
import { liveStatusFlags } from "@/lib/live/config";
import { liveOperations } from "@/lib/live/list";
import { evenSteps, formatWei, tokenLabel, vaultSnapshot } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const metadata = { title: "Treasury" };

const EXPLORER = "https://explore.qore.network";
const DAY = 86_400_000;
const qorFmt = (s: string) => { const [w, f] = s.split("."); return `${Number(w).toLocaleString("en-US")}${f ? `.${f}` : ""}`; };
const KIND: Record<string, { word: string; tone: "live" | "info" | "approval" | "failed" | "neutral" | "pending" }> = {
  Deposited: { word: "Deposit", tone: "live" }, PaymentExecuted: { word: "Payment", tone: "info" }, EscrowFunded: { word: "Escrow funded", tone: "info" },
  PaymentApproved: { word: "Approval", tone: "neutral" }, AgentLimitsSet: { word: "Limits set", tone: "neutral" }, AgentRevoked: { word: "Agent revoked", tone: "failed" },
  RecipientSet: { word: "Recipient", tone: "neutral" }, Paused: { word: "Paused", tone: "approval" }, Unpaused: { word: "Resumed", tone: "neutral" },
};

export default async function Treasury() {
  const [v, live] = await Promise.all([vaultSnapshot(), liveOperations()]);
  const flags = liveStatusFlags();
  const canRequest = ["owner", "administrator", "finance_manager"].includes(live.role ?? "");

  if (!v.ok) return (
    <>
      <PageHeader title="Treasury" description="The TreasuryVault on Diana testnet, read live from the chain." badge={<Badge tone="unavailable" />} />
      <EmptyState title="Could not read the chain">{v.error} This page never shows old numbers in place of live ones. Try again in a minute.</EmptyState>
    </>
  );

  const active = v.rules.filter((r) => r.active);
  const room = active.reduce((t, r) => t + r.remainingToday, 0n);
  const hist = v.history; const series: Record<string, ReturnType<typeof evenSteps>> = {};
  const w30 = windowed(hist, 30 * DAY); if (w30.length >= 2) series["30 days"] = evenSteps(w30);
  const w90 = windowed(hist, 90 * DAY); if (w90.length >= 2) series["90 days"] = evenSteps(w90);
  if (hist.length >= 2) series["All time"] = evenSteps(hist);
  const inflow = v.events.filter((e) => e.kind === "Deposited").length;
  const outflow = v.events.filter((e) => e.kind === "PaymentExecuted" || e.kind === "EscrowFunded").length;

  return (
    <>
      <PageHeader title="Treasury" eyebrow="Finance"
        description="The TreasuryVault on Diana testnet, read from the chain on every visit. Agents can only spend inside the limits stored in the contract, and anything above an agent's auto-approve amount needs a person."
        badge={<><Badge tone="live" />{v.paused && <Badge tone="failed">PAUSED</Badge>}</>}
        meta={<><span>Read at block {Number(v.readAtBlock).toLocaleString("en-US")}</span><a href={`${EXPLORER}/address/${v.address}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">Vault on explorer<ExternalLink size={12} aria-hidden /></a></>}
        actions={canRequest ? <Link href="#pay" className={btnCls}>Request a payment</Link> : undefined} />

      {v.paused && <Notice tone="warn" className="mb-6" title="The vault is paused">Every payment is frozen until the owner resumes it. Requests can still be made and approved.</Notice>}

      <section aria-label="Balances" className="mb-6 grid gap-5 rounded-lg border border-line bg-surface p-5 shadow-card lg:grid-cols-[1.1fr_2fr] sm:p-6">
        <div>
          <p className="text-[12.5px] text-muted">Vault balance</p>
          <p className="mt-1 text-[40px] font-semibold leading-none tracking-tight tabular-nums">{qorFmt(formatWei(v.balance!))}<span className="ml-2 text-[18px] font-medium text-muted">QOR</span></p>
          <p className="mt-3 text-[12.5px] text-muted">{inflow} deposit{inflow === 1 ? "" : "s"} in · {outflow} payment{outflow === 1 ? "" : "s"} and escrow fundings out</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-3 lg:border-l lg:border-line lg:pl-6">
          <Metric label="Agents may still spend today" value={<>{qorFmt(formatWei(room))} <span className="text-[13px] font-medium text-muted">QOR</span></>} sub={`across ${active.length} active rule${active.length === 1 ? "" : "s"}`} />
          <Metric label="Human approvals" value={`${v.approvalThreshold} of ${v.approverCount}`} sub="above an agent's auto-approve amount" />
          <Metric label="Status" value={v.paused ? "Paused" : "Active"} tone={v.paused ? "warn" : undefined} sub={v.paused ? "All payments frozen" : "Within each agent's limits"} />
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card id="pay" title="Live payments" description="Request, approve and execute real testnet payments. Every confirmed row links to its transaction." right={<Badge tone="live" />}>
            {live.signedIn ? (
              <LivePayments ops={live.ops} canRequest={canRequest} canDecide={["owner", "administrator"].includes(live.role ?? "")} explorer={EXPLORER} status={live.status} />
            ) : <EmptyState title="Sign in to make a payment" action={<Link href="/login?next=/treasury" className={btnCls}>Sign in</Link>}>Payment requests belong to your organisation. Nothing on this card is simulated.</EmptyState>}
          </Card>

          <Card title="Balance over time" description="Native QOR in the vault." right={<Badge tone="live" />}>
            {Object.keys(series).length ? <InteractiveAreaChart title="Vault balance" unit="QOR" data={series} height={260} /> : <p className="text-[13.5px] text-muted">Not enough events to draw a real line yet.</p>}
            <Source>Rebuilt from the vault&apos;s own deposit, payment and escrow events and anchored to the balance read now. If the events ever fail to explain the balance, the chart is hidden rather than guessed.</Source>
          </Card>

          <Card id="activity" title="Recent vault activity" description="Successful transactions emit events. Refused payments revert and leave none; those are on Live Proof." flush>
            {v.events.length === 0 ? <p className="py-6 text-center text-[13.5px] text-muted">No events found.</p> : (
              <div className="-mx-5 overflow-x-auto">
                <table className="data-table min-w-[40rem] [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5">
                  <thead><tr><th>Event</th><th>Detail</th><th className="num">Block</th><th>Transaction</th></tr></thead>
                  <tbody>{v.events.map((e) => {
                    const k = KIND[e.kind] ?? { word: e.kind, tone: "neutral" as const };
                    return (
                      <tr key={e.tx + e.kind + e.block}>
                        <td className="whitespace-nowrap"><StatusDot tone={k.tone}>{k.word}</StatusDot></td>
                        <td className="text-[13px]">{e.detail}</td>
                        <td className="num font-mono text-[12.5px] text-muted">{Number(e.block).toLocaleString("en-US")}</td>
                        <td className="whitespace-nowrap"><Hash value={e.tx} href={`${EXPLORER}/tx/${e.tx}`} /></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="How a payment moves">
            <Steps compact steps={[
              { label: "Enter recipient and amount", detail: "The recipient must already be approved on the vault.", state: "step" },
              { label: "Policy and limits checked", detail: "The amount is checked against the agent's on-chain caps before the request is saved.", state: "step" },
              { label: "A second person approves", detail: "Bound to the exact amount, recipient and expiry by a hash. You cannot approve your own request.", state: "step" },
              { label: "Confirm the exact details", detail: "The approver re-enters their password for this payment only.", state: "step" },
              { label: "Execute on Diana testnet", detail: flags.emergencyStop ? "Emergency stop is on: execution is refused." : flags.ready ? "PaymentAgent sends it through the authorised pipeline." : "Live execution is not configured here, so this step is unavailable.", state: flags.emergencyStop ? "blocked" : flags.ready ? "step" : "blocked" },
              { label: "Receipt read back from the chain", detail: "Shown as confirmed only after the receipt arrives; otherwise the reason it failed.", state: "step" },
            ]} />
          </Card>

          <Card title="Agent spending rules" description="Enforced by the contract: a payment above them reverts on chain." right={<Badge tone="live" />}>
            {v.eventsError && <Notice tone="bad" className="mb-3">Could not read the rules: {v.eventsError}</Notice>}
            {v.rules.length === 0 && !v.eventsError ? <p className="text-[13.5px] text-muted">No agent has been given limits.</p> : (
              <ul className="-mx-5 divide-y divide-line">
                {v.rules.map((r) => (
                  <li key={r.agent + r.token} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2"><ShortHash value={r.agent} /><Badge tone={r.active ? "live" : "failed"}>{r.active ? "ACTIVE" : "REVOKED"}</Badge></div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                      <dt className="text-muted">Per payment</dt><dd className="text-right tabular-nums">{formatWei(r.perTxCap)} {tokenLabel(r.token)}</dd>
                      <dt className="text-muted">Per day</dt><dd className="text-right tabular-nums">{formatWei(r.dailyCap)}</dd>
                      <dt className="text-muted">No approval up to</dt><dd className="text-right tabular-nums">{formatWei(r.autoApproveCap)}</dd>
                      <dt className="text-muted">Left today</dt><dd className="text-right font-medium tabular-nums">{formatWei(r.remainingToday)}</dd>
                      <dt className="text-muted">Valid until</dt><dd className="text-right tabular-nums">{r.validUntil ? new Date(r.validUntil * 1000).toISOString().slice(0, 10) : "–"}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Emergency controls" description="Who can stop payments, and how.">
            <ul className="space-y-2.5 text-[13px] leading-relaxed">
              <li className="flex items-start justify-between gap-3"><span className="text-muted">Vault pause</span><span className="text-right">{v.paused ? <StatusDot tone="approval">Paused</StatusDot> : <StatusDot tone="live">Not paused</StatusDot>}</span></li>
              <li className="flex items-start justify-between gap-3"><span className="text-muted">Website execution</span><span className="text-right">{flags.emergencyStop ? <StatusDot tone="approval">Emergency stop on</StatusDot> : flags.switchOn ? <StatusDot tone="live">Allowed</StatusDot> : <StatusDot tone="unavailable">Switched off</StatusDot>}</span></li>
            </ul>
            <Source>Pausing the vault or revoking an agent needs the owner&apos;s signing key, which this website does not hold. It is done from the command line; see the Threat Center for the steps.</Source>
          </Card>

          <Card title="Contracts">
            <dl className="space-y-3 text-[13px]">
              <div><dt className="text-[12px] text-muted">TreasuryVault</dt><dd><Hash value={v.address} href={`${EXPLORER}/address/${v.address}`} /></dd></div>
              <div><dt className="text-[12px] text-muted">Owner</dt><dd><Hash value={v.owner!} /></dd></div>
              <div><dt className="text-[12px] text-muted">PolicyManager{v.policyVersion ? ` · policy v${v.policyVersion}` : ""}</dt><dd><Hash value={v.policyManager!} /></dd></div>
            </dl>
            <Source>The owner is a single throwaway testnet key: acceptable here, not for anything real. Not source-verified on an explorer; no external audit.</Source>
          </Card>
        </div>
      </div>

      <details className="group mt-6 rounded-lg border border-line bg-surface shadow-card">
        <summary className="flex items-center justify-between px-5 py-4 text-[14px] font-semibold">Look up any address<span className="text-[12.5px] font-normal text-muted group-open:hidden">Show</span><span className="hidden text-[12.5px] font-normal text-muted group-open:inline">Hide</span></summary>
        <div className="border-t border-line p-5"><AddressLookup focus="balance" /></div>
      </details>
    </>
  );
}
