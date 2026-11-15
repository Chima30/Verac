import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { liveStatusFlags } from "./config";
import type { LiveOp } from "@/components/live/live-payments";

/** Live operations for the signed-in user's organisation, read through row-level security. */
export async function liveOperations(): Promise<{ signedIn: boolean; role: string | null; ops: LiveOp[]; status: { switchOn: boolean; ready: boolean; missing: string[] } }> {
  const f = liveStatusFlags();
  const status = { switchOn: f.switchOn, ready: f.ready, missing: f.missing };
  const s = await getSession();
  if (!s.user || !s.org) return { signedIn: false, role: null, ops: [], status };
  const sb = await supabaseServer();
  if (!sb) return { signedIn: false, role: null, ops: [], status };
  const { data } = await sb.from("transactions")
    .select("id,state,recipient,amount,required_approvals,requested_by,payment_hash,tx_hash,onchain_approval_tx,block_number,failure_reason,evaluation,expires_at")
    .eq("organization_id", s.org.id).eq("source", "LIVE_TESTNET").not("calldata_hash", "is", null).order("created_at", { ascending: false }).limit(20);
  const rows = data ?? [];
  const ids = rows.map((r) => r.id as string);
  const { data: ap } = ids.length
    ? await sb.from("approvals").select("subject_id,decision").eq("subject_type", "transaction").in("subject_id", ids).eq("decision", "approve")
    : { data: [] as Array<{ subject_id: string; decision: string }> };
  const count = new Map<string, number>();
  for (const a of ap ?? []) count.set(a.subject_id as string, (count.get(a.subject_id as string) ?? 0) + 1);
  const ops: LiveOp[] = rows.map((r) => ({
    id: r.id, state: r.state, recipient: r.recipient, amount: String(r.amount), required: r.required_approvals,
    approvals: count.get(r.id) ?? 0, requestedByMe: r.requested_by === s.user!.id,
    paymentHash: r.payment_hash, txHash: r.tx_hash ?? null, approvalTx: r.onchain_approval_tx ?? null,
    block: r.block_number ? Number(r.block_number) : null, failure: r.failure_reason ?? null,
    purpose: (r.evaluation as { purpose?: string } | null)?.purpose ?? null, expiresAt: r.expires_at,
  }));
  return { signedIn: true, role: s.org.role, ops, status };
}
