import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { proposeLivePayment } from "@/lib/live/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Creates a live payment request. Checks the real chain, sends NOTHING, and leaves the request awaiting an administrator. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!["owner", "administrator", "finance_manager"].includes(s.org.role)) return NextResponse.json({ error: "Only finance roles can request a live payment." }, { status: 403 });
  const sb = (await supabaseServer())!;
  try {
    const r = await proposeLivePayment(sb, s.org.id, await req.json().catch(() => null));
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "The request failed." }, { status: 500 });
  }
}
