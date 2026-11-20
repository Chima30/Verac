import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Cancels a workflow. The database allows the requester or an administrator, and refuses once a payment is executing. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const tooMany = await rateLimit(req, "money");
  if (tooMany) return tooMany;
  const { id } = await ctx.params;
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const sb = (await supabaseServer())!;
  const { data, error } = await sb.rpc("cancel_invoice_workflow", { p_task: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ state: data });
}
