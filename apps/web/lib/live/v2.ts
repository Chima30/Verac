/**
 * SERVER ONLY. TreasuryVault V2 on the website: payments approved by administrators' own ML-DSA-87 signatures.
 *
 * The server holds the V2 AGENT key (capped on the vault) and nothing else for V2: no administrator key. It proposes a
 * payment, hands administrators a signing request, checks each signature they send back against the key QoreChain has on
 * record for them, and relays the signatures to the vault, which checks them again on chain.
 *
 * Environment (server-only): V2_VAULT_ADDRESS, V2_AGENT_EVM_PRIVATE_KEY, V2_AGENT_MLDSA_PUBLIC_KEY, V2_AGENT_MLDSA_SECRET_KEY,
 * SUPABASE_SERVICE_ROLE_KEY. The same LIVE_EXECUTION_ENABLED / LIVE_EMERGENCY_STOP switches apply.
 */
import { createHash, randomBytes } from "node:crypto";
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import {
  ChainExecution, checkSignatureV2, envKillSwitch, executeV2Payment, paymentDigestV2, provenKeyOf, sortSigs, toSigningRequest, treasuryVaultV2Abi,
  v2AgentAdapter, v2ChainAdapter, type V2AdminSig, type V2Db, type V2Payment, type V2Row,
} from "@qoreops/qorechain";
import { ProposeSchema, parseQor } from "./schema";
import { dbAdapter, serviceClient, type RpcClient } from "./service";

const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const CHAIN_ID = 9800n;
export const V2_REQUIRED_ENV = ["SUPABASE_SERVICE_ROLE_KEY", "V2_VAULT_ADDRESS", "V2_AGENT_EVM_PRIVATE_KEY", "V2_AGENT_MLDSA_PUBLIC_KEY", "V2_AGENT_MLDSA_SECRET_KEY"] as const;

export function v2Flags(env: Record<string, string | undefined> = process.env) {
  const missing = V2_REQUIRED_ENV.filter((k) => !env[k]?.trim());
  const vault = env.V2_VAULT_ADDRESS?.trim();
  return { ready: missing.length === 0 && !!vault && /^0x[0-9a-fA-F]{40}$/.test(vault), switchOn: envKillSwitch(env).enabled(), missing: [...missing], vault: vault ? getAddress(vault) : null };
}

const evm = () => new ChainExecution().evm;
const vaultRead = <T>(vault: Hex, functionName: string, args: readonly unknown[] = []) =>
  evm().readContract({ address: vault, abi: treasuryVaultV2Abi, functionName, args } as never) as Promise<T>;

/** The agent account the server signs for. Its key never leaves this module. */
function agentAccount(env = process.env) {
  const key = env.V2_AGENT_EVM_PRIVATE_KEY!.trim() as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("V2_AGENT_EVM_PRIVATE_KEY is not a 32-byte hex key.");
  return { key, account: privateKeyToAccount(key) };
}

/** Reads an account's registered ML-DSA-87 key (PQC Key Status precompile), or null. */
export const provenKey = (who: Hex) => provenKeyOf(evm(), who);

export type ProposeV2Outcome = { ok: true; id: string; digest: Hex; required: number; expiresAt: string } | { ok: false; status: number; error: string };

