import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { liveStatusFlags } from "@/lib/live/config";
import { runLiveExecution } from "@/lib/live/service";
import { runLiveExecutionV2, v2Flags } from "@/lib/live/v2";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Executes ONE already-approved live operation. The explicit click that calls this is the last human step. */
export async function POST(req: Request) {
  const tooMany = await rateLimit(req, "money");
  if (tooMany) return tooMany;
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!["owner", "administrator", "finance_manager"].includes(s.org.role)) return NextResponse.json({ error: "Only finance roles can execute." }, { status: 403 });
  const body = z.object({ id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  const flags = liveStatusFlags();
  if (!flags.switchOn) return NextResponse.json({ error: flags.emergencyStop ? "Live execution is stopped (emergency stop is on)." : "Live execution is switched off on this deployment." }, { status: 503 });

  // The signed-in user must be able to see this operation in their own organisation (row-level security).
  const sb = (await supabaseServer())!;
  let { data: row } = await sb.from("transactions").select("id,state,source,vault_version").eq("id", body.data.id).eq("organization_id", s.org.id).maybeSingle();
  if (!row) ({ data: row } = await sb.from("transactions").select("id,state,source").eq("id", body.data.id).eq("organization_id", s.org.id).maybeSingle()); // before migration 0018
  if (!row || row.source !== "LIVE_TESTNET") return NextResponse.json({ error: "Operation not found." }, { status: 404 });
  const isV2 = Number((row as { vault_version?: number }).vault_version ?? 1) === 2;
  if (isV2 && !v2Flags().ready) return NextResponse.json({ error: "TreasuryVault V2 is not fully configured on the server." }, { status: 503 });
  if (!isV2 && !flags.ready) return NextResponse.json({ error: "Live execution is not fully configured on the server." }, { status: 503 });
  try {
    const result = isV2 ? await runLiveExecutionV2(body.data.id) : await runLiveExecution(body.data.id);
    return NextResponse.json({ ok: true, result: JSON.parse(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Execution failed." }, { status: 409 });
  }
}
