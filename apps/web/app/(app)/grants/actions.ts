"use server";
import { redirect } from "next/navigation";
import { splitEvenly } from "@qoreops/policy-engine";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

async function ctx() {
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/grants");
  return { s: s as typeof s & { org: NonNullable<typeof s.org> }, sb: sb! };
}
const back = (kind: "msg" | "error", text: string, path = "/grants"): never => redirect(`${path}?${kind}=${encodeURIComponent(text)}`);
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** QOR (decimal, up to 6 places shown to people) to 18-decimal base units, without floating point. */
function qorToWei(v: string): string | null {
  const m = /^(\d{1,15})(?:\.(\d{1,18}))?$/.exec(v.trim());
  if (!m) return null;
  const wei = BigInt(m[1]!) * 10n ** 18n + BigInt((m[2] ?? "").padEnd(18, "0"));
  return wei > 0n ? wei.toString() : null;
}

export async function createGrant(formData: FormData) {
  const { s, sb } = await ctx();
  const wei = qorToWei(String(formData.get("budget") ?? ""));
  if (!wei) back("error", "Enter the budget in QOR, for example 100 or 2.5.");
  const { error } = await sb.rpc("create_grant", { p_org: s.org.id, p_title: String(formData.get("title") ?? ""), p_budget: wei, p_token: "0x0000000000000000000000000000000000000000" });
  if (error) back("error", error.message);
  back("msg", "Grant round opened for applications. Budget is in native QOR.");
}

const CATEGORIES = ["software", "research", "education", "community", "other"] as const;

/** Opens a round with description, requirements, categories, deadline, maximum request and the default rubric (version 1). */
export async function createRound(f: FormData) {
  const { s, sb } = await ctx();
  const budget = qorToWei(str(f, "budget"));
  if (!budget) back("error", "Enter the budget in QOR, for example 20000.");
  const max = str(f, "max") ? qorToWei(str(f, "max")) : null;
  if (str(f, "max") && !max) back("error", "Enter the maximum per application in QOR, or leave it empty.");
  const categories = CATEGORIES.filter((c) => f.get(`cat-${c}`) === "on");
  if (!categories.length) back("error", "Choose at least one project category.");
  const deadline = str(f, "deadline") ? new Date(`${str(f, "deadline")}T23:59:59Z`).toISOString() : null;
  const { data, error } = await sb.rpc("create_grant_round", {
    p_org: s.org.id, p_title: str(f, "title"), p_budget: budget, p_description: str(f, "description"), p_requirements: str(f, "requirements"),
    p_categories: categories, p_deadline: deadline, p_max_request: max, p_rubric: null,
  });
  if (error) back("error", /create_grant_round/.test(error.message) ? "The database needs migration 0019 first." : error.message);
  back("msg", "Round opened with the default rubric (version 1). Edit the rubric before the first evaluation if you need different criteria.", `/grants/${data as string}`);
}

/** Saves the rubric: in place until the first evaluation locks it, then as a new version with a reason. */
export async function saveRubric(f: FormData) {
  const { sb } = await ctx();
  const id = str(f, "grant");
  const rows = Number(f.get("rows") ?? 0);
  const criteria: Array<Record<string, unknown>> = [];
  for (let i = 0; i < Math.min(rows, 12); i++) {
    const label = str(f, `label-${i}`);
    if (!label) continue;
    const key = (str(f, `key-${i}`) || label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([0-9])/, "c_$1").slice(0, 32) || `criterion_${i + 1}`;
    const applies = CATEGORIES.filter((c) => f.get(`applies-${i}-${c}`) === "on");
    criteria.push({ key, label, max: Number(str(f, `max-${i}`)), guidance: str(f, `guidance-${i}`) || undefined, ...(applies.length && applies.length < CATEGORIES.length ? { applies_to: applies } : {}) });
  }
  const { data, error } = await sb.rpc("set_grant_rubric", { p_grant: id, p_criteria: criteria, p_reason: str(f, "reason") || null });
  if (error) back("error", error.message, `/grants/${id}`);
  back("msg", `Rubric saved as version ${data as number}.`, `/grants/${id}`);
}

