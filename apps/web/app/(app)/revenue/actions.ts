"use server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

async function ctx() {
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/revenue");
  return { s: s as typeof s & { org: NonNullable<typeof s.org> }, sb: sb! };
}
const back = (kind: "msg" | "error", text: string): never => redirect(`/revenue?${kind}=${encodeURIComponent(text)}`);

function qorToWei(v: string): string | null {
  const m = /^(\d{1,15})(?:\.(\d{1,18}))?$/.exec(v.trim());
  if (!m) return null;
  const wei = BigInt(m[1]!) * 10n ** 18n + BigInt((m[2] ?? "").padEnd(18, "0"));
  return wei > 0n ? wei.toString() : null;
}

export async function recordRevenue(formData: FormData) {
  const { s, sb } = await ctx();
  const wei = qorToWei(String(formData.get("amount") ?? ""));
  if (!wei) back("error", "Enter the amount in QOR, for example 250 or 12.5.");
  const due = String(formData.get("due") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) back("error", "Pick a due date.");
  const { error } = await sb.rpc("create_revenue_record", { p_org: s.org.id, p_customer: String(formData.get("customer") ?? ""), p_reference: String(formData.get("reference") ?? ""), p_amount: wei, p_due: due, p_description: String(formData.get("description") ?? "") });
  if (error) back("error", error.message);
  back("msg", "Recorded. Nothing was sent to the customer.");
}

export async function markPaid(formData: FormData) {
  const { sb } = await ctx();
  const { error } = await sb.rpc("mark_revenue_paid", { p_id: String(formData.get("id") ?? ""), p_tx: String(formData.get("tx") ?? "").trim() });
  if (error) back("error", error.message);
  back("msg", "Marked paid. The page checks the transaction against the chain; see its VERIFIED label.");
}

export async function voidRecord(formData: FormData) {
  const { sb } = await ctx();
  const { error } = await sb.rpc("void_revenue_record", { p_id: String(formData.get("id") ?? ""), p_reason: String(formData.get("reason") ?? "") });
  if (error) back("error", error.message);
  back("msg", "Record voided.");
}
