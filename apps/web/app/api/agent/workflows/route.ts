import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({ instruction: z.string().trim().min(3).max(2000), idempotencyKey: z.string().min(8).max(80) });

/**
 * Starts an invoice-review workflow for the signed-in finance user's organisation. Returns at once: the agents run in
 * separate, resumable steps (POST .../advance), never inside this request. The same idempotency key returns the same workflow.
 */
export async function POST(req: Request) {
  const tooMany = await rateLimit(req, "workflow");
  if (tooMany) return tooMany;
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!["owner", "administrator", "finance_manager"].includes(s.org.role)) return NextResponse.json({ error: "Only finance roles can start an invoice workflow." }, { status: 403 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  const sb = (await supabaseServer())!;
  const { data, error } = await sb.rpc("start_invoice_workflow", { p_org: s.org.id, p_instruction: body.data.instruction, p_idempotency_key: body.data.idempotencyKey });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data });
}
