import { NextResponse } from "next/server";
import { z } from "zod";
import { advanceGrantWorkflow, newIdempotencyKey } from "@/lib/grants/engine";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Starts a grant investigation for one round (owners and administrators). Returns the task id; the page advances it. */
export async function POST(req: Request) {
  const tooMany = await rateLimit(req, "workflow");
  if (tooMany) return tooMany;
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!["owner", "administrator"].includes(s.org.role)) return NextResponse.json({ error: "Only owners and administrators can start an investigation." }, { status: 403 });
  const body = z.object({ grantId: z.string().uuid(), instruction: z.string().trim().min(3).max(2000), idempotencyKey: z.string().min(8).max(80).optional() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  const sb = (await supabaseServer())!;
  const { data, error } = await sb.rpc("start_grant_workflow", { p_org: s.org.id, p_grant: body.data.grantId, p_instruction: body.data.instruction, p_idempotency_key: body.data.idempotencyKey ?? newIdempotencyKey() });
  if (error) return NextResponse.json({ error: /start_grant_workflow/.test(error.message) ? "The database needs migrations 0019 and 0020 first." : error.message }, { status: 400 });
  try { await advanceGrantWorkflow(data as string); } catch { /* the page keeps advancing; the error is stored on the task */ }
  return NextResponse.json({ ok: true, taskId: data });
}
