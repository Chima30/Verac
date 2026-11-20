import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { buildReceipt, receiptText } from "@/lib/workflows/receipt";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Decision receipt as JSON (default) or plain text (?format=text). Only for internal members of the workflow's organisation. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const tooMany = await rateLimit(req, "read");
  if (tooMany) return tooMany;
  const { id } = await ctx.params;
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const sb = (await supabaseServer())!;
  const { data: visible } = await sb.from("agent_tasks").select("id").eq("id", id).eq("organization_id", s.org.id).maybeSingle();
  if (!visible) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const r = await buildReceipt(id, s.org.id);
  if (!r) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const name = `verac-receipt-${id.slice(0, 8)}`;
  if (new URL(req.url).searchParams.get("format") === "text")
    return new NextResponse(receiptText(r), { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${name}.txt"` } });
  return new NextResponse(JSON.stringify(r, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${name}.json"` } });
}
