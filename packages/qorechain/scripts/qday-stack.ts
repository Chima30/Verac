/**
 * Deploys the isolated Q-Day Survivor target contracts, signed by the drill ADMIN (.secrets/qday-admin), never by the
 * drill account whose classical key is handed to the attack bot.
 *
 *   PolicyManager(owner = admin), one policy activated
 *   TreasuryVault(owner = admin), funded with 5 test QOR
 *     approver: admin only (threshold 1); approved recipient: admin only
 *     drill account = capped agent: 0.5 QOR per payment, 1 QOR per day, autoApproveCap 0 (every payment needs approval)
 *
 * Opens ONE unscoped EVM window for the admin (contract creation needs it), sends the transactions, and closes the window
 * again even on failure. DRY RUN BY DEFAULT (prints the plan and gas estimate). Add --broadcast to send.
 * Writes deployments/qday-drill.json (public data only). Secrets are never printed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StargateClient } from "@cosmjs/stargate";
import { EthNativeSigner, closeEvmWindowMsg, openEvmWindowMsg, pqcKeyFromRecoveryCode, unifiedAccountFromSeed, type UnifiedAccount } from "@qorechain/sdk";
import { createWalletClient, getAddress, http, keccak256, toBytes, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { QoreReader, qoreDianaTestnet } from "../src/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const broadcast = process.argv.includes("--broadcast");
const CHAIN_ID = "qorechain-diana";
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const E18 = 10n ** 18n;
const OUT = resolve(root, "deployments/qday-drill.json");

const load = (dir: string) => {
  const d = resolve(root, dir);
  const pub = JSON.parse(readFileSync(resolve(d, "account.json"), "utf8")) as { qorAddress: string; evmAddress: string; mlDsa87PublicKey: string };
  return { dir: d, pub, key: () => readFileSync(resolve(d, "ecdsa-private-key.txt"), "utf8").trim() as Hex, code: () => readFileSync(resolve(d, "pqc-recovery-code.txt"), "utf8").trim() };
};
const admin = load(".secrets/qday-admin");
const drill = load(".secrets/qday-drill").pub; // public data only: the drill key is never loaded here
const adminEvm = privateKeyToAccount(admin.key());
if (adminEvm.address.toLowerCase() !== admin.pub.evmAddress.toLowerCase()) throw new Error("Admin key does not match its address; refusing.");
if (adminEvm.address.toLowerCase() === drill.evmAddress.toLowerCase()) throw new Error("Admin and drill account must differ; refusing.");
if (existsSync(OUT) && broadcast) throw new Error(`${OUT} exists: the drill stack was already deployed. Refusing to deploy twice.`);

const reader = new QoreReader();
const evm = reader.evm;
await reader.assertConnectedToTestnet();
const art = (name: string) => { const j = JSON.parse(readFileSync(resolve(root, `contracts/out/${name}.sol/${name}.json`), "utf8")); return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex }; };
const PM = art("PolicyManager"), TV = art("TreasuryVault");

const pqc = await reader.pqcStatus(admin.pub.qorAddress).catch(() => null);
console.log(`admin ${adminEvm.address} (${admin.pub.qorAddress})  drill agent ${drill.evmAddress}`);
const gasPrice = await evm.getGasPrice();
const pmGas = await evm.estimateGas({ account: adminEvm, data: (await import("viem")).encodeDeployData({ abi: PM.abi, bytecode: PM.bytecode, args: [adminEvm.address] }) });
const budgetGas = 9_000_000n; // two deploys + five calls + one transfer, generous
const feeBudget = budgetGas * gasPrice;
const VAULT_FUND = 5n * E18;
const capUqor = (VAULT_FUND + feeBudget) / 10n ** 12n + 1_000_000n; // + 1 QOR headroom
console.log(`gas price ${gasPrice} wei; PolicyManager deploy estimate ${pmGas} gas; fee budget ${Number(feeBudget) / 1e18} QOR`);
console.log(`window plan: unscoped, 200 blocks, 10 txs, max ${Number(capUqor) / 1e6} QOR (value + fees)`);
console.log("admin pqc status:", pqc ? JSON.stringify(pqc, (_, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 160) : "unknown");
if (!broadcast) { console.log("DRY RUN: nothing was sent. Re-run with --broadcast."); process.exit(0); }

// --- native (hybrid) window messages, signed by the admin's two keys
const unhex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const pq = pqcKeyFromRecoveryCode(admin.code(), admin.pub.qorAddress);
if (Buffer.from(pq.publicKey).toString("hex") !== admin.pub.mlDsa87PublicKey) throw new Error("Admin recovery code does not give the recorded key; refusing.");
const ua: UnifiedAccount = { ...unifiedAccountFromSeed(unhex(admin.key()), { pqcSecret: crypto.getRandomValues(new Uint8Array(32)) }), pqc: pq };
const native = async (messages: Parameters<EthNativeSigner["sign"]>[0]["messages"], gas: number) => {
  const acc = (await (await fetch(`${QORE_NETWORK.rest}/cosmos/auth/v1beta1/accounts/${ua.cosmos}`)).json()) as { account?: { account_number?: string; sequence?: string } };
  const client = await StargateClient.connect(QORE_NETWORK.rpc);
  try {
    const res = await new EthNativeSigner(ua, { signMode: "hybrid", rest: QORE_NETWORK.rest }).signAndBroadcast(client, {
      chainId: CHAIN_ID, messages, fee: { amount: [{ denom: "uqor", amount: String(Math.ceil(gas * 0.15)) }], gas: String(gas) },
      accountNumber: BigInt(acc.account?.account_number ?? "0"), sequence: BigInt(acc.account?.sequence ?? "0"),
    });
    if (res.code !== 0) throw new Error(`native tx failed, code ${res.code}: ${res.rawLog}`);
    return res.transactionHash;
  } finally { client.disconnect(); }
};

const wallet = createWalletClient({ account: adminEvm, chain: qoreDianaTestnet, transport: http(QORE_NETWORK.evmRpc) });
const record: Record<string, unknown> = { network: "qorechain-diana", evmChainId: 9800, purpose: "Q-Day Survivor drill targets. Isolated from Verac's production contracts.", admin: adminEvm.address, drillAccount: drill.evmAddress, txs: {} as Record<string, string> };
const txs = record.txs as Record<string, string>;
const wait = async (label: string, hash: Hex) => {
  const r = await evm.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 2_000 });
  console.log(`${label}: ${r.status}, block ${r.blockNumber}, tx ${hash}`);
  if (r.status !== "success") throw new Error(`${label} reverted`);
  txs[label] = hash;
  return r;
};
const call = async (label: string, address: Hex, abi: Abi, functionName: string, args: readonly unknown[]) => {
  const { request } = await evm.simulateContract({ account: adminEvm, address, abi, functionName, args });
  return wait(label, await wallet.writeContract({ ...request, gasPrice, type: "legacy" } as never));
};

try {
  txs["open admin window"] = await native([openEvmWindowMsg({ sender: ua.cosmos, blocks: 200, maxTxs: 10, maxValue: capUqor.toString() })], 500_000);
  console.log(`admin window opened: ${txs["open admin window"]}`);

  const pmR = await wait("deploy PolicyManager", await wallet.deployContract({ abi: PM.abi, bytecode: PM.bytecode, args: [adminEvm.address], gasPrice, type: "legacy" } as never));
  const pm = getAddress(pmR.contractAddress!);
  const tvR = await wait("deploy TreasuryVault", await wallet.deployContract({ abi: TV.abi, bytecode: TV.bytecode, args: [adminEvm.address, pm], gasPrice, type: "legacy" } as never));
  const tv = getAddress(tvR.contractAddress!);
  record.PolicyManager = pm; record.TreasuryVault = tv;

  const policyHash = keccak256(toBytes("verac-qday-drill-policy-v1"));
  await call("activate drill policy v1", pm, PM.abi, "activate", [policyHash]);
  await call("set approver (admin)", tv, TV.abi, "setApprover", [adminEvm.address, true]);
  await call("approve recipient (admin)", tv, TV.abi, "setApprovedRecipient", [adminEvm.address, true]);
  const validUntil = BigInt(Date.UTC(2026, 10, 21) / 1000); // 21 Nov 2026 00:00 UTC, after the drill
  await call("drill agent limits", tv, TV.abi, "setAgentLimits", [getAddress(drill.evmAddress), NATIVE, E18 / 2n, E18, 0n, validUntil]);
  await wait("fund vault 5 QOR", await wallet.sendTransaction({ to: tv, value: VAULT_FUND, gasPrice, type: "legacy" } as never));
  record.limits = { token: "native QOR", perTxCap: "0.5", dailyCap: "1", autoApproveCap: "0", validUntil: new Date(Number(validUntil) * 1000).toISOString(), approvalThreshold: 1, approvers: [adminEvm.address], approvedRecipients: [adminEvm.address] };
} finally {
  try {
    const w = await reader.evmWindow(ua.cosmos);
    if (w.live) { txs["close admin window"] = await native([closeEvmWindowMsg(ua.cosmos)], 300_000); console.log(`admin window closed: ${txs["close admin window"]}`); }
    else console.log("admin window already closed");
  } catch (e) { console.error("WARNING: could not close the admin window:", e instanceof Error ? e.message : e); process.exitCode = 1; }
  record.deployedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(record, null, 2) + "\n");
  console.log(`wrote ${OUT}`);
}
