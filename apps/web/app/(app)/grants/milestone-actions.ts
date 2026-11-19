"use server";
import { redirect } from "next/navigation";
import { checkMilestoneEvidence, requestMilestoneFunding } from "@/lib/grants/funding";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const lines = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const back = (f: FormData, kind: "msg" | "error", text: string): never => redirect(`/grants/applications/${str(f, "app")}?${kind}=${encodeURIComponent(text)}#milestones`);

async function ctx() {
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/grants");
  return { s: s as typeof s & { org: NonNullable<typeof s.org>; user: NonNullable<typeof s.user> }, sb: sb! };
}

export async function submitMilestoneEvidence(f: FormData) {
  const { sb } = await ctx();
  const { data, error } = await sb.rpc("submit_grant_milestone_evidence", { p_ms: str(f, "ms"), p_description: str(f, "description"), p_links: lines(str(f, "links")), p_txs: lines(str(f, "txs")) });
  if (error) back(f, "error", /submit_grant_milestone_evidence/.test(error.message) ? "The database needs migration 0021 first." : error.message);
  back(f, "msg", `Evidence submitted (attempt ${data as number}). Reviewers will check it before approving.`);
}

export async function checkMilestone(f: FormData) {
  const { s } = await ctx();
  if (!["owner", "administrator", "security_reviewer"].includes(s.org.role)) back(f, "error", "Only reviewers can run the evidence check.");
  const r = await checkMilestoneEvidence(s.org.id, str(f, "ms"));
  if (!r.ok) back(f, "error", r.error);
  back(f, "msg", `The Milestone Agent checked ${r.ok ? r.items : 0} item(s). Its findings are below; approving is your decision.`);
}

export async function decideMilestone(f: FormData) {
  const { sb } = await ctx();
  const { data, error } = await sb.rpc("decide_grant_milestone", { p_ms: str(f, "ms"), p_decision: str(f, "decision"), p_reason: str(f, "reason") });
  if (error) back(f, "error", error.message);
  back(f, "msg", data === "approved" ? "Milestone approved. Funding can now be requested through the treasury." : "Milestone sent back to the recipient with your reason.");
}

export async function fundMilestone(f: FormData) {
  const { s, sb } = await ctx();
  if (!["owner", "administrator", "finance_manager"].includes(s.org.role)) back(f, "error", "Only finance roles can request payment.");
  const r = await requestMilestoneFunding(sb, s.org.id, s.user.id, str(f, "ms"));
  if (r.kind === "error") back(f, "error", r.error);
  if (r.kind === "awaiting") back(f, "msg", `Not requested: ${r.reasons.join(" ")} The reasons are recorded on the milestone.`);
  back(f, "msg", "Payment requested on TreasuryVault V2. Two administrators now sign it in Approvals; the milestone is marked released only after the chain confirms the payment.");
}
