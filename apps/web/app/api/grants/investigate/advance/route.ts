import { NextResponse } from "next/server";
import { z } from "zod";
import { advanceGrantWorkflow } from "@/lib/grants/engine";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Advances a grant investigation by one unit of work. Safe to call repeatedly: the lease and per-application keys prevent duplicates. */
export async function POST(req: Request) {
  const tooMany = await rateLimit(req, "poll");
  if (tooMany) return tooMany;
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!["owner", "administrator"].includes(s.org.role)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const body = z.object({ taskId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  // Row-level security: the signed-in user must be able to see this task in their own organisation.
  const sb = (await supabaseServer())!;
  const { data: own } = await sb.from("agent_tasks").select("id").eq("id", body.data.taskId).eq("organization_id", s.org.id).eq("kind", "grant_review").maybeSingle();
  if (!own) return NextResponse.json({ error: "Investigation not found." }, { status: 404 });
  try {
    const r = await advanceGrantWorkflow(body.data.taskId);
    return NextResponse.json({ ok: true, ran: r.ran, state: r.row?.state, steps: r.row?.steps, error: r.row?.error, package: r.row?.result?.package ?? null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 300) }, { status: 500 });
  }
}
