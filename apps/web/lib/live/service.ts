/** SERVER ONLY. Proposes, decides and executes live testnet operations. All money movement goes through executeLiveOperation. */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { DEPLOYED, SIGNER_LIMITS, executeLiveOperation, policyManagerAbi, prepareCall, toPaymentTuple, treasuryVaultAbi, type ExecutorDb, type Hex, type LiveRow } from "@qoreops/qorechain";
import { supabaseEnv } from "@/lib/supabase/config";
import { buildExecutorParts, chain, liveStatusFlags } from "./config";
import { ProposeSchema, parseQor } from "./schema";

const NATIVE = "0x0000000000000000000000000000000000000000" as const;

export { ProposeSchema, parseQor };

/** Service-role client. The key stays on the server; it can only reach the server-only functions through this module. */
export function serviceClient() {
  const env = supabaseEnv(), key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!env || !key) throw new Error("The server's database credentials are not configured (SUPABASE_SERVICE_ROLE_KEY).");
  return createClient(env.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function dbAdapter(): ExecutorDb {
  const sb = serviceClient();
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    claim: async (id) => (await call("live_claim_execution", { p_tx: id })) as LiveRow,
    recordRelay: async (id, h) => { await call("live_record_relay", { p_tx: id, p_hash: h }); },
    recordSubmitted: async (id, h) => { await call("live_record_submitted", { p_tx: id, p_hash: h }); },
    recordOutcome: async (id, ok, block, reason) => { await call("live_record_outcome", { p_tx: id, p_ok: ok, p_block: block === null ? null : Number(block), p_reason: reason }); },
    recordFailure: async (id, reason) => { await call("live_record_failure", { p_tx: id, p_reason: reason }); },
    alert: async (org, kind, id, detail) => { await call("live_raise_alert", { p_org: org, p_kind: kind, p_tx: id, p_detail: detail }); },
  };
}

/** The signed-in user's Supabase client: RLS and the SECURITY DEFINER functions decide what it may do. */
export interface RpcClient { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> }

export type ProposeOutcome = { ok: true; id: string; paymentHash: Hex; calldataHash: Hex; requiredApprovals: number; expiresAt: string } | { ok: false; status: number; error: string };

/** Checks the proposal against the REAL chain state, then records it as AWAITING_APPROVAL. Nothing is sent to the chain here. */
export async function proposeLivePayment(userClient: RpcClient, orgId: string, raw: unknown): Promise<ProposeOutcome> {
  const parsed = ProposeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const flags = liveStatusFlags();
  if (!flags.ready || !flags.switchOn) return { ok: false, status: 503, error: flags.emergencyStop ? "Live execution is stopped (emergency stop is on)." : "Live execution is switched off on this deployment." };
  const { recipient, amountQor, purpose, idempotencyKey } = parsed.data;
  const amount = parseQor(amountQor);
  if (amount <= 0n || amount > SIGNER_LIMITS.maxQorPerOperation) return { ok: false, status: 422, error: "Live payments are limited to 10 QOR each." };

  const parts = buildExecutorParts();
  const x = chain();
  const agent = parts.agent.address;
  const [state, approved, policyVersion] = await Promise.all([
    x.agentState(agent, NATIVE),
    x.evm.readContract({ address: DEPLOYED.TreasuryVault, abi: treasuryVaultAbi, functionName: "approvedRecipient", args: [recipient as `0x${string}`] }),
    x.evm.readContract({ address: DEPLOYED.PolicyManager, abi: policyManagerAbi, functionName: "activeVersion" }),
  ]);
  const reject = (error: string) => ({ ok: false as const, status: 422, error });
  if (!state.active || state.validUntil < BigInt(Math.floor(Date.now() / 1000))) return reject("The agent's spending rights on the vault are not active.");
  if (!approved) return reject("This recipient is not on the vault's approved list. The website cannot add recipients.");
  if (amount > state.perTxCap) return reject(`This is above the agent's on-chain per-payment cap (${Number(state.perTxCap / 10n ** 12n) / 1e6} QOR).`);
  if (amount > state.remainingDaily) return reject("This is above the agent's remaining daily allowance on chain.");
  if (policyVersion === 0n) return reject("No policy is active on the PolicyManager.");

  const expiry = Math.floor(Date.now() / 1000) + 2 * 3600;
  const nonce = BigInt("0x" + randomBytes(12).toString("hex"));
  const purposeHash = ("0x" + createHash("sha256").update(purpose).digest("hex")) as Hex;
  const payment = toPaymentTuple({ token: NATIVE, to: recipient, amount: amount.toString(), purposeHash, policyVersion: Number(policyVersion), expiry, nonce: nonce.toString() });
  const paymentHash = await x.vaultPaymentHash(agent, payment);
  const { calldataHash } = prepareCall({ kind: "executePayment", payment });
  const sim = await x.simulateExecutePayment(agent, payment);
  // Before approvals exist the vault answers InsufficientApprovals; that is expected. Any other rejection is final.
  if (!sim.ok && sim.errorName !== "InsufficientApprovals") return reject(`The vault would reject this payment: ${sim.errorName ?? sim.message}.`);

  const required = flags.requiredAdminApprovals;
  const { data, error } = await userClient.rpc("request_live_payment", {
    p_org: orgId, p_idempotency_key: idempotencyKey, p_kind: "payment", p_agent_account: agent, p_payment_hash: paymentHash, p_token: NATIVE, p_recipient: recipient,
    p_amount: amount.toString(), p_purpose_hash: purposeHash, p_policy_version: Number(policyVersion), p_nonce: nonce.toString(), p_expires_at: new Date(expiry * 1000).toISOString(),
    p_required: required, p_calldata_hash: calldataHash, p_project_id: null,
    p_evaluation: { purpose, simulatedBeforeApproval: sim.ok ? "ok" : sim.errorName, onChain: { perTxCap: state.perTxCap.toString(), remainingDaily: state.remainingDaily.toString(), recipientApproved: approved } },
  });
  if (error) return { ok: false, status: /duplicate key|unique/.test(error.message) ? 409 : 400, error: /duplicate key|unique/.test(error.message) ? "This request was already submitted." : error.message };
  return { ok: true, id: data as string, paymentHash, calldataHash, requiredApprovals: required, expiresAt: new Date(expiry * 1000).toISOString() };
}

export async function runLiveExecution(id: string) {
  const parts = buildExecutorParts();
  return executeLiveOperation({ db: dbAdapter(), chain: parts.chain, agent: parts.agent, approver: parts.approver, now: () => Date.now() }, id);
}
