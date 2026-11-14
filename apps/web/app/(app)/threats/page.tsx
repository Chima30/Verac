import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { gatherPosture, type Severity } from "@/lib/threats";

export const dynamic = "force-dynamic";
export const metadata = { title: "Threat Center" };

const TONE: Record<Severity, "failed" | "approval" | "pending" | "live"> = { high: "failed", medium: "approval", low: "pending", ok: "live" };
const LABEL: Record<Severity, string> = { high: "HIGH", medium: "MEDIUM", low: "LOW", ok: "OK" };
const yn = (v: boolean | undefined, yes = "Yes", no = "No") => (v === undefined ? "unknown" : v ? yes : no);

export default async function Threats() {
  const p = await gatherPosture();
  const count = (s: Severity) => p.findings.filter((f) => f.severity === s).length;
  return (
    <>
      <PageHeader title="Threat Center" description="How exposed the vault owner and the agent accounts are to a stolen or quantum-broken classical key, and how the vault is set up to limit damage. Every finding is a fixed rule applied to data read live from Diana testnet, on every page load." badge={p.ok ? <Badge tone="live" /> : <Badge tone="unavailable" />} />
      {!p.ok || !p.facts ? <EmptyState title="Could not read the chain">{p.error}</EmptyState> : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="High" value={count("high")} sub="act now" />
            <Stat label="Medium" value={count("medium")} sub="should fix" />
            <Stat label="Low" value={count("low")} sub="worth knowing" />
            <Stat label="Passing" value={count("ok")} sub={`read at block ${p.readAtBlock}`} />
          </div>

          <Card title="Findings">
            <ul className="divide-y divide-line text-sm">{p.findings.map((f, i) => (
              <li key={f.id + i} className="py-3">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={TONE[f.severity]}>{LABEL[f.severity]}</Badge><span className="font-medium">{f.title}</span><span className="text-xs text-text-2">· {f.subject}</span></div>
                <p className="mt-1 text-text-2">{f.detail}</p>
              </li>
            ))}</ul>
          </Card>

          <Card title="Accounts checked">
            <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead className="text-xs text-text-2"><tr><th className="py-1 pr-3">Account</th><th className="pr-3">Address</th><th className="pr-3">Post-quantum key</th><th className="pr-3">EVM window</th><th className="pr-3">QoreSeal key</th><th>Contract?</th></tr></thead>
              <tbody>{p.facts.accounts.map((a) => (
                <tr key={a.address} className="border-t border-line align-top">
                  <td className="py-2 pr-3">{a.label}</td>
                  <td className="pr-3"><div className="font-mono text-xs">{a.address.slice(0, 10)}…{a.address.slice(-4)}</div><div className="font-mono text-[11px] text-text-2">{a.nativeAddress.slice(0, 12)}…</div></td>
                  <td className="pr-3">{yn(a.pqcRegistered, "Registered", "None")}</td><td className="pr-3">{yn(a.windowLive, "OPEN", "Closed")}</td><td className="pr-3">{yn(a.kemRegistered, "Registered", "None")}</td><td>{yn(a.isContract)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Card>

          <Card title="If a classical key is stolen" right={<Badge tone="pending">MANUAL STEPS, NOT WIRED TO THIS APP</Badge>}>
            <p className="mb-3 text-sm text-text-2">What the chain&apos;s rules mean for this setup (from the chain documentation; this app has not staged an attack, so none is claimed as demonstrated): a thief with only the classical key cannot sign a native transaction, because those also need the ML-DSA-87 signature, and cannot send EVM transactions while no authorisation window is open, because opening one needs a hybrid-signed message.</p>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>Close any open EVM window with a hybrid-signed native transaction (the SDK&apos;s <span className="font-mono text-xs">closeEvmWindowMsg</span>).</li>
              <li>Pause the vault: the owner or a guardian can call <span className="font-mono text-xs">pause()</span> and every payment stops.</li>
              <li>Revoke each agent&apos;s limits with <span className="font-mono text-xs">revokeAgent</span>.</li>
              <li>Rotate: register a new post-quantum key and move to a new owner, then resume.</li>
            </ol>
            <p className="mt-3 text-xs text-text-2">These need a signing key, which this web app does not hold. They are run from the command line with the testnet scripts. Wiring them to buttons would require wallet signing and is not built.</p>
          </Card>
        </div>
      )}
    </>
  );
}
