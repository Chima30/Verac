"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { qorToWei } from "@qoreops/policy-engine";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export interface ActionResult { error?: string }

async function ctx() {
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/procurement");
  return { s: s as typeof s & { user: NonNullable<typeof s.user>; org: NonNullable<typeof s.org> }, sb: sb! };
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function createTender(formData: FormData) {
  const { s, sb } = await ctx();
  const title = String(formData.get("title") ?? "").trim();
  const requirements = String(formData.get("requirements") ?? "").trim();
  const budget = Number(formData.get("budget"));
  const fail = (m: string): never => redirect("/procurement?error=" + encodeURIComponent(m));
  if (title.length < 3 || title.length > 160) fail("Title must be 3 to 160 characters.");
  if (requirements.length < 10 || requirements.length > 3000) fail("Requirements must be 10 to 3000 characters.");
  if (!(budget > 0) || budget > 1_000_000_000) fail("Budget must be above 0.");
  let wei: string;
  try { wei = qorToWei(budget); } catch (e) { return fail(msg(e)); }
  const id = crypto.randomUUID();
  const { error } = await sb.from("procurements").insert({
    id, organization_id: s.org.id, title, requirements, budget: wei, token: "0x0000000000000000000000000000000000000000", status: "draft", created_by: s.user.id,
  });
  if (error) fail(error.message);
  redirect(`/procurement/${id}`);
}

export async function publishReadingKey(mlkem: string, x25519: string): Promise<ActionResult> {
  const { s, sb } = await ctx();
  const { error } = await sb.rpc("publish_seal_key", { p_org: s.org.id, p_mlkem: mlkem, p_x25519: x25519 });
  if (error) return { error: error.message };
  revalidatePath("/procurement");
  return {};
}

export async function openTender(formData: FormData) {
  const { sb } = await ctx();
  const id = String(formData.get("id") ?? "");
  const d = String(formData.get("deadline") ?? "").trim();
  const deadline = d ? new Date(d) : null;
  const back = (m: string): never => redirect(`/procurement/${id}?error=${encodeURIComponent(m)}`);
  if (deadline && Number.isNaN(deadline.getTime())) back("That deadline is not a valid date.");
  const { error } = await sb.rpc("open_tender", { p_proc: id, p_deadline: deadline ? deadline.toISOString() : null });
  if (error) back(error.message);
  redirect(`/procurement/${id}`);
}

export async function closeBidding(formData: FormData) {
  const { sb } = await ctx();
  const id = String(formData.get("id") ?? "");
  const { error } = await sb.rpc("close_bidding", { p_proc: id });
  if (error) redirect(`/procurement/${id}?error=${encodeURIComponent(error.message)}`);
  redirect(`/procurement/${id}`);
}

export async function submitSealedBid(tenderId: string, vendorName: string, envelope: string, sha256: string): Promise<ActionResult> {
  const { sb } = await ctx();
  const { error } = await sb.rpc("submit_bid", { p_proc: tenderId, p_vendor_name: vendorName, p_envelope: envelope, p_sha256: sha256 });
  if (error) return { error: error.message };
  revalidatePath(`/procurement/${tenderId}`);
  return {};
}

export async function awardBid(tenderId: string, bidId: string, milestones: Array<{ title: string; amountQor: number }>): Promise<ActionResult> {
  const { sb } = await ctx();
  let payload: Array<{ title: string; amount: string }>;
  try { payload = milestones.map((m) => ({ title: String(m.title).trim(), amount: qorToWei(Number(m.amountQor)) })); } catch (e) { return { error: msg(e) }; }
  const { error } = await sb.rpc("award_procurement", { p_proc: tenderId, p_bid: bidId, p_milestones: payload });
  if (error) return { error: error.message };
  revalidatePath(`/procurement/${tenderId}`);
  return {};
}
