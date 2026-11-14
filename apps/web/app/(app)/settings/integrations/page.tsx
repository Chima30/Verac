import { Badge, Card, KV, PageHeader } from "@/components/ui";
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
  const chain = await chainSnapshot();
  const contracts = await contractSnapshot();
  const sb = await supabaseStatus();
  const live = contracts.rows.length > 0 && contracts.rows.every((r) => r.hasCode === true);
  const env = process.env;
  return (
    <>
      <PageHeader title="Integrations" description="Which services are configured. Secret values are never displayed; only whether they are set." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Gemini AI" right={<Badge tone={ai.status === "configured" ? "live" : "unavailable"}>{ai.status === "configured" ? "CONFIGURED" : "UNAVAILABLE"}</Badge>}>
          {ai.status === "configured"
            ? <KV rows={[["Model", ai.model], ["Fallback", ai.fallbackModel ?? "none"], ["Free tier only", String(ai.freeTierOnly)], ["Requests/min", String(ai.rpm)], ["Requests/day", String(ai.rpd)], ["Concurrency", String(ai.concurrency)]]} />
            : <p className="text-sm text-muted">{ai.message}</p>}
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
      </div>
    </>
  );
}
