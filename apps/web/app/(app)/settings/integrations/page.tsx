import Link from "next/link";
import { Badge, Card, KV, PageHeader, StatusDot } from "@/components/ui";
import { liveStatusFlags } from "@/lib/live/config";
import { aiStatus, chainSnapshot, contractSnapshot } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations" };

/** Real check, not a label: the project answers its auth health endpoint using only the public anon key. */
async function supabaseStatus(): Promise<{ configured: boolean; reachable: boolean; detail: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(), anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) return { configured: false, reachable: false, detail: "URL or anon key not set" };
  try {
    const r = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/health`, { headers: { apikey: anon }, signal: AbortSignal.timeout(6000), cache: "no-store" });
    return { configured: true, reachable: r.ok, detail: r.ok ? "Auth service answered" : `Auth service returned HTTP ${r.status}` };
  } catch (e) { return { configured: true, reachable: false, detail: e instanceof Error ? e.message : "unreachable" }; }
}

const present = (v: string | undefined) => (v && v.trim() ? "set" : "not set");

export default async function Integrations() {
  const ai = aiStatus();
  const [chain, contracts, sb] = await Promise.all([chainSnapshot(), contractSnapshot(), supabaseStatus()]);
  const flags = liveStatusFlags();
  const live = contracts.rows.length > 0 && contracts.rows.every((r) => r.hasCode === true);
  const env = process.env;
  return (
    <>
      <PageHeader title="Integrations" eyebrow="Settings" description="What Verac is connected to on this server, checked when the page loads. Secret values are never displayed, only whether they are set." />
      <section aria-label="Summary" className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-card md:grid-cols-5">
        {[
          ["Gemini", ai.status === "configured" ? <StatusDot key="g" tone="live">Configured</StatusDot> : <StatusDot key="g" tone="unavailable">Not configured</StatusDot>],
          ["QoreChain Diana", chain.ok ? <StatusDot key="c" tone="live">Reachable</StatusDot> : <StatusDot key="c" tone="failed">Unreachable</StatusDot>],
          ["Supabase", sb.reachable ? <StatusDot key="s" tone="live">Connected</StatusDot> : sb.configured ? <StatusDot key="s" tone="failed">Not reachable</StatusDot> : <StatusDot key="s" tone="unavailable">Not configured</StatusDot>],
          ["Live execution", flags.emergencyStop ? <StatusDot key="l" tone="approval">Emergency stop</StatusDot> : flags.ready ? <StatusDot key="l" tone="live">Ready</StatusDot> : <StatusDot key="l" tone="unavailable">{flags.switchOn ? "Incomplete" : "Off"}</StatusDot>],
          ["QoreX wallet", <StatusDot key="q" tone="neutral">Per browser</StatusDot>],
        ].map(([k, v]) => <div key={k as string} className="bg-surface px-4 py-3"><p className="text-[12px] text-muted">{k}</p><div className="mt-1 font-medium">{v}</div></div>)}
      </section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Gemini AI" right={<Badge tone={ai.status === "configured" ? "live" : "unavailable"}>{ai.status === "configured" ? "CONFIGURED" : "UNAVAILABLE"}</Badge>}>
          {ai.status === "configured"
            ? <KV rows={[["Model", ai.model], ["Fallback", ai.fallbackModel ?? "none"], ["Free tier only", String(ai.freeTierOnly)], ["Requests/min", String(ai.rpm)], ["Requests/day", String(ai.rpd)], ["Concurrency", String(ai.concurrency)]]} />
            : <p className="text-[13.5px] text-muted">{ai.message}</p>}
        </Card>
        <Card title="QoreChain Diana testnet" right={<Badge tone={chain.ok ? "live" : "unavailable"} />}>
          <KV rows={[["REST", env.NEXT_PUBLIC_QORE_REST ?? "default"], ["EVM RPC", env.NEXT_PUBLIC_QORE_EVM_RPC ?? "default"], ["Status", chain.ok ? `chain ${chain.chainId}, block ${chain.block ?? "n/a"}` : (chain.error ?? "unreachable")]]} />
        </Card>
        <Card title="Supabase" right={<Badge tone={sb.reachable ? "live" : "unavailable"}>{sb.reachable ? "CONNECTED" : sb.configured ? "CONFIGURED, NOT REACHABLE" : "UNAVAILABLE"}</Badge>}>
          <KV rows={[["Status", sb.detail], ["URL", present(env.NEXT_PUBLIC_SUPABASE_URL)], ["Anon key", present(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)], ["Service role key", present(env.SUPABASE_SERVICE_ROLE_KEY)]]} />
        </Card>
        <Card title="Contracts" right={<Badge tone={live ? "live" : "unavailable"}>{live ? "DEPLOYED, CODE VERIFIED ON-CHAIN" : "UNVERIFIED"}</Badge>}>
          <KV rows={contracts.rows.map((r): [string, string] => [r.name, `${r.address} (${r.hasCode === null ? "unknown" : r.hasCode ? "code present" : "NO CODE"})`])} />
        </Card>
        <Card title="Live execution" right={flags.emergencyStop ? <Badge tone="approval">EMERGENCY STOP</Badge> : <Badge tone={flags.ready ? "live" : "unavailable"}>{flags.ready ? "READY" : flags.switchOn ? "INCOMPLETE" : "OFF"}</Badge>}>
          <KV rows={[["Switch", flags.switchOn ? "on" : "off"], ["Emergency stop", flags.emergencyStop ? "on" : "off"], ["Missing settings", flags.missing.length ? flags.missing.join(", ") : "none"]]} />
          <p className="mt-3 text-[12.5px] text-muted">When off or incomplete, payments can still be requested and approved; they are just never sent.</p>
        </Card>
        <Card title="QoreX wallet" right={<Badge tone="neutral">IN YOUR BROWSER</Badge>}>
          <p className="text-[13.5px] leading-relaxed text-muted">The wallet connects in your own browser and never shares keys with this server, so its status cannot be shown here. Connect it and check its account on the <Link href="/settings/wallets">Wallets</Link> page.</p>
        </Card>
      </div>
    </>
  );
}
