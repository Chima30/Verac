import { NextResponse } from "next/server";
import { AiError, AiProvider, untrustedBlock } from "@qoreops/ai-provider";
import { getSession } from "@/lib/session";
import { ASK_INSTRUCTIONS, AskDraftSchema, checkAskDraft } from "@/lib/live/ask";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

let provider: AiProvider | undefined;
const ai = () => (provider ??= AiProvider.fromEnv(process.env));

// Per signed-in user, per server instance, on top of the provider's own limits (the free quota is shared).
const hits = new Map<string, number[]>();
function limited(user: string): boolean {
  const now = Date.now();
  const recent = (hits.get(user) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(user, recent);
  if (hits.size > 2000) hits.clear();
  return recent.length > 5;
}

/**
 * AI DRAFT ONLY. Gemini (as the TreasuryAgent, which cannot move funds) turns plain English into form fields. This route writes
 * nothing, signs nothing and sends nothing; it returns a draft the person must still review, request, and have approved by someone else.
 */
export async function POST(req: Request) {
  const tooMany = await rateLimit(req, "ai");
  if (tooMany) return tooMany;
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!["owner", "administrator", "finance_manager"].includes(s.org.role)) return NextResponse.json({ error: "Only finance roles can draft a live payment." }, { status: 403 });
  if (limited(s.user.id)) return NextResponse.json({ error: "Too many drafts. Try again in a minute." }, { status: 429 });

  let text = "";
  try { text = String(((await req.json()) as { text?: unknown }).text ?? "").trim(); } catch { return NextResponse.json({ error: "Body must be JSON with a text field." }, { status: 400 }); }
  if (text.length < 10) return NextResponse.json({ error: "Write the address, the amount and what it is for." }, { status: 400 });
  if (text.length > 600) return NextResponse.json({ error: "That is too long (600 characters max)." }, { status: 413 });

  try {
    const r = await ai().generateStructured({ agent: "TreasuryAgent", instructions: ASK_INSTRUCTIONS, input: untrustedBlock("payment request", text), schema: AskDraftSchema });
    const checked = checkAskDraft(r.data, text);
    if (!checked.ok) return NextResponse.json({ error: checked.error, model: r.model }, { status: 422 });
    return NextResponse.json({ label: "AI DRAFT, NOT REQUESTED", model: r.model, draft: checked.draft, note: checked.note });
  } catch (e) {
    if (e instanceof AiError) {
      const status = e.code === "NOT_CONFIGURED" ? 503 : e.code === "QUOTA_EXHAUSTED" || e.code === "RATE_LIMITED" ? 429 : e.code === "INPUT_TOO_LARGE" ? 413 : e.code === "SECRET_DETECTED" ? 400 : e.code === "TIMEOUT" ? 504 : 502;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    return NextResponse.json({ error: "Unexpected error while drafting." }, { status: 500 });
  }
}
