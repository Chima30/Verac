"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildProposalWei } from "@/lib/approvals";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export interface ActionResult { error?: string; envelope?: string; sha256?: string }

async function ctx() {
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/milestones");
  return { s: s as typeof s & { user: NonNullable<typeof s.user>; org: NonNullable<typeof s.org> }, sb: sb! };
}
const back = (kind: "msg" | "error", text: string): never => redirect(`/milestones?${kind}=${encodeURIComponent(text)}`);

export async function setPayoutAddress(formData: FormData) {
  const { s, sb } = await ctx();
  const addr = String(formData.get("address") ?? "").trim();
  const { error } = await sb.rpc("set_my_payout_address", { p_org: s.org.id, p_addr: addr });
  if (error) back("error", error.message);
  back("msg", "Payout address saved. Every change is recorded and visible to the organisation.");
}

export async function submitEvidence(milestoneId: string, envelope: string, sha256: string): Promise<ActionResult> {
  const { sb } = await ctx();
  const { error } = await sb.rpc("submit_milestone_evidence", { p_ms: milestoneId, p_envelope: envelope, p_sha256: sha256 });
  if (error) return { error: error.message };
  revalidatePath("/milestones");
  return {};
}

export async function fetchEvidence(milestoneId: string): Promise<ActionResult> {
  const { sb } = await ctx();
  const { data, error } = await sb.rpc("milestone_evidence", { p_ms: milestoneId });
  if (error) return { error: error.message };
  const row = (data as Array<{ envelope: string; envelope_sha256: string }> | null)?.[0];
  return row ? { envelope: row.envelope, sha256: row.envelope_sha256 } : { error: "No evidence found." };
}

export async function decideMilestone(formData: FormData) {
  const { sb } = await ctx();
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 500);
  const { data, error } = await sb.rpc("decide_milestone", { p_ms: id, p_decision: decision, p_note: note });
  if (error) back("error", error.message);
  back("msg", data === "approved" ? "Milestone accepted. Finance can now request payment." : "Evidence rejected. The vendor can submit new evidence.");
}

export async function requestMilestonePayment(formData: FormData) {
  const { s, sb } = await ctx();
  const id = String(formData.get("id") ?? "");
  const required = Number(formData.get("required"));
  const hours = Number(formData.get("hours"));
  if (!Number.isInteger(required) || required < 1 || required > 10) back("error", "Approvals needed must be 1 to 10.");
  if (!(hours > 0) || hours > 168) back("error", "Validity must be up to 168 hours.");
  const { data: info, error: ie } = await sb.rpc("milestone_payout_info", { p_ms: id });
  if (ie) back("error", ie.message);
  const row = (info as Array<{ payout_address: string | null; amount: string; title: string; idx: number }> | null)?.[0];
  if (!row) back("error", "Milestone not found.");
  if (!row!.payout_address) back("error", "The vendor has not set a payout address yet.");
  const { proposal, hash } = buildProposalWei(s.org.id, { to: row!.payout_address!, weiAmount: String(row!.amount).split(".")[0]!, purpose: `Milestone ${row!.idx}: ${row!.title}`, validHours: hours });
  const { error } = await sb.rpc("request_milestone_payment", {
    p_ms: id, p_hash: hash, p_required: required, p_expires: new Date(proposal.expiry * 1000).toISOString(),
    p_evaluation: { proposal, purpose: `Milestone ${row!.idx}: ${row!.title}` },
  });
  if (error) back("error", error.message);
  back("msg", "Payment request created. A different finance member must approve it on the Approvals page. No QOR is sent.");
}
