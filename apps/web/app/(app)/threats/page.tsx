import { OctagonAlert, ShieldCheck, TriangleAlert, Info } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, ShortHash, Source, StatusDot, Steps } from "@/components/ui";
import { gatherPosture, type Severity } from "@/lib/threats";

export const dynamic = "force-dynamic";
export const metadata = { title: "Threat Center" };

const ORDER: Severity[] = ["high", "medium", "low", "ok"];
const SEV: Record<Severity, { label: string; tone: "failed" | "approval" | "pending" | "live"; ink: string; bg: string; Icon: typeof Info; hint: string }> = {
  high: { label: "High", tone: "failed", ink: "var(--bad)", bg: "var(--bad-bg)", Icon: OctagonAlert, hint: "Act now" },
  medium: { label: "Medium", tone: "approval", ink: "var(--warn)", bg: "var(--warn-bg)", Icon: TriangleAlert, hint: "Should fix" },
  low: { label: "Low", tone: "pending", ink: "var(--muted)", bg: "var(--neutral-bg)", Icon: Info, hint: "Worth knowing" },
  ok: { label: "Passing", tone: "live", ink: "var(--live)", bg: "var(--live-bg)", Icon: ShieldCheck, hint: "Checked and fine" },
};
const yn = (v: boolean | undefined, yes: string, no: string, tone: { yes: "live" | "approval" | "failed" | "pending"; no: "live" | "approval" | "failed" | "pending" }) =>
  v === undefined ? <StatusDot tone="unavailable">unknown</StatusDot> : v ? <StatusDot tone={tone.yes}>{yes}</StatusDot> : <StatusDot tone={tone.no}>{no}</StatusDot>;