/** Saves an application as a draft (or an open amendment). The client sends the whole form as JSON; amounts are in QOR. */
export async function saveApplication(f: FormData): Promise<void> {
  const { sb } = await ctx();
  const grant = str(f, "grant");
  const path = `/grants/${grant}/apply`;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(String(f.get("payload") ?? "{}")); } catch { back("error", "The form could not be read. Try again.", path); }
  const r = raw! as { name?: string; category?: string; amountQor?: string; recipient?: string; content?: Record<string, unknown> & { budget?: Array<{ item: string; amountQor: string }>; milestones?: Array<Record<string, string>> } };
  const toWei = (v: string | undefined, what: string): string | null => {
    if (!v || !v.trim()) return null;
    const w = qorToWei(v);
    if (!w) back("error", `${what}: enter an amount in QOR, for example 1500.`, path);
    return w;
  };
  const content = { ...(r.content ?? {}) } as Record<string, unknown>;
  content.budget = (r.content?.budget ?? []).filter((b) => b.item?.trim() || b.amountQor?.trim()).map((b, i) => ({ item: b.item.trim(), amount: toWei(b.amountQor, `Budget line ${i + 1}`) ?? "0" }));
  content.milestones = (r.content?.milestones ?? []).filter((m) => m.title?.trim() || m.amountQor?.trim()).map((m, i) => ({
    title: (m.title ?? "").trim(), deliverable: (m.deliverable ?? "").trim(), verification: (m.verification ?? "").trim(), due: m.due ?? "", amount: toWei(m.amountQor, `Milestone ${i + 1}`) ?? "0",
  }));
  const { error } = await sb.rpc("save_grant_application", {
    p_grant: grant, p_name: r.name ?? "", p_category: r.category || null, p_amount: toWei(r.amountQor, "Requested amount"), p_recipient: r.recipient?.trim() || null, p_content: content,
  });
  if (error) back("error", /save_grant_application/.test(error.message) ? "The database needs migration 0019 first." : error.message, path);
  if (String(f.get("intent")) === "submit") {
    const { data: app } = await sb.from("grant_applications").select("id").eq("grant_id", grant).maybeSingle();
    const { data, error: e2 } = await sb.rpc("submit_grant_application", { p_app: app?.id, p_reason: str(f, "reason") || null });
    if (e2) back("error", e2.message.replace(/^cannot submit yet: /, "Not submitted yet: "), path);
    back("msg", `Submitted (version ${data as number}). You can follow its review here.`, `/grants/applications/${app!.id}`);
  }
  back("msg", "Draft saved. Only you can see it until you submit.", path);
}

export async function closeGrant(formData: FormData) {
  const { sb } = await ctx();
  const { error } = await sb.rpc("close_grant", { p_id: String(formData.get("id") ?? "") });
  if (error) back("error", error.message);
  back("msg", "Round closed to new applications.");
}

export async function applyToGrant(formData: FormData) {
  const { sb } = await ctx();
  const wei = qorToWei(String(formData.get("amount") ?? ""));
  if (!wei) back("error", "Enter the amount you are asking for in QOR, for example 25.");
  const { error } = await sb.rpc("apply_to_grant", { p_grant: String(formData.get("grant") ?? ""), p_name: String(formData.get("name") ?? ""), p_amount: wei, p_pitch: String(formData.get("pitch") ?? "") });
  if (error) back("error", error.message);
  back("msg", "Application submitted.");
}

export async function decideApplication(formData: FormData) {
  const { sb } = await ctx();
  const id = String(formData.get("id") ?? "");
  const { data, error } = await sb.rpc("decide_application", { p_app: id, p_decision: String(formData.get("decision") ?? ""), p_note: String(formData.get("note") ?? "") });
  if (error) back("error", error.message, `/grants/applications/${id}`);
  back("msg", data === "recommended" ? "Recommended. A different administrator must now award it." : "Application rejected.", `/grants/applications/${id}`);
}

export async function awardApplication(formData: FormData) {
  const { sb } = await ctx();
  const id = String(formData.get("id") ?? "");
  const n = Number(formData.get("count"));
  if (!Number.isInteger(n) || n < 1 || n > 10) back("error", "Choose 1 to 10 milestones.");
  const { data: a } = await sb.from("grant_applications").select("requested_amount,content").eq("id", id).maybeSingle();
  if (!a) back("error", "Application not found.");
  // Use the applicant's own milestone plan when it exists (it was validated to add up exactly); otherwise split evenly.
  const plan = ((a!.content as { milestones?: Array<{ title: string; amount: string }> } | null)?.milestones ?? []).filter((m) => m.title && /^[0-9]+$/.test(m.amount));
  const ms = plan.length
    ? plan.map((m) => ({ title: m.title.slice(0, 120), amount: m.amount }))
    : splitEvenly(String(a!.requested_amount).split(".")[0]!, n).map((amount, i) => ({ title: `Milestone ${i + 1}`, amount }));
  const { error } = await sb.rpc("award_application", { p_app: id, p_milestones: ms });
  if (error) back("error", error.message, `/grants/applications/${id}`);
  back("msg", `Awarded with ${ms.length} milestone${ms.length === 1 ? "" : "s"}${plan.length ? " from the applicant's plan" : ", split evenly"}. No QOR has been sent: funding needs the treasury's approval path.`, `/grants/applications/${id}`);
}
