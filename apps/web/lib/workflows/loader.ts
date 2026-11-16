/**
 * SERVER ONLY. Reads one organisation's records for a workflow, plus the live vault state.
 *
 * Every query is filtered by organisation id; the caller has already checked that the signed-in user is a finance member of
 * that organisation (start_invoice_workflow refuses anyone else). Treasury figures are read from Diana testnet, never stored.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Snapshot, TreasuryRead } from "@qoreops/agent-coordinator";
import { treasuryVaultAbi, DEPLOYED } from "@qoreops/qorechain";
import { liveStatusFlags } from "@/lib/live/config";
import { reader } from "@/lib/server";
import { vaultSnapshot } from "@/lib/vault";

const NATIVE = "0x0000000000000000000000000000000000000000";
const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
const whole = (v: unknown) => String(v ?? "0").split(".")[0]!;

export async function loadSnapshot(sb: SupabaseClient, org: string): Promise<Snapshot> {
  // Amounts are read as text: PostgREST would otherwise round 18-decimal numbers through JavaScript doubles.
  const [inv, ven, hist, ms, procs, grants, tx] = await Promise.all([
    sb.from("invoices").select("id,invoice_number,vendor_id,amount::text,token,recipient,invoice_date,due_date,status,notes,milestone_id,transaction_id,created_at").eq("organization_id", org).limit(500),
    sb.from("vendors").select("id,name,verified,payout_address").eq("organization_id", org).limit(500),
    sb.from("vendor_address_history").select("vendor_id,payout_address,created_at").eq("organization_id", org).order("created_at", { ascending: false }).limit(500),
    sb.from("milestones").select("id,parent_type,parent_id,idx,title,amount::text,status,review").eq("organization_id", org).limit(500),
    sb.from("procurements").select("id,title").eq("organization_id", org).limit(500),
    sb.from("grants").select("id,title").eq("organization_id", org).limit(500),
    sb.from("transactions").select("id,state,recipient,amount::text,evaluation,source,created_at").eq("organization_id", org).order("created_at", { ascending: false }).limit(500),
  ]);
  for (const r of [inv, ven, hist, ms, procs, grants, tx]) if (r.error) throw new Error(r.error.message);
  const titles = new Map<string, string>([...(procs.data ?? []), ...(grants.data ?? [])].map((p) => [p.id as string, p.title as string]));

  // The vendor-address history includes each vendor's first address; only later changes are "changes".
  const firstSeen = new Map<string, string>();
  for (const h of [...(hist.data ?? [])].reverse()) if (!firstSeen.has(h.vendor_id as string)) firstSeen.set(h.vendor_id as string, h.created_at as string);
  const changes = (hist.data ?? []).filter((h) => firstSeen.get(h.vendor_id as string) !== h.created_at);

  const invoices = (inv.data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id), invoiceNumber: String(r.invoice_number), vendorId: text(r.vendor_id), amountWei: whole(r.amount), token: String(r.token ?? NATIVE), recipient: String(r.recipient),
    invoiceDate: text(r.invoice_date), dueDate: text(r.due_date), status: String(r.status), notes: text(r.notes), milestoneId: text(r.milestone_id), transactionId: text(r.transaction_id), createdAt: String(r.created_at),
  }));

  const { treasury, policyVersion } = await treasuryRead([...new Set(invoices.map((i) => i.recipient.toLowerCase()))]);
  const flags = liveStatusFlags();
  return {
    organizationId: org, today: new Date().toISOString().slice(0, 10), loadedAt: new Date().toISOString(),
    invoices,
    vendors: (ven.data ?? []).map((v) => ({ id: String(v.id), name: String(v.name), verified: !!v.verified, payoutAddress: text(v.payout_address) })),
    addressChanges: changes.map((h) => ({ vendorId: String(h.vendor_id), payoutAddress: String(h.payout_address), createdAt: String(h.created_at) })),
    milestones: (ms.data ?? []).map((m: Record<string, unknown>) => {
      const review = m.review as { decision?: string; at?: string } | null;
      return { id: String(m.id), parentId: String(m.parent_id), parentTitle: titles.get(String(m.parent_id)) ?? null, idx: Number(m.idx), title: String(m.title), amountWei: whole(m.amount), status: String(m.status), approvedAt: review?.decision === "approve" ? review.at ?? null : null, reviewDecision: review?.decision ?? null };
    }),
    payments: (tx.data ?? []).map((t: Record<string, unknown>) => ({
      id: String(t.id), state: String(t.state), recipient: String(t.recipient), amountWei: whole(t.amount),
      invoiceId: ((t.evaluation as { invoice_id?: string } | null)?.invoice_id) ?? null, source: String(t.source), createdAt: String(t.created_at),
    })),
    treasury,
    // The active policy version is read from the PolicyManager contract; null (nothing active) holds every payment.
    policy: { version: policyVersion, requiredApprovals: flags.requiredAdminApprovals, liveReady: flags.ready && flags.switchOn, emergencyStop: flags.emergencyStop },
  };
}

/** The vault, the payment agent's rule and each recipient's approval, read from the chain now. */
async function treasuryRead(recipients: string[]): Promise<{ treasury: TreasuryRead; policyVersion: number | null }> {
  const v = await vaultSnapshot();
  if (!v.ok) return { treasury: { ok: false, error: v.error, recipientApproved: {} }, policyVersion: null };
  const pv = v.policyVersion && Number(v.policyVersion) > 0 ? Number(v.policyVersion) : null;
  const want = process.env.LIVE_AGENT_ADDRESS?.trim().toLowerCase();
  const native = v.rules.filter((r) => r.token.toLowerCase() === NATIVE);
  const rule = (want ? native.find((r) => r.agent.toLowerCase() === want) : undefined) ?? native.find((r) => r.active) ?? native[0];
  const evm = reader().evm;
  const approved: Record<string, boolean> = {};
  try {
    await Promise.all(recipients.map(async (r) => {
      approved[r] = (await evm.readContract({ address: DEPLOYED.TreasuryVault, abi: treasuryVaultAbi, functionName: "approvedRecipient", args: [r as `0x${string}`] })) as boolean;
    }));
  } catch (e) {
    return { treasury: { ok: false, error: `could not read approved recipients: ${e instanceof Error ? e.message : String(e)}`, recipientApproved: {} }, policyVersion: pv };
  }
  return {
    policyVersion: pv,
    treasury: {
      ok: true, readAtBlock: v.readAtBlock, balanceWei: (v.balance ?? 0n).toString(),
      agentActive: !!rule && rule.active && rule.validUntil * 1000 > Date.now(),
      perTxCapWei: rule ? rule.perTxCap.toString() : "0", remainingDailyWei: rule ? rule.remainingToday.toString() : "0",
      recipientApproved: approved,
    },
  };
}