export default async function Threats() {
  const p = await gatherPosture();
  if (!p.ok || !p.facts) return (
    <>
      <PageHeader title="Threat Center" description="Post-quantum and key-compromise posture of the vault owner and agent accounts." badge={<Badge tone="unavailable" />} />
      <EmptyState title="Could not read the chain">{p.error} No findings are shown instead of stale ones.</EmptyState>
    </>
  );
  const count = (s: Severity) => p.findings.filter((f) => f.severity === s).length;
  const sorted = [...p.findings].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  const open = sorted.filter((f) => f.severity !== "ok");
  const passing = sorted.filter((f) => f.severity === "ok");
  const total = p.findings.length || 1;

  return (
    <>
      <PageHeader title="Threat Center" eyebrow="Security"
        description="How exposed the vault owner and agent accounts are to a stolen or quantum-broken classical key, and how the vault limits the damage. Every finding is a fixed rule applied to data read live from Diana testnet."
        badge={<Badge tone="live" />} meta={<><span>Read at block {Number(p.readAtBlock).toLocaleString("en-US")}</span><span>{p.facts.accounts.length} accounts checked</span></>} />

      <section aria-label="Summary" className="mb-6 rounded-lg border border-line bg-surface p-5 shadow-card">
        <p className="text-[16px] font-medium leading-relaxed">
          {count("high") ? <><span style={{ color: "var(--bad)" }}>{count("high")} high-severity finding{count("high") === 1 ? "" : "s"}</span> need action now.</>
            : count("medium") ? <>No high-severity findings. <span style={{ color: "var(--warn)" }}>{count("medium")} medium</span> should be fixed.</>
              : "No high or medium findings on the accounts checked."}
        </p>
        <div aria-hidden className="mt-4 flex h-2 overflow-hidden rounded-full bg-surface-3">
          {ORDER.map((s) => count(s) ? <span key={s} style={{ width: `${(count(s) / total) * 100}%`, background: SEV[s].ink }} className="h-full first:rounded-l-full last:rounded-r-full" /> : null)}
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
          {ORDER.map((s) => <div key={s} className="flex items-center gap-2"><dt className="flex items-center gap-1.5 text-muted"><span aria-hidden className="size-2 rounded-full" style={{ background: SEV[s].ink }} />{SEV[s].label}</dt><dd className="font-semibold tabular-nums">{count(s)}</dd></div>)}
        </dl>
      </section>

      <div className="space-y-6">
        <div className="min-w-0 space-y-6">
          <Card title="Open findings" description="Highest severity first. Each names the account it applies to and what the rule saw." flush>
            {open.length === 0 ? <p className="py-6 text-center text-[13.5px] text-muted">Nothing open. Passing checks are listed below.</p> : (
              <ul className="-mx-5 divide-y divide-line">
                {open.map((f, i) => {
                  const s = SEV[f.severity];
                  return (
                    <li key={f.id + i} className="flex gap-3 px-5 py-4">
                      <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md" style={{ background: s.bg, color: s.ink }}><s.Icon size={15} /></span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-medium">{f.title}</span><Badge tone={s.tone}>{s.label.toUpperCase()}</Badge></div>
                        <p className="mt-0.5 text-[12.5px] text-muted">{f.subject}</p>
                        <p className="mt-1.5 text-[13.5px] leading-relaxed">{f.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {passing.length > 0 && (
            <details className="group rounded-lg border border-line bg-surface shadow-card">
              <summary className="flex items-center justify-between px-5 py-4 text-[14px] font-semibold">{passing.length} passing check{passing.length === 1 ? "" : "s"}<span className="text-[12.5px] font-normal text-muted group-open:hidden">Show</span><span className="hidden text-[12.5px] font-normal text-muted group-open:inline">Hide</span></summary>
              <ul className="divide-y divide-line border-t border-line">
                {passing.map((f, i) => <li key={f.id + i} className="px-5 py-3"><p className="text-[13.5px] font-medium">{f.title} <span className="font-normal text-muted">· {f.subject}</span></p><p className="mt-0.5 text-[12.5px] text-muted">{f.detail}</p></li>)}
              </ul>
            </details>
          )}

          <Card title="Accounts checked" flush>
            <div className="-mx-5 overflow-x-auto">
              <table className="data-table min-w-[42rem] [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5">
                <thead><tr><th>Account</th><th>Address</th><th>Post-quantum key</th><th>EVM window</th><th>QoreSeal key</th><th>Contract</th></tr></thead>
                <tbody>{p.facts.accounts.map((a) => (
                  <tr key={a.address}>
                    <td className="font-medium">{a.label}</td>
                    <td><ShortHash value={a.address} /><div><ShortHash value={a.nativeAddress} head={12} tail={4} className="text-[11.5px] text-muted" /></div></td>
                    <td>{yn(a.pqcRegistered, "Registered", "None", { yes: "live", no: "approval" })}</td>
                    <td>{yn(a.windowLive, "Open", "Closed", { yes: "approval", no: "live" })}</td>
                    <td>{yn(a.kemRegistered, "Registered", "None", { yes: "live", no: "pending" })}</td>
                    <td className="text-[13px]">{a.isContract === undefined ? "unknown" : a.isContract ? "Yes" : "No"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card title="If a classical key is stolen" right={<Badge tone="pending">MANUAL, COMMAND LINE</Badge>}>
            <p className="mb-4 text-[13px] leading-relaxed text-muted">A thief with only the classical key cannot sign a native transaction, which also needs the ML-DSA-87 signature, and cannot send EVM transactions while no authorisation window is open. No attack has been staged, so this is not claimed as demonstrated.</p>
            <Steps compact steps={[
              { label: "Close any open EVM window", detail: <>Hybrid-signed native transaction (<span className="font-mono text-[11.5px]">closeEvmWindowMsg</span>).</>, state: "step" },
              { label: "Pause the vault", detail: <>The owner or a guardian calls <span className="font-mono text-[11.5px]">pause()</span>; every payment stops.</>, state: "step" },
              { label: "Revoke each agent's limits", detail: <span className="font-mono text-[11.5px]">revokeAgent</span>, state: "step" },
              { label: "Rotate keys, then resume", detail: "Register a new post-quantum key and move to a new owner.", state: "step" },
            ]} />
            <Source>These need a signing key, which this web app does not hold. They are run with the testnet scripts. Wiring them to buttons would need wallet signing, which is not built.</Source>
          </Card>
          <Card title="See it in practice">
            <p className="text-[13px] leading-relaxed text-muted">The <Link href="/simulator">Quantum Simulator</Link> walks through each attack and links the ones the contracts have actually refused on chain. Every refusal is also in the <Link href="/proof">Live Proof</Link> ledger.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
