import { encodeFunctionData, type Hex } from "viem";
import { paymentDigestV2, sortSigs, treasuryVaultV2Abi, verifyApprovalV2, type V2AdminSig, type V2Payment } from "./v2";

/**
 * Executes ONE V2 payment that administrators have signed. Everything it touches is injected (tested in
 * v2-executor.test.ts without a network or a key).
 *
 *   1. claim       the database moves APPROVED -> READY once (enough recorded signatures, unexpired). A retry cannot pay twice,
 *                  and the vault refuses an already-executed digest anyway.
 *   2. re-derive   the payment and its digest are rebuilt from the stored fields and compared with the stored digest and the
 *                  vault's own paymentDigest(). Any difference is a security alert, not a payment.
 *   3. re-verify   every stored signature is checked again against the signer's key read from QoreChain, and each signer
 *                  must be an administrator on the vault now. The vault checks them a third time on chain.
 *   4. simulate    eth_call as the agent. The contract decides; a rejection is recorded and nothing is sent.
 *   5. send        the agent sends executePayment(payment, signatures) inside a short window that admits only the V2 vault.
 *   6. verify      the receipt must hold the vault's PaymentExecuted event for THIS digest before the payment is CONFIRMED.
 * The server holds no administrator key and cannot add a valid signature: it can only relay the ones it was given.
 */

export interface V2Row {
  id: string; organization_id: string; state: string; vault_version: number; vault_address: string | null;
  payment_hash: Hex; token: string; recipient: string; amount: string; purpose_hash: Hex; policy_version: number; nonce: string;
  expires_at: string; agent_account: string; required_approvals: number;
}

export interface V2Db {
  claim(id: string): Promise<V2Row>;
  signatures(id: string): Promise<V2AdminSig[]>;
  recordSubmitted(id: string, txHash: Hex): Promise<void>;
  recordOutcome(id: string, ok: boolean, block: bigint | null, reason: string | null): Promise<void>;
  recordFailure(id: string, reason: string): Promise<void>;
  alert(orgId: string, kind: string, id: string, detail: Record<string, unknown>): Promise<void>;
}

export interface V2Chain {
  chainId: bigint;
  vaultDigest(vault: Hex, agent: Hex, p: V2Payment): Promise<Hex>;
  isAdmin(vault: Hex, who: Hex): Promise<boolean>;
  /** The account's registered ML-DSA-87 public key, only if registered with a proven possession; otherwise null. */
  provenKey(who: Hex): Promise<Uint8Array | null>;
  executed(vault: Hex, digest: Hex): Promise<boolean>;
  simulate(vault: Hex, agent: Hex, p: V2Payment, sigs: V2AdminSig[]): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Waits for the receipt and returns the digests of PaymentExecuted events the vault emitted in it. */
  receipt(tx: Hex, vault: Hex): Promise<{ status: "success" | "reverted"; block: bigint | null; executedDigests: Hex[] }>;
}

export interface V2Agent {
  address: Hex;
  /** Sends exactly `data` to `to` with value 0. */
  send(to: Hex, data: Hex): Promise<Hex>;
  windows: { ensureOpen(needTxs?: number): Promise<string | null>; close(): Promise<string | null> };
}

export interface V2Deps { db: V2Db; chain: V2Chain; agent: V2Agent; vault: Hex }

export type V2Result =
  | { state: "CONFIRMED"; txHash: Hex; block: bigint | null; signers: Hex[] }
  | { state: "FAILED"; reason: string; txHash?: Hex };

export function paymentFromRow(r: V2Row): V2Payment {
  return {
    token: r.token as Hex, to: r.recipient as Hex, amount: BigInt(r.amount), purposeHash: r.purpose_hash,
    policyVersion: BigInt(r.policy_version), expiry: BigInt(Math.floor(new Date(r.expires_at).getTime() / 1000)), nonce: BigInt(r.nonce),
  };
}

export function executePaymentCalldata(p: V2Payment, sigs: V2AdminSig[]): Hex {
  return encodeFunctionData({ abi: treasuryVaultV2Abi, functionName: "executePayment", args: [p, sigs] });
}

