"use server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

async function ctx() {
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/governance");
  return { s: s as typeof s & { org: NonNullable<typeof s.org> }, sb: sb! };
}
const back = (kind: "msg" | "error", text: string): never => redirect(`/governance?${kind}=${encodeURIComponent(text)}`);

export async function createProposal(formData: FormData) {
  const { s, sb } = await ctx();
  const quorum = Number(formData.get("quorum"));
  const pct = Number(formData.get("pass_pct"));
  if (!Number.isInteger(quorum) || quorum < 1) back("error", "Quorum must be a whole number, 1 or more.");
  if (!Number.isInteger(pct) || pct < 50 || pct > 99) back("error", "The pass threshold must be 50 to 99.");
  const { error } = await sb.rpc("create_proposal", { p_org: s.org.id, p_title: String(formData.get("title") ?? ""), p_body: String(formData.get("body") ?? ""), p_quorum: quorum, p_pass_pct: pct });
  if (error) back("error", error.message);
  back("msg", "Proposal created in discussion. Open voting when it is ready.");
}

export async function openVoting(formData: FormData) {
  const { sb } = await ctx();
  const hours = Number(formData.get("hours"));
  if (!Number.isInteger(hours)) back("error", "Voting hours must be a whole number.");
  const { error } = await sb.rpc("open_voting", { p_id: String(formData.get("id") ?? ""), p_hours: hours });
  if (error) back("error", error.message);
  back("msg", "Voting is open.");
}

export async function castVote(formData: FormData) {
  const { sb } = await ctx();
  const { error } = await sb.rpc("cast_vote", { p_id: String(formData.get("id") ?? ""), p_choice: String(formData.get("choice") ?? "") });
  if (error) back("error", error.message);
  back("msg", "Your vote is recorded.");
}

export async function finalizeProposal(formData: FormData) {
  const { sb } = await ctx();
  const { data, error } = await sb.rpc("finalize_proposal", { p_id: String(formData.get("id") ?? "") });
  if (error) back("error", error.message);
  back("msg", `Voting closed: the proposal ${data === "passed" ? "passed" : "did not pass"}. Nothing is executed automatically.`);
}
