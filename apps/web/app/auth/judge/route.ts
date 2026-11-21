import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * One-click sign-in to the read-only judge account. The credentials live only in the server's settings
 * (JUDGE_EMAIL, JUDGE_PASSWORD) and are never sent to the browser. The account is an "auditor" in a demo organisation:
 * it reads everything an administrator reads, and the database refuses every change it attempts.
 */
export async function POST(req: Request) {
  const tooMany = await rateLimit(req, "workflow");
  if (tooMany) return tooMany;
  const back = (msg: string) => NextResponse.redirect(new URL(`/start?judge=${encodeURIComponent(msg)}`, req.url), 303);
  const email = process.env.JUDGE_EMAIL?.trim(), password = process.env.JUDGE_PASSWORD?.trim();
  if (!email || !password) return back("The judge account is not set up on this server yet.");
  const sb = await supabaseServer();
  if (!sb) return back("Sign-in is not configured on this server.");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return back("The judge account could not sign in. Try again in a minute.");
  return NextResponse.redirect(new URL("/dashboard", req.url), 303);
}
