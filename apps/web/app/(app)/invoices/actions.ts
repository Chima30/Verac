"use server";
import { redirect } from "next/navigation";
import { DEPLOYED, treasuryVaultAbi } from "@qoreops/qorechain";
import { parseQor } from "@/lib/live/schema";
import { reader } from "@/lib/server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

const back = (kind: "msg" | "error", text: string): never => redirect(`/invoices?${kind}=${encodeURIComponent(text)}`);
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveVendor(f: FormData) {
  const s = await getSession(); const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/invoices");
  const payout = str(f, "payout");
  const { error } = await sb!.rpc("upsert_vendor", { p_org: s.org!.id, p_vendor: str(f, "vendor") || null, p_name: str(f, "name"), p_payout: payout || null, p_verified: f.get("verified") === "on" });
  if (error) back("error", error.message);
  back("msg", "Vendor saved. Any change of payout address is kept in the vendor's history.");
}

export async function recordInvoice(f: FormData) {
  const s = await getSession(); const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/invoices");
  const amount = str(f, "amount");
  if (!/^\d{1,7}(\.\d{1,6})?$/.test(amount)) back("error", "Amount must be a plain number of QOR, for example 1.5.");
  const { error } = await sb!.rpc("record_invoice", {
    p_org: s.org!.id, p_vendor: str(f, "vendor") || null, p_number: str(f, "number"), p_amount: parseQor(amount).toString(), p_recipient: str(f, "recipient"),
    p_invoice_date: str(f, "invoiceDate") || null, p_due: str(f, "dueDate") || null, p_milestone: str(f, "milestone") || null, p_notes: str(f, "notes") || null,
  });
  if (error) back("error", /duplicate key|unique/.test(error.message) ? "This vendor already has an invoice with that number." : error.message);
  back("msg", "Invoice recorded. Ask Verac to review it from the AI Command Center.");
}

/** A public address that is not on the vault's approved list, used as the "suspicious" payout in the demo. */
const DEMO_OTHER = "0x000000000000000000000000000000000000dEaD";
const DEMO_GOOD_DEFAULT = "0x200cad3c9de63d3613a33fc20b1ef31cb4dbf5af"; // the recipient the vault approved in the 2026-11-14 run

export async function loadDemo() {
  const s = await getSession(); const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/invoices");
  const good = (process.env.DEMO_APPROVED_RECIPIENT?.trim() || DEMO_GOOD_DEFAULT) as `0x${string}`;
  // The demo is only honest if the "good" address really is approved on the vault and the other is not. Check both on chain.
  try {
    const evm = reader().evm;
    const [g, o] = await Promise.all([good, DEMO_OTHER].map((a) => evm.readContract({ address: DEPLOYED.TreasuryVault, abi: treasuryVaultAbi, functionName: "approvedRecipient", args: [a as `0x${string}`] })));
    if (!g) back("error", `The demo needs an address that is approved on the vault; ${good} is not. Set DEMO_APPROVED_RECIPIENT.`);
    if (o) back("error", "The demo's suspicious address is unexpectedly approved on the vault; demo not loaded.");
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect from back()
    back("error", "Could not read the vault to set up the demo. Try again in a minute.");
  }
  const { error } = await sb!.rpc("seed_invoice_demo", { p_org: s.org!.id, p_good: good, p_other: DEMO_OTHER });
  if (error) back("error", error.message);
  back("msg", "Demo loaded: three invoices named DEMO-*, two vendors and three milestones, all marked as demo data.");
}
