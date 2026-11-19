/**
 * Runs ONE TreasuryVault V2 administrative change, signed by two administrators with their own ML-DSA-87 keys and relayed
 * by the relayer inside a short window that admits only the vault (closed again afterwards, even on failure).
 *
 *   tsx v2-admin-action.ts recipient <0x address> [--remove] [--signers admin-1,admin-2] [--broadcast]
 *
 * DRY RUN BY DEFAULT: signs locally and simulates on the live vault; sends nothing. Results are appended to
 * deployments/v2-diana.json under adminActions.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeEvmWindowMsg, openEvmWindowMsg } from "@qorechain/sdk";
import { createWalletClient, getAddress, http, type Hex } from "viem";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { QoreReader, qoreDianaTestnet } from "../src/index";
import { AdminOp, adminData, adminDigestV2, signApprovalV2, sortSigs, treasuryVaultV2Abi } from "../src/v2";
import { LocalAccount, broadcastNative } from "./lib/accounts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = resolve(root, "deployments/v2-diana.json");
const [cmd, target, ...rest] = process.argv.slice(2);
const BROADCAST = rest.includes("--broadcast");
const si = rest.indexOf("--signers");
const signerNames = (si >= 0 ? rest[si + 1]! : "admin-1,admin-2").split(",").map((s) => s.trim());
if (cmd !== "recipient" || !target || !/^0x[0-9a-fA-F]{40}$/.test(target)) { console.error("usage: v2-admin-action.ts recipient <0x address> [--remove] [--signers admin-1,admin-2] [--broadcast]"); process.exit(2); }
if (new Set(signerNames).size !== signerNames.length || signerNames.length < 2) { console.error("Need at least two distinct administrators."); process.exit(2); }

const state = JSON.parse(readFileSync(OUT, "utf8")) as Record<string, unknown> & { TreasuryVaultV2: Hex; adminActions?: unknown[] };
const vault = getAddress(state.TreasuryVaultV2);
const reader = new QoreReader();
await reader.assertConnectedToTestnet();
const evm = reader.evm;
const read = <T>(fn: string, args: readonly unknown[] = []) => evm.readContract({ address: vault, abi: treasuryVaultV2Abi, functionName: fn, args } as never) as Promise<T>;

const who = getAddress(target), enable = !rest.includes("--remove");
const label = `${enable ? "approve" : "remove"} recipient ${who}`;
const before = await read<boolean>("approvedRecipient", [who]);
if (before === enable) { console.log(`Nothing to do: ${who} is already ${enable ? "approved" : "not approved"} on ${vault}.`); process.exit(0); }

const op = AdminOp.SetRecipient, data = adminData.setRecipient(who, enable);
const nonce = await read<bigint>("adminNonce");
const expiry = (await evm.getBlock()).timestamp + 3600n;
const digest = adminDigestV2(9800n, vault, op, data, nonce, expiry);
const chainDigest = await read<Hex>("adminDigest", [op, data, nonce, expiry]);
if (chainDigest !== digest) throw new Error("admin digest mismatch between the vault and TypeScript; refusing");
const admins = signerNames.map((n) => LocalAccount.load(resolve(root, ".secrets/v2", n)));
for (const a of admins) if (!(await read<boolean>("isAdmin", [a.pub.evmAddress]))) throw new Error(`${a.pub.evmAddress} is not an administrator on the vault`);
const sigs = sortSigs(admins.map((a) => ({ signer: a.pub.evmAddress, signature: signApprovalV2(a.pqc().secretKey, digest) })));
const relayer = LocalAccount.load(resolve(root, ".secrets/v2/relayer"));
const rEvm = relayer.evm();
await evm.simulateContract({ account: rEvm, address: vault, abi: treasuryVaultV2Abi, functionName: "executeAdminAction", args: [op, data, nonce, expiry, sigs] });
console.log(`${BROADCAST ? "BROADCAST" : "DRY RUN"}  ${label} on ${vault}, admin nonce ${nonce}, signed by ${signerNames.join(" + ")} (${sigs.map((s) => s.signer).join(", ")}); simulation OK`);
if (!BROADCAST) { console.log("Nothing was sent. Re-run with --broadcast."); process.exit(0); }

const rUa = relayer.unified();
const open = await broadcastNative(rUa, "hybrid", [openEvmWindowMsg({ sender: rUa.cosmos, blocks: 120, maxTxs: 2, maxValue: "500000", allowedTargets: [vault] })], 500_000);
if (open.code !== 0) throw new Error(`window open failed: ${open.rawLog}`);
console.log(`relayer window opened (vault only, 2 txs): ${open.hash}`);
const record: Record<string, unknown> = { action: label, at: new Date().toISOString(), adminNonce: nonce.toString(), signers: sigs.map((s) => s.signer), windowOpen: open.hash };
try {
  const wallet = createWalletClient({ account: rEvm, chain: qoreDianaTestnet, transport: http(QORE_NETWORK.evmRpc) });
  const { request } = await evm.simulateContract({ account: rEvm, address: vault, abi: treasuryVaultV2Abi, functionName: "executeAdminAction", args: [op, data, nonce, expiry, sigs] });
  const hash = await wallet.writeContract({ ...request, gasPrice: await evm.getGasPrice(), type: "legacy" } as never);
  const r = await evm.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 2_000 });
  console.log(`${label}: ${r.status}, block ${r.blockNumber}, tx ${hash}`);
  Object.assign(record, { tx: hash, block: r.blockNumber.toString(), status: r.status });
} finally {
  if ((await reader.evmWindow(rUa.cosmos)).live) {
    const c = await broadcastNative(rUa, "hybrid", [closeEvmWindowMsg(rUa.cosmos)], 300_000);
    console.log(c.code === 0 ? `relayer window closed: ${c.hash}` : `WARNING: window not closed: ${c.rawLog}`);
    record.windowClose = c.code === 0 ? c.hash : `FAILED: ${c.rawLog}`;
  }
  const after = await read<boolean>("approvedRecipient", [who]);
  record.approvedRecipientAfter = after;
  console.log(`read back: approvedRecipient(${who}) = ${after}`);
  state.adminActions = [...(state.adminActions ?? []), record];
  writeFileSync(OUT, JSON.stringify(state, null, 2) + "\n");
}
