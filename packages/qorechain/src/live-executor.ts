import type { Hex } from "viem";
import { SignerRefusal, prepareCall, type PreparedCall } from "./signer";
import { toPaymentTuple, type PaymentTuple, type ReceiptVerdict, type SimulationResult } from "./execution";

/**
 * Executes ONE approved live operation. Everything it touches is injected, so the logic that decides whether money may
 * move is tested without a network or a key (live-executor.test.ts).
 *
 * Order of events, and what stops each step:
 *   1. claim        the database moves APPROVED -> READY once, only with enough approvals bound to this payment hash
 *                   and an unexpired operation. A second claim fails, so a retry cannot pay twice.
 *   2. re-derive    the payment hash and the calldata hash are recomputed from the stored fields and compared with the
 *                   stored ones and with the vault's own paymentHash(). Any difference is a security alert, not a payment.
 *   3. approve      if the vault needs an on-chain approval, the APPROVER key relays it (separate key from the agent).
 *   4. simulate     eth_call as the agent. The contract's own verdict decides; a rejection is recorded and nothing is sent.
 *   5. send         the AGENT key sends executePayment or fundEscrow inside a short window that admits only the vault.
 *   6. verify       the receipt is read back and the vault's event for THIS payment hash must be present. Only then is
 *                   the operation CONFIRMED. A revert is FAILED with the contract's error.
 * The window is closed afterwards whatever happened.
 */

export interface LiveRow {
  id: string; organization_id: string; state: string; kind: "payment" | "escrow_fund";
  payment_hash: Hex; calldata_hash: Hex; token: string; recipient: string; amount: string; purpose_hash: Hex;
  policy_version: number; nonce: string; expires_at: string; agent_account: string; project_id: string | null;
}

export interface ExecutorDb {
  claim(id: string): Promise<LiveRow>;
  recordRelay(id: string, txHash: Hex): Promise<void>;
  recordSubmitted(id: string, txHash: Hex): Promise<void>;
  recordOutcome(id: string, ok: boolean, block: bigint | null, reason: string | null): Promise<void>;
  recordFailure(id: string, reason: string): Promise<void>;
  alert(orgId: string, kind: string, id: string, detail: Record<string, unknown>): Promise<void>;
}

export interface ExecutorChain {
  vaultPaymentHash(agent: `0x${string}`, p: PaymentTuple): Promise<Hex>;
  approvalsRequired(agent: `0x${string}`, p: PaymentTuple): Promise<number>;
  onChainApprovals(hash: Hex): Promise<number>;
  alreadyExecuted(hash: Hex): Promise<boolean>;
  simulateExecutePayment(agent: `0x${string}`, p: PaymentTuple): Promise<SimulationResult>;
  simulateFundEscrow(agent: `0x${string}`, p: PaymentTuple, projectId: bigint): Promise<SimulationResult>;
  simulateApprovePayment(approver: `0x${string}`, agent: `0x${string}`, p: PaymentTuple): Promise<SimulationResult>;
  waitForReceipt(hash: Hex): Promise<ReceiptVerdict>;
}

export interface ExecutorSigner {
  address: `0x${string}`;
  send(call: PreparedCall, expiry?: bigint): Promise<Hex>;
  windows: { ensureOpen(needTxs?: number): Promise<string | null>; close(): Promise<string | null> };
}

export interface ExecutorDeps { db: ExecutorDb; chain: ExecutorChain; agent: ExecutorSigner; approver: ExecutorSigner; now(): number }

export type ExecutionResult =
  | { state: "CONFIRMED"; txHash: Hex; approvalTxHash?: Hex; block: bigint | null }
  | { state: "FAILED"; reason: string; txHash?: Hex; approvalTxHash?: Hex };

const fail = async (d: ExecutorDeps, row: LiveRow, reason: string, extra: { txHash?: Hex; approvalTxHash?: Hex } = {}): Promise<ExecutionResult> => {
  await d.db.recordFailure(row.id, reason);
  return { state: "FAILED", reason, ...extra };
};