/** Checks the request against the live V2 vault, then records it awaiting administrator signatures. Sends nothing. */
export async function proposeLivePaymentV2(userClient: RpcClient, orgId: string, raw: unknown, context: Record<string, unknown> = {}): Promise<ProposeV2Outcome> {
  const parsed = ProposeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const f = v2Flags();
  if (!f.ready || !f.switchOn) return { ok: false, status: 503, error: "TreasuryVault V2 is not configured or live execution is switched off." };
  const vault = f.vault!;
  const { recipient, amountQor, purpose, idempotencyKey } = parsed.data;
  const amount = parseQor(amountQor);
  if (amount <= 0n || amount > 10n * 10n ** 18n) return { ok: false, status: 422, error: "Live payments are limited to 10 QOR each." };
  const agent = agentAccount().account.address;
  const reject = (error: string) => ({ ok: false as const, status: 422, error });

  const [limits, remaining, approved, policyVersion, threshold, paused] = await Promise.all([
    vaultRead<readonly [boolean, bigint, bigint, bigint]>(vault, "limits", [agent, NATIVE]),
    vaultRead<bigint>(vault, "remainingDaily", [agent, NATIVE]),
    vaultRead<boolean>(vault, "approvedRecipient", [recipient]),
    vaultRead<bigint>(vault, "policyVersion"),
    vaultRead<number>(vault, "threshold"),
    vaultRead<boolean>(vault, "paused"),
  ]);
  if (paused) return reject("TreasuryVault V2 is paused by its guardian.");
  if (!limits[0] || limits[1] < BigInt(Math.floor(Date.now() / 1000))) return reject("The agent's spending rights on TreasuryVault V2 are not active.");
  if (!approved) return reject("This recipient is not approved on TreasuryVault V2. Only two administrators together can approve a recipient.");
  if (amount > limits[2]) return reject(`This is above the agent's per-payment cap on V2 (${Number(limits[2] / 10n ** 12n) / 1e6} QOR).`);
  if (amount > remaining) return reject("This is above the agent's remaining daily allowance on V2.");

  const expiry = BigInt(Math.floor(Date.now() / 1000) + 6 * 3600);
  const p: V2Payment = {
    token: NATIVE, to: getAddress(recipient), amount, purposeHash: `0x${createHash("sha256").update(purpose).digest("hex")}`,
    policyVersion, expiry, nonce: BigInt(`0x${randomBytes(12).toString("hex")}`),
  };
  const digest = paymentDigestV2(CHAIN_ID, vault, agent, p);
  const onChain = await vaultRead<Hex>(vault, "paymentDigest", [agent, p]);
  if (onChain.toLowerCase() !== digest.toLowerCase()) return { ok: false, status: 500, error: "The vault computes a different digest; refusing to create the request." };

  const { data, error } = await userClient.rpc("request_live_payment_v2", {
    p_org: orgId, p_idempotency_key: idempotencyKey, p_agent_account: agent, p_vault: vault, p_digest: digest, p_token: NATIVE, p_recipient: p.to,
    p_amount: amount.toString(), p_purpose_hash: p.purposeHash, p_policy_version: Number(policyVersion), p_nonce: p.nonce.toString(),
    p_expires_at: new Date(Number(expiry) * 1000).toISOString(), p_required: threshold,
    p_evaluation: { ...context, purpose, vault: "TreasuryVaultV2", onChain: { perTxCap: limits[2].toString(), remainingDaily: remaining.toString(), recipientApproved: approved, threshold } },
  });
  if (error) return { ok: false, status: /duplicate key|unique/.test(error.message) ? 409 : 400, error: /duplicate key|unique/.test(error.message) ? "This request was already submitted." : error.message };
  return { ok: true, id: data as string, digest, required: threshold, expiresAt: new Date(Number(expiry) * 1000).toISOString() };
}

/** Reads a V2 row with the exact amount and nonce as text (JSON numbers would round a 96-bit nonce). */
async function readV2Row(id: string, orgId?: string): Promise<V2Row | null> {
  const sb = serviceClient();
  let q = sb.from("transactions").select("id,organization_id,state,vault_version,vault_address,payment_hash,token,recipient,purpose_hash,policy_version,expires_at,agent_account,required_approvals,amount::text,nonce::text,evaluation").eq("id", id);
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q.maybeSingle();
  return (data as unknown as V2Row | null) ?? null;
}

/** What an administrator's signing tool needs. Every field is public; the tool recomputes the digest itself before signing. */
export async function signingRequest(id: string, orgId: string) {
  const r = await readV2Row(id, orgId);
  if (!r || Number(r.vault_version) !== 2) return null;
  return toSigningRequest(r as V2Row & { evaluation?: { purpose?: string } | null });
}

