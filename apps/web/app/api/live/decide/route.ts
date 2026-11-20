import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { supabaseEnv } from "@/lib/supabase/config";
import { supabaseServer } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * An administrator approves or rejects ONE live operation. Approving needs the password again (step-up), checked here on a
 * throwaway client so it never touches the session. The database records who decided, when, how they were authenticated and the
 * exact payment hash, and refuses a decision from the person who made the request.
 */
export async function POST(req: Request) {
  const tooMany = await rateLimit(req, "money");
  if (tooMany) return tooMany;
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = z.object({ id: z.string().uuid(), decision: z.enum(["approve", "reject"]), note: z.string().max(280).optional(), password: z.string().min(1).max(200).optional() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  const { id, decision, note, password } = body.data;

  let method = "session (rejection)";
  if (decision === "approve") {
    const env = supabaseEnv();
    if (!env || !s.user.email || !password) return NextResponse.json({ error: "Enter your password to approve a live payment." }, { status: 401 });
    const check = createClient(env.url, env.anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await check.auth.signInWithPassword({ email: s.user.email, password });
    if (error) return NextResponse.json({ error: "That password is not correct." }, { status: 401 });
    method = "password re-entry";
  }
  const sb = (await supabaseServer())!;
  const { data, error } = await sb.rpc("decide_live_payment", { p_tx: id, p_decision: decision, p_note: note ?? null, p_auth_method: method });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, state: data });
}
