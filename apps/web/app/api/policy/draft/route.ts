import { NextResponse } from "next/server";
import { AiError, AiProvider, untrustedBlock } from "@qoreops/ai-provider";
import { PolicyDraftSchema, describePolicy, policyFromDraft, validatePolicy } from "@qoreops/policy-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One provider per server instance so its rate/quota counters persist between requests.
let provider: AiProvider | undefined;
const ai = () => (provider ??= AiProvider.fromEnv(process.env));

// Best-effort per-instance limit on top of the provider's own limits (the free quota is shared by every visitor).
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 2000) hits.clear();
  return recent.length > 5;
}

const INSTRUCTIONS = `You help an organisation write a spending policy for a payment agent that pays in native QOR.
Read the user's description and fill the schema. Amounts are plain QOR numbers (for example 10 means ten QOR), never base units.
- perTxQor: the most the agent may pay in one transaction.
- dailyQor: the most the agent may pay in total per day. It must be at least perTxQor.
- autoApproveQor: payments to already-approved recipients up to this amount need no human approval. It must not exceed perTxQor. Use 0 if every payment should need approval.
- approvalThreshold: how many human approvers must approve a payment that needs approval (1 to 10). Default 1 if unspecified.
- requireApprovalForNewRecipients: true unless the user clearly says otherwise.
- validForDays: how long the agent's permission lasts (1 to 365). Default 30 if unspecified.
- name: a short descriptive name.
- summary: one or two plain sentences restating what you understood, including any value you had to assume.
Use the numbers the user gives EXACTLY as written, even if they look inconsistent or unsafe (for example a daily limit below the per-payment limit, or an auto-approve amount above the per-payment limit). Never adjust, round, correct or "fix" a number the user stated; a separate validator will flag contradictions for the human. If you notice an inconsistency, copy it as given and mention it in the summary.
If the user gives no numbers for a field, choose a conservative small value and say so in the summary. You only draft; a human reviews and approves everything.`;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (limited(ip)) return NextResponse.json({ error: "Too many drafts. Try again in a minute." }, { status: 429 });

  let text = "";
  try { text = String(((await req.json()) as { text?: unknown }).text ?? "").trim(); } catch { return NextResponse.json({ error: "Body must be JSON with a text field." }, { status: 400 }); }
  if (text.length < 5) return NextResponse.json({ error: "Describe the policy in at least a few words." }, { status: 400 });
  if (text.length > 1500) return NextResponse.json({ error: "Description is too long (1500 characters max)." }, { status: 413 });

  try {
    const r = await ai().generateStructured({
      agent: "PolicyAgent",
      instructions: INSTRUCTIONS,
      input: untrustedBlock("user policy description", text),
      schema: PolicyDraftSchema,
    });
    // The model's numbers become a policy only through deterministic code, then the real validator runs.
    let policy: unknown;
    try { policy = policyFromDraft(r.data); } catch (e) {
      return NextResponse.json({ error: `The draft could not be converted: ${e instanceof Error ? e.message : String(e)}`, model: r.model }, { status: 422 });
    }
    const v = validatePolicy(policy);
    return NextResponse.json({
      label: "AI DRAFT, NOT ACTIVE",
      model: r.model,
      aiSummary: r.data.summary,
      policy,
      ok: v.ok,
      findings: v.findings,
      description: v.policy ? describePolicy(v.policy) : [],
    });
  } catch (e) {
    if (e instanceof AiError) {
      const status = e.code === "NOT_CONFIGURED" ? 503 : e.code === "QUOTA_EXHAUSTED" || e.code === "RATE_LIMITED" ? 429 : e.code === "INPUT_TOO_LARGE" ? 413 : e.code === "SECRET_DETECTED" ? 400 : e.code === "TIMEOUT" ? 504 : 502;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    return NextResponse.json({ error: "Unexpected error while drafting." }, { status: 500 });
  }
}