export const SignatureSubmission = z.object({
  signer: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  digest: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{9254}$/, "An ML-DSA-87 signature is 4,627 bytes (9,254 hex characters)."),
});

export type SubmitOutcome = { ok: true; signatures: number; required: number; state: string } | { ok: false; status: number; error: string };

/** Verifies an administrator's signature against their on-chain key before recording it. */
export async function submitSignatureV2(userId: string, orgId: string, id: string, raw: unknown): Promise<SubmitOutcome> {
  const parsed = SignatureSubmission.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid signature file." };
  const f = v2Flags();
  if (!f.vault) return { ok: false, status: 503, error: "TreasuryVault V2 is not configured." };
  const r = await readV2Row(id, orgId);
  if (!r || Number(r.vault_version) !== 2) return { ok: false, status: 404, error: "V2 payment not found." };
  if (r.state !== "AWAITING_APPROVAL") return { ok: false, status: 409, error: `This payment is ${r.state} and takes no more signatures.` };
  const vault = getAddress(r.vault_address!);
  if (vault !== f.vault) return { ok: false, status: 409, error: "This payment belongs to a different vault than the one configured." };
  const check = await checkSignatureV2(evm(), vault, r, parsed.data);
  if (!check.ok) return { ok: false, status: 422, error: check.error };
  const { signer, digest } = check;

  const { data, error } = await serviceClient().rpc("v2_record_signature", { p_tx: id, p_signer: signer.toLowerCase(), p_digest: digest, p_signature: parsed.data.signature.toLowerCase(), p_submitted_by: userId });
  if (error) return { ok: false, status: /duplicate key|unique/.test(error.message) ? 409 : 422, error: /duplicate key|unique/.test(error.message) ? "This administrator has already signed this payment." : error.message };
  const after = await readV2Row(id, orgId);
  return { ok: true, signatures: Number(data), required: r.required_approvals, state: after?.state ?? r.state };
}

/** Executes an APPROVED V2 payment: relays the recorded signatures from the agent, inside a vault-only window. */
export async function runLiveExecutionV2(id: string) {
  const f = v2Flags();
  if (!f.ready || !f.switchOn) throw new Error("TreasuryVault V2 execution is not configured or is switched off.");
  const vault = f.vault!;
  const { key } = agentAccount();
  const kill = envKillSwitch();
  const x = new ChainExecution();
  const v1 = dbAdapter();
  const sb = serviceClient();

  const db: V2Db = {
    claim: async (txId) => {
      await v1.claim(txId); // live_claim_execution: APPROVED -> READY once, with enough recorded signatures
      const r = await readV2Row(txId);
      if (!r) throw new Error("payment disappeared after claim");
      return r;
    },
    signatures: async (txId) => {
      const { data, error } = await sb.from("v2_signatures").select("signer_address,signature,digest").eq("transaction_id", txId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((s) => ({ signer: getAddress(s.signer_address as string), signature: s.signature as Hex }));
    },
    recordSubmitted: v1.recordSubmitted, recordOutcome: v1.recordOutcome, recordFailure: v1.recordFailure, alert: v1.alert,
  };
  const chain = v2ChainAdapter(x.evm);
  const agent = v2AgentAdapter({ evm: x.evm, privateKey: key, mlDsa87PublicKey: process.env.V2_AGENT_MLDSA_PUBLIC_KEY!.trim(), mlDsa87SecretKey: process.env.V2_AGENT_MLDSA_SECRET_KEY!.trim(), vault, kill });
  return executeV2Payment({ db, chain, agent, vault }, id);
}

/** Signer addresses recorded for each V2 payment (for the Approvals list). */
export async function v2SignersByTx(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const { data } = await serviceClient().from("v2_signatures").select("transaction_id,signer_address").in("transaction_id", ids);
  for (const s of data ?? []) out.set(s.transaction_id as string, [...(out.get(s.transaction_id as string) ?? []), s.signer_address as string]);
  return out;
}

export { sortSigs, type V2AdminSig };
