import { NextResponse } from "next/server";
import { checkConfig } from "@/lib/config-check";
import { liveStatusFlags } from "@/lib/live/config";
import { rateLimit } from "@/lib/rate-limit";
import { reader } from "@/lib/server";
import { supabaseEnv } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms))]);
const timed = async <T,>(p: () => Promise<T>) => { const t = Date.now(); try { return { ok: true as const, value: await within(p(), 8000), ms: Date.now() - t }; } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t }; } };

/**
 * Public health check for uptime monitors. Reports whether each dependency answers and which feature groups are
 * configured: states only, never a setting's value or name. 200 when the site can serve its core; 503 otherwise.
 */
export async function GET(req: Request) {
  const tooMany = await rateLimit(req, "read");
  if (tooMany) return tooMany;
  const cfg = checkConfig();
  const sb = supabaseEnv();
  const [chain, database] = await Promise.all([
    timed(async () => { const q = reader(); await q.assertConnectedToTestnet(); return (await q.evm.getBlockNumber()).toString(); }),
    sb ? timed(async () => { const r = await fetch(`${sb.url}/auth/v1/health`, { headers: { apikey: sb.anon } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return "up"; }) : Promise.resolve(null),
  ]);
  const live = liveStatusFlags();
  const body = {
    ok: chain.ok && (database === null || database.ok) && cfg.ok,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    at: new Date().toISOString(),
    chain: chain.ok ? { ok: true, network: "Diana testnet", block: chain.value, ms: chain.ms } : { ok: false, error: chain.error },
    database: database === null ? { ok: null, note: "not configured" } : database.ok ? { ok: true, ms: database.ms } : { ok: false, error: database.error },
    features: Object.fromEntries(cfg.groups.map((g) => [g.id, g.state])),
    payments: live.emergencyStop ? "emergency stop" : !live.switchOn ? "off" : live.ready ? "on" : "incomplete",
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
