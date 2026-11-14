"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PeriodSchema, PayrollItemSchema, checkPayroll, payrollBatchHash, payrollTotalWei, type PayrollCheck, type PayrollItem } from "@qoreops/policy-engine";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export interface Preview { error?: string; items?: PayrollItem[]; check?: PayrollCheck; hash?: string; previousPeriod?: string | null }
export interface Submitted { error?: string }

const FINANCE = ["owner", "administrator", "finance_manager"];

/** Lines look like: Name | 0xAddress | amount  (a tab or a comma works instead of the bars). */
function parseLines(text: string): { items?: PayrollItem[]; error?: string } {
  const items: PayrollItem[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const [i, l] of lines.entries()) {
    const parts = (l.includes("|") ? l.split("|") : l.includes("\t") ? l.split("\t") : l.split(",")).map((x) => x.trim());
    if (parts.length !== 3) return { error: `Line ${i + 1} needs three parts: name | 0x address | amount` };
    const r = PayrollItemSchema.safeParse({ name: parts[0], address: parts[1], amountQor: Number(parts[2]) });
    if (!r.success) return { error: `Line ${i + 1}: ${r.error.issues[0]?.message ?? "invalid"}` };
    items.push(r.data);
  }
  return { items };
}

async function load() {
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/payroll");
  return { s: s as typeof s & { user: NonNullable<typeof s.user>; org: NonNullable<typeof s.org> }, sb: sb! };
}

export async function previewPayroll(period: string, text: string, perLineCap: string, totalCap: string): Promise<Preview> {
  const { s, sb } = await load();
  if (!PeriodSchema.safeParse(period).success) return { error: "Period must look like 2026-11." };
  const parsed = parseLines(text);
  if (parsed.error || !parsed.items) return { error: parsed.error };
  if (parsed.items.length > 200) return { error: "At most 200 lines per batch." };
  // The most recent earlier period that was approved or paid is the comparison baseline.
  const { data: prev } = await sb.from("payroll_batches").select("period,items,status").eq("organization_id", s.org.id).lt("period", period).in("status", ["approved", "paid"]).order("period", { ascending: false }).limit(1).maybeSingle();
  const previous = prev ? (prev.items as PayrollItem[]) : undefined;
  const check = checkPayroll(parsed.items, { previous, perLineCapQor: Number(perLineCap) > 0 ? Number(perLineCap) : undefined, totalCapQor: Number(totalCap) > 0 ? Number(totalCap) : undefined });
  let hash: string | undefined;
  try { if (check.verdict !== "block") hash = payrollBatchHash(s.org.id, period, parsed.items); } catch { /* blocked lines cannot be hashed */ }
  return { items: parsed.items, check, hash, previousPeriod: prev?.period ?? null };
}

export async function submitPayroll(period: string, text: string, required: number, hours: number): Promise<Submitted> {
  const { s, sb } = await load();
  if (!FINANCE.includes(s.org.role)) return { error: "Only finance roles can submit a payroll." };
  if (!Number.isInteger(required) || required < 1 || required > 10) return { error: "Approvals needed must be 1 to 10." };
  if (!(hours > 0) || hours > 168) return { error: "Validity must be up to 168 hours." };
  const pv = await previewPayroll(period, text, "", "");
  if (pv.error || !pv.items || !pv.check) return { error: pv.error };
  if (pv.check.verdict === "block" || !pv.hash) return { error: "This batch has blocking problems. Fix them first." };
  const { error } = await sb.rpc("submit_payroll_batch", {
    p_org: s.org.id, p_period: period, p_items: pv.items, p_total: payrollTotalWei(pv.items), p_hash: pv.hash, p_required: required,
    p_expires: new Date(Date.now() + hours * 3600_000).toISOString(),
  });
  if (error) return { error: error.message };
  revalidatePath("/payroll");
  return {};
}