export async function executeLiveOperation(d: ExecutorDeps, id: string): Promise<ExecutionResult> {
  const row = await d.db.claim(id); // throws unless APPROVED, unexpired and approved enough
  const payment = toPaymentTuple({ token: row.token, to: row.recipient, amount: row.amount, purposeHash: row.purpose_hash, policyVersion: row.policy_version, expiry: Math.floor(new Date(row.expires_at).getTime() / 1000), nonce: row.nonce });
  const agent = row.agent_account as `0x${string}`;

  // 2. re-derive and compare
  if (agent.toLowerCase() !== d.agent.address.toLowerCase()) {
    await d.db.alert(row.organization_id, "agent_mismatch", row.id, { stored: agent, configured: d.agent.address });
    return fail(d, row, "The operation names a different agent account than the one the server is configured to use.");
  }
  let execCall: PreparedCall;
  try { execCall = prepareCall(row.kind === "payment" ? { kind: "executePayment", payment } : { kind: "fundEscrow", payment, projectId: BigInt(row.project_id ?? "0") }); }
  catch (e) { return fail(d, row, e instanceof SignerRefusal ? e.message : "The signer refused this operation."); }
  if (execCall.calldataHash.toLowerCase() !== row.calldata_hash.toLowerCase()) {
    await d.db.alert(row.organization_id, "calldata_mismatch", row.id, { stored: row.calldata_hash, derived: execCall.calldataHash });
    return fail(d, row, "The call that would be sent does not match the call that was approved. Nothing was sent.");
  }
  const chainHash = await d.chain.vaultPaymentHash(agent, payment);
  if (chainHash.toLowerCase() !== row.payment_hash.toLowerCase()) {
    await d.db.alert(row.organization_id, "payment_hash_mismatch", row.id, { stored: row.payment_hash, onChain: chainHash });
    return fail(d, row, "The payment hash does not match the vault's. Nothing was sent.");
  }
  if (await d.chain.alreadyExecuted(chainHash)) return fail(d, row, "The vault says this exact payment has already been executed.");

  // 3. on-chain approval, relayed by the approver key
  let approvalTxHash: Hex | undefined;
  try {
    const need = await d.chain.approvalsRequired(agent, payment);
    if (need > 0 && (await d.chain.onChainApprovals(chainHash)) < need) {
      const sim = await d.chain.simulateApprovePayment(d.approver.address, agent, payment);
      if (!sim.ok) return fail(d, row, `The vault would reject the approval: ${sim.errorName ?? sim.message ?? "unknown"}.`);
      await d.approver.windows.ensureOpen(1);
      const call = prepareCall({ kind: "approvePayment", agent, payment });
      approvalTxHash = await d.approver.send(call, payment.expiry);
      await d.db.recordRelay(row.id, approvalTxHash);
      const r = await d.chain.waitForReceipt(approvalTxHash);
      if (r.status !== "success") return fail(d, row, r.failureReason ?? "The on-chain approval did not succeed.", { approvalTxHash });
    }
  } catch (e) {
    return fail(d, row, `Approval relay failed: ${e instanceof Error ? e.message : String(e)}`, { approvalTxHash });
  } finally {
    await d.approver.windows.close().catch(() => undefined);
  }

  // 4. simulate as the agent: the contract decides
  const sim = row.kind === "payment" ? await d.chain.simulateExecutePayment(agent, payment) : await d.chain.simulateFundEscrow(agent, payment, BigInt(row.project_id ?? "0"));
  if (!sim.ok) {
    await d.db.alert(row.organization_id, "contract_rejected", row.id, { error: sim.errorName ?? sim.message, args: sim.errorArgs?.map(String) });
    return fail(d, row, `The vault rejected this payment${sim.errorName ? `: ${sim.errorName}` : ""}. Nothing was sent.`, { approvalTxHash });
  }

  // 5. send inside a short window, 6. verify
  let txHash: Hex | undefined;
  try {
    await d.agent.windows.ensureOpen(1);
    txHash = await d.agent.send(execCall, payment.expiry);
    await d.db.recordSubmitted(row.id, txHash);
    const v = await d.chain.waitForReceipt(txHash);
    if (v.status === "success" && v.executedPaymentHashes.map((h) => h.toLowerCase()).includes(chainHash.toLowerCase())) {
      await d.db.recordOutcome(row.id, true, v.blockNumber ?? null, null);
      return { state: "CONFIRMED", txHash, approvalTxHash, block: v.blockNumber ?? null };
    }
    const reason = v.status === "success" ? "The transaction succeeded but the vault's event for this payment was not found, so it is not reported as paid." : (v.failureReason ?? "The transaction did not succeed.");
    await d.db.recordOutcome(row.id, false, v.blockNumber ?? null, reason);
    return { state: "FAILED", reason, txHash, approvalTxHash };
  } catch (e) {
    const reason = `Submission error: ${e instanceof Error ? e.message : String(e)}`;
    if (txHash) { await d.db.recordOutcome(row.id, false, null, reason); return { state: "FAILED", reason, txHash, approvalTxHash }; }
    return fail(d, row, reason, { approvalTxHash });
  } finally {
    await d.agent.windows.close().catch(() => undefined);
  }
}
