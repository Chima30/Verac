import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { liveStatusFlags } from "./config";
import { v2Flags } from "./v2";
import type { LiveOp, V2Status } from "@/components/live/live-payments";

const COLS = "id,state,recipient,amount,required_approvals,requested_by,payment_hash,tx_hash,onchain_approval_tx,block_number,failure_reason,evaluation,expires_at";

/** Live operations for the signed-in user's organisation, read through row-level security. */
export async function liveOperations(): Promise<{ signedIn: boolean; role: string | null; ops: LiveOp[]; status: { switchOn: boolean; ready: boolean; missing: string[] }; v2: V2Status }> {
  const f = liveStatusFlags();
  const status = { switchOn: f.switchOn, ready: f.ready, missing: f.missing };
  const vf = v2Flags();
  const v2: V2Status = { ready: vf.ready, switchOn: vf.switchOn, vault: vf.vault };
  const s = await getSession();
  if (!s.user || !s.org) return { signedIn: false, role: null, ops: [], status, v2 };
  const sb = await supabaseServer();
  if (!sb) return { signedIn: false, role: null, ops: [], status, v2 };
  const base = () => sb.from("transactions").select(`${COLS},vault_version`).eq("organization_id", s.org!.id).eq("source", "LIVE_TESTNET").not("calldata_hash", "is", null).order("created_at", { ascending: false }).limit(20);
  let { data, error } = await base();
  if (error) // before migration 0018 (no vault_version column): read the V1 columns only
    ({ data } = (await sb.from("transactions").select(COLS).eq("organization_id", s.org.id).eq("source", "LIVE_TESTNET").not("calldata_hash", "is", null).order("created_at", { ascending: false }).limit(20)) as unknown as { data: typeof data; error: typeof error });
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const ids = rows.map((r) => r.id as string);
  const { data: ap } = ids.length
    ? await sb.from("approvals").select("subject_id,decision").eq("subject_type", "transaction").in("subject_id", ids).eq("decision", "approve")
    : { data: [] as Array<{ subject_id: string; decision: string }> };
  const count = new Map<string, number>();
  for (const a of ap ?? []) count.set(a.subject_id as string, (count.get(a.subject_id as string) ?? 0) + 1);
  const v2Ids = rows.filter((r) => Number(r.vault_version ?? 1) === 2).map((r) => r.id as string);
  const signers = new Map<string, string[]>();
  if (v2Ids.length) {
    const { data: sg } = await sb.from("v2_signatures").select("transaction_id,signer_address").in("transaction_id", v2Ids);
    for (const x of sg ?? []) signers.set(x.transaction_id as string, [...(signers.get(x.transaction_id as string) ?? []), x.signer_address as string]);
  }
  const ops: LiveOp[] = rows.map((r) => {
    const id = r.id as string;
    return {
      id, state: r.state as string, recipient: r.recipient as string, amount: String(r.amount), required: r.required_approvals as number,
      approvals: count.get(id) ?? 0, requestedByMe: r.requested_by === s.user!.id,
      paymentHash: r.payment_hash as string, txHash: (r.tx_hash as string | null) ?? null, approvalTx: (r.onchain_approval_tx as string | null) ?? null,
      block: r.block_number ? Number(r.block_number) : null, failure: (r.failure_reason as string | null) ?? null,
      purpose: (r.evaluation as { purpose?: string } | null)?.purpose ?? null, expiresAt: r.expires_at as string,
      vaultVersion: Number(r.vault_version ?? 1) === 2 ? 2 : 1, signers: signers.get(id) ?? [],
    };
  });
  return { signedIn: true, role: s.org.role, ops, status, v2 };
}
