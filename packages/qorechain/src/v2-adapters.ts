/**
 * Real-chain adapters for the V2 executor, shared by the website (apps/web/lib/live/v2.ts) and the end-to-end script, so
 * both run identical code. Also: the signing-request format and the signature check the website applies on upload.
 */
import { createWalletClient, decodeEventLog, getAddress, http, parseAbi, toFunctionSelector, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { qoreDianaTestnet } from "./index";
import type { KillSwitch } from "./signer";
import { WindowManager } from "./window";
import { paymentDigestV2, treasuryVaultV2Abi, verifyApprovalV2, type V2Payment } from "./v2";
import { paymentFromRow, type V2Agent, type V2Chain, type V2Row } from "./v2-executor";

export const V2_CHAIN_ID = 9800n;
const PQC_STATUS = "0x0000000000000000000000000000000000000a02" as const;
const pqcStatusAbi = parseAbi(["function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)"]);

export const vaultReadV2 = <T>(evm: PublicClient, vault: Hex, functionName: string, args: readonly unknown[] = []) =>
  evm.readContract({ address: vault, abi: treasuryVaultV2Abi, functionName, args } as never) as Promise<T>;

/** An account's registered ML-DSA-87 key via QoreChain's PQC Key Status precompile (the source the vault uses), or null. */
export async function provenKeyOf(evm: PublicClient, who: Hex): Promise<Uint8Array | null> {
  const [registered, alg, pubkey, proven] = await evm.readContract({ address: PQC_STATUS, abi: pqcStatusAbi, functionName: "pqcKeyStatus", args: [who] });
  if (!registered || alg !== 1 || !proven || pubkey.length !== 2 + 2 * 2592) return null;
  return Uint8Array.from(Buffer.from(pubkey.slice(2), "hex"));
}

export function v2ChainAdapter(evm: PublicClient): V2Chain {
  return {
    chainId: V2_CHAIN_ID,
    vaultDigest: (v, a, p) => vaultReadV2<Hex>(evm, v, "paymentDigest", [a, p]),
    isAdmin: (v, who) => vaultReadV2<boolean>(evm, v, "isAdmin", [who]),
    provenKey: (who) => provenKeyOf(evm, who),
    executed: (v, d) => vaultReadV2<boolean>(evm, v, "executed", [d]),
    simulate: async (v, a, p, sigs) => {
      try { await evm.simulateContract({ account: a, address: v, abi: treasuryVaultV2Abi, functionName: "executePayment", args: [p, sigs] }); return { ok: true }; }
      catch (e) { const m = e instanceof Error ? e.message : String(e); return { ok: false, error: /Error: (\w+\([^)]*\))/.exec(m)?.[1] ?? m.split("\n")[0]!.slice(0, 200) }; }
    },
    receipt: async (tx, v) => {
      const r = await evm.waitForTransactionReceipt({ hash: tx, timeout: 120_000, pollingInterval: 2_000 });
      const digests: Hex[] = [];
      for (const l of r.logs) {
        if (l.address.toLowerCase() !== v.toLowerCase()) continue;
        try { const e = decodeEventLog({ abi: treasuryVaultV2Abi, data: l.data, topics: l.topics }); if (e.eventName === "PaymentExecuted") digests.push((e.args as { paymentDigest: Hex }).paymentDigest); } catch { /* other events */ }
      }
      return { status: r.status, block: r.blockNumber ?? null, executedDigests: digests };
    },
  };
}

/** The V2 agent: can only send `executePayment` call data, with value 0, to the one configured V2 vault. */
export function v2AgentAdapter(o: { evm: PublicClient; privateKey: Hex; mlDsa87PublicKey: string; mlDsa87SecretKey: string; vault: Hex; kill: KillSwitch }): V2Agent {
  if (!/^0x[0-9a-fA-F]{64}$/.test(o.privateKey)) throw new Error("The V2 agent key is not a 32-byte hex key.");
  const account = privateKeyToAccount(o.privateKey);
  const wallet = createWalletClient({ account, chain: qoreDianaTestnet, transport: http(QORE_NETWORK.evmRpc) });
  const windows = new WindowManager({ secp256k1PrivateKey: o.privateKey, mlDsa87PublicKey: o.mlDsa87PublicKey, mlDsa87SecretKey: o.mlDsa87SecretKey }, o.kill, undefined, o.vault);
  return {
    address: account.address,
    send: async (to, data) => {
      if (!o.kill.enabled()) throw new Error("Live execution is switched off.");
      if (to.toLowerCase() !== o.vault.toLowerCase()) throw new Error("The V2 agent may only call the configured V2 vault.");
      if (!data.toLowerCase().startsWith(EXECUTE_PAYMENT_SELECTOR)) throw new Error("The V2 agent only sends executePayment.");
      const gasPrice = await o.evm.getGasPrice();
      const gas = await o.evm.estimateGas({ account, to, data, value: 0n });
      return wallet.sendTransaction({ to, data, value: 0n, gas: (gas * 13n) / 10n, gasPrice, type: "legacy" } as never);
    },
    windows: { ensureOpen: (n) => windows.ensureOpen(n), close: () => windows.close() },
  };
}
export const EXECUTE_PAYMENT_SELECTOR = toFunctionSelector("executePayment((address,address,uint256,bytes32,uint64,uint64,uint256),(address,bytes)[])").toLowerCase();

/** The file an administrator's signing tool reads. Public payment fields only. */
export function toSigningRequest(r: V2Row & { evaluation?: { purpose?: string } | null }) {
  const p = paymentFromRow(r);
  return {
    format: "verac-v2-signing-request/1", network: "qorechain-diana", chainId: Number(V2_CHAIN_ID), vault: r.vault_address, agent: r.agent_account,
    transactionId: r.id, digest: r.payment_hash, requiredSignatures: r.required_approvals,
    payment: { token: p.token, to: p.to, amount: p.amount.toString(), purposeHash: p.purposeHash, policyVersion: p.policyVersion.toString(), expiry: p.expiry.toString(), nonce: p.nonce.toString() },
    readable: { amountQor: Number(p.amount / 10n ** 12n) / 1e6, recipient: p.to, purpose: r.evaluation?.purpose ?? null, expiresAt: r.expires_at },
  };
}

export type SignatureCheck = { ok: true; signer: Hex; digest: Hex } | { ok: false; error: string };

/** What the website checks before recording an uploaded signature. The vault checks it again on chain when paying. */
export async function checkSignatureV2(evm: PublicClient, vault: Hex, row: V2Row, sub: { signer: string; digest: string; signature: string }): Promise<SignatureCheck> {
  const digest = paymentDigestV2(V2_CHAIN_ID, vault, row.agent_account as Hex, paymentFromRow(row));
  if (digest.toLowerCase() !== row.payment_hash.toLowerCase()) return { ok: false, error: "The stored payment does not match its digest; refusing." };
  if (sub.digest.toLowerCase() !== digest.toLowerCase()) return { ok: false, error: "This signature is for a different payment." };
  const signer = getAddress(sub.signer);
  if (!(await vaultReadV2<boolean>(evm, vault, "isAdmin", [signer]))) return { ok: false, error: `${signer} is not an administrator on TreasuryVault V2.` };
  const key = await provenKeyOf(evm, signer);
  if (!key) return { ok: false, error: `${signer} has no ML-DSA-87 key registered on QoreChain with a proven possession.` };
  if (!verifyApprovalV2(key, digest, sub.signature as Hex)) return { ok: false, error: "The signature does not verify against this administrator's registered ML-DSA-87 key." };
  return { ok: true, signer, digest };
}

export type { V2Payment };
