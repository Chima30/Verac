import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/live/service";
import { advanceWorkflow } from "@/lib/workflows/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background resume for workflows nobody is watching (for example a closed tab or a crashed worker). Call it from a
 * scheduler with `Authorization: Bearer $CRON_SECRET`. It advances analysis steps only: preparing a payment needs the
 * person who started the workflow, so a workflow waiting at that step stays waiting.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  const { data, error } = await serviceClient().from("agent_tasks").select("id").eq("kind", "invoice_review").in("state", ["QUEUED", "RUNNING"])
    .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).order("updated_at", { ascending: true }).limit(5);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const out: Array<{ id: string; ran: string | null; state?: string }> = [];
  for (const t of data ?? []) {
    // Up to 9 steps per workflow per tick, stopping when a step does not run (waiting, finished or leased elsewhere).
    for (let i = 0; i < 9; i++) {
      const r = await advanceWorkflow(t.id as string, null);
      out.push({ id: t.id as string, ran: r.ran, state: r.row?.state });
      if (!r.ran || r.waiting) break;
    }
  }
  return NextResponse.json({ advanced: out });
}
