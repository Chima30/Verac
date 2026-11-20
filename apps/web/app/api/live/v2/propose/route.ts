import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { proposeLivePaymentV2 } from "@/lib/live/v2";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Creates a TreasuryVault V2 payment request. Checks the live vault, sends NOTHING, and waits for administrator signatures. */
export async function POST(req: Request) {
  const tooMany = await rateLimit(req, "money");
  if (tooMany) return tooMany;
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!["owner", "administrator", "finance_manager"].includes(s.org.role)) return NextResponse.json({ error: "Only finance roles can request a live payment." }, { status: 403 });
  const sb = (await supabaseServer())!;
  try {
    const r = await proposeLivePaymentV2(sb, s.org.id, await req.json().catch(() => null));
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "The request failed." }, { status: 500 });
  }
}
