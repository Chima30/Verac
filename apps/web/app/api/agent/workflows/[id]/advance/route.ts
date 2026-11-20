import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { advanceWorkflow, nextStep, STEP_LABEL } from "@/lib/workflows/engine";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs ONE step of a workflow the signed-in user can see. Safe to call repeatedly: the lease makes concurrent calls no-ops. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const tooMany = await rateLimit(req, "poll");
  if (tooMany) return tooMany;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const sb = (await supabaseServer())!;
  // Row-level security decides visibility: a member of another organisation gets nothing back.
  const { data: visible } = await sb.from("agent_tasks").select("id").eq("id", id).eq("organization_id", s.org.id).eq("kind", "invoice_review").maybeSingle();
  if (!visible) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const r = await advanceWorkflow(id, { userId: s.user.id, client: sb });
    const row = r.row;
    return NextResponse.json({
      state: row?.state, ran: r.ran, waiting: r.waiting ?? null, error: row?.error ?? null,
      next: row ? (nextStep(row.steps ?? []) ? STEP_LABEL[nextStep(row.steps ?? [])!] : null) : null,
      steps: (row?.steps ?? []).length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "The step failed." }, { status: 500 });
  }
}
