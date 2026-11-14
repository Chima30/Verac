"use server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

async function ctx() {
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/disputes");
  return { sb: sb! };
}
const back = (kind: "msg" | "error", text: string): never => redirect(`/disputes?${kind}=${encodeURIComponent(text)}`);

export async function openDispute(formData: FormData) {
  const { sb } = await ctx();
  const { error } = await sb.rpc("open_dispute", { p_ms: String(formData.get("milestone") ?? ""), p_reason: String(formData.get("reason") ?? "") });
  if (error) back("error", error.message);
  back("msg", "Dispute opened. The milestone is frozen until an owner or administrator resolves it.");
}

export async function addNote(formData: FormData) {
  const { sb } = await ctx();
  const { error } = await sb.rpc("add_dispute_note", { p_id: String(formData.get("id") ?? ""), p_body: String(formData.get("body") ?? "") });
  if (error) back("error", error.message);
  back("msg", "Statement added.");
}

export async function resolveDispute(formData: FormData) {
  const { sb } = await ctx();
  const { error } = await sb.rpc("resolve_dispute", { p_id: String(formData.get("id") ?? ""), p_outcome: String(formData.get("outcome") ?? ""), p_note: String(formData.get("note") ?? "") });
  if (error) back("error", error.message);
  back("msg", "Dispute resolved in this app. No QOR moved and nothing on-chain changed.");
}