export async function executeV2Payment(d: V2Deps, id: string): Promise<V2Result> {
  const row = await d.db.claim(id); // throws unless APPROVED, unexpired, with enough recorded signatures
  const fail = async (reason: string): Promise<V2Result> => { await d.db.recordFailure(row.id, reason); return { state: "FAILED", reason }; };
  if (row.vault_version !== 2) return fail("Not a V2 payment.");
  if (!row.vault_address || row.vault_address.toLowerCase() !== d.vault.toLowerCase()) {
    await d.db.alert(row.organization_id, "v2_vault_mismatch", row.id, { stored: row.vault_address, configured: d.vault });
    return fail("The payment names a different vault than the one this server is configured for.");
  }
  const agent = row.agent_account as Hex;
  if (agent.toLowerCase() !== d.agent.address.toLowerCase()) {
    await d.db.alert(row.organization_id, "agent_mismatch", row.id, { stored: agent, configured: d.agent.address });
    return fail("The payment names a different agent than the one the server is configured to use.");
  }

  // 2. re-derive
  const p = paymentFromRow(row);
  const local = paymentDigestV2(d.chain.chainId, d.vault, agent, p);
  if (local.toLowerCase() !== row.payment_hash.toLowerCase()) {
    await d.db.alert(row.organization_id, "v2_digest_mismatch", row.id, { stored: row.payment_hash, derived: local });
    return fail("The stored payment does not match its digest. Nothing was sent.");
  }
  const onChain = await d.chain.vaultDigest(d.vault, agent, p);
  if (onChain.toLowerCase() !== local.toLowerCase()) {
    await d.db.alert(row.organization_id, "v2_digest_mismatch", row.id, { onChain, derived: local });
    return fail("The vault computes a different digest for this payment. Nothing was sent.");
  }
  if (await d.chain.executed(d.vault, local)) return fail("The vault says this exact payment has already been executed.");

  // 3. re-verify every signature
  let sigs: V2AdminSig[];
  try { sigs = sortSigs(await d.db.signatures(row.id)); } catch (e) { return fail(`Stored signatures are not usable: ${e instanceof Error ? e.message : String(e)}`); }
  const good: V2AdminSig[] = [];
  for (const s of sigs) {
    if (!(await d.chain.isAdmin(d.vault, s.signer))) continue;
    const key = await d.chain.provenKey(s.signer);
    if (key && verifyApprovalV2(key, local, s.signature)) good.push(s);
  }
  if (good.length < row.required_approvals) {
    await d.db.alert(row.organization_id, "v2_signatures_invalid", row.id, { stored: sigs.length, valid: good.length, required: row.required_approvals });
    return fail(`Only ${good.length} of the ${row.required_approvals} required administrator signatures verify now. Nothing was sent.`);
  }

  // 4. simulate as the agent
  const sim = await d.chain.simulate(d.vault, agent, p, good);
  if (!sim.ok) {
    await d.db.alert(row.organization_id, "contract_rejected", row.id, { error: sim.error, vault: "v2" });
    return fail(`The vault rejected this payment: ${sim.error}. Nothing was sent.`);
  }

  // 5. send inside a short vault-only window, 6. verify
  let txHash: Hex | undefined;
  try {
    await d.agent.windows.ensureOpen(1);
    txHash = await d.agent.send(d.vault, executePaymentCalldata(p, good));
    await d.db.recordSubmitted(row.id, txHash);
    const r = await d.chain.receipt(txHash, d.vault);
    if (r.status === "success" && r.executedDigests.some((h) => h.toLowerCase() === local.toLowerCase())) {
      await d.db.recordOutcome(row.id, true, r.block, null);
      return { state: "CONFIRMED", txHash, block: r.block, signers: good.map((s) => s.signer) };
    }
    const reason = r.status === "success" ? "The transaction succeeded but the vault's PaymentExecuted event for this digest was not found, so it is not reported as paid." : "The transaction reverted.";
    await d.db.recordOutcome(row.id, false, r.block, reason);
    return { state: "FAILED", reason, txHash };
  } catch (e) {
    const reason = `Submission error: ${e instanceof Error ? e.message : String(e)}`;
    if (txHash) { await d.db.recordOutcome(row.id, false, null, reason); return { state: "FAILED", reason, txHash }; }
    return fail(reason);
  } finally {
    await d.agent.windows.close().catch(() => undefined);
  }
}
