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
const back = (kind: "msg" | "error", text: string): never => redirect(`/grants?${kind}=${encodeURIComponent(text)}`);

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
  const { data, error } = await sb.rpc("decide_application", { p_app: String(formData.get("id") ?? ""), p_decision: String(formData.get("decision") ?? ""), p_note: String(formData.get("note") ?? "") });
  if (error) back("error", error.message);
  back("msg", data === "recommended" ? "Recommended. A different administrator must now award it." : "Application rejected.");
}

export async function awardApplication(formData: FormData) {
  const { sb } = await ctx();
  const id = String(formData.get("id") ?? "");
  const n = Number(formData.get("count"));
  if (!Number.isInteger(n) || n < 1 || n > 10) back("error", "Choose 1 to 10 milestones.");
  const { data: a } = await sb.from("grant_applications").select("requested_amount").eq("id", id).maybeSingle();
  if (!a) back("error", "Application not found.");
  const parts = splitEvenly(String(a!.requested_amount).split(".")[0]!, n);
  const ms = parts.map((amount, i) => ({ title: `Milestone ${i + 1}`, amount }));
  const { error } = await sb.rpc("award_application", { p_app: id, p_milestones: ms });
  if (error) back("error", error.message);
  back("msg", `Awarded with ${n} equal milestone${n === 1 ? "" : "s"}. Evidence and payment for grant milestones are not built yet.`);
}
