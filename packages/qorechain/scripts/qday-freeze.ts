/**
 * Freezes the Q-Day drill vault for the drill, signed by the drill ADMIN (.secrets/qday-admin):
 *   TreasuryVault.pause()                       no payment or escrow funding can run while paused
 *   TreasuryVault.revokeAgent(drill, native)    the drill account loses its agent rights entirely
 *
 * Opens ONE short admin window that admits only the drill vault (60 blocks, 3 txs, 0.2 QOR of fees), sends the two
 * calls, reads the result back, and closes the window again even on failure. DRY RUN BY DEFAULT (simulates both calls).
 * Add --broadcast to send. Records the transactions under "freeze" in deployments/qday-drill.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StargateClient } from "@cosmjs/stargate";
import { EthNativeSigner, closeEvmWindowMsg, openEvmWindowMsg, pqcKeyFromRecoveryCode, unifiedAccountFromSeed, type UnifiedAccount } from "@qorechain/sdk";
import { createWalletClient, getAddress, http, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { QoreReader, qoreDianaTestnet } from "../src/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const broadcast = process.argv.includes("--broadcast");
const CHAIN_ID = "qorechain-diana";
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const DEP = resolve(root, "deployments/qday-drill.json");
const dep = JSON.parse(readFileSync(DEP, "utf8")) as Record<string, unknown> & { TreasuryVault: Hex; admin: Hex; drillAccount: Hex };
const dir = resolve(root, ".secrets/qday-admin");
const pub = JSON.parse(readFileSync(resolve(dir, "account.json"), "utf8")) as { qorAddress: string; evmAddress: string; mlDsa87PublicKey: string };
const key = readFileSync(resolve(dir, "ecdsa-private-key.txt"), "utf8").trim() as Hex;
const admin = privateKeyToAccount(key);
if (admin.address !== getAddress(dep.admin)) throw new Error("Admin key does not match the recorded admin; refusing.");
const TV = JSON.parse(readFileSync(resolve(root, "contracts/out/TreasuryVault.sol/TreasuryVault.json"), "utf8")).abi as Abi;
const vault = dep.TreasuryVault, drill = getAddress(dep.drillAccount);

const reader = new QoreReader();
const evm = reader.evm;
await reader.assertConnectedToTestnet();
const state = async () => {
  const [paused, l] = await Promise.all([
    evm.readContract({ address: vault, abi: TV, functionName: "paused" }) as Promise<boolean>,
    evm.readContract({ address: vault, abi: TV, functionName: "limits", args: [drill, NATIVE] }) as Promise<readonly [boolean, ...bigint[]]>,
  ]);
  return { paused, agentActive: l[0] };
};
const s0 = await state();
console.log(`vault ${vault}: paused=${s0.paused}, drill agent active=${s0.agentActive}`);
const calls = [
  ...(s0.paused ? [] : [{ label: "pause vault", functionName: "pause", args: [] as unknown[] }]),
  ...(s0.agentActive ? [{ label: "revoke drill agent", functionName: "revokeAgent", args: [drill, NATIVE] as unknown[] }] : []),
];
if (!calls.length) { console.log("Already frozen. Nothing to do."); process.exit(0); }
for (const c of calls) { await evm.simulateContract({ account: admin, address: vault, abi: TV, functionName: c.functionName, args: c.args }); console.log(`simulation OK: ${c.label}`); }
if (!broadcast) { console.log("DRY RUN: nothing was sent. Re-run with --broadcast."); process.exit(0); }

const unhex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const pq = pqcKeyFromRecoveryCode(readFileSync(resolve(dir, "pqc-recovery-code.txt"), "utf8").trim(), pub.qorAddress);
if (Buffer.from(pq.publicKey).toString("hex") !== pub.mlDsa87PublicKey) throw new Error("Admin recovery code does not give the recorded key; refusing.");
const ua: UnifiedAccount = { ...unifiedAccountFromSeed(unhex(key), { pqcSecret: crypto.getRandomValues(new Uint8Array(32)) }), pqc: pq };
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

const wallet = createWalletClient({ account: admin, chain: qoreDianaTestnet, transport: http(QORE_NETWORK.evmRpc) });
const txs: Record<string, string> = {};
try {
  txs["open admin window (vault only)"] = await native([openEvmWindowMsg({ sender: ua.cosmos, blocks: 60, maxTxs: 3, maxValue: "200000", allowedTargets: [vault] })], 500_000);
  console.log(`admin window opened: ${txs["open admin window (vault only)"]}`);
  const gasPrice = await evm.getGasPrice();
  for (const c of calls) {
    const { request } = await evm.simulateContract({ account: admin, address: vault, abi: TV, functionName: c.functionName, args: c.args });
    const h = await wallet.writeContract({ ...request, gasPrice, type: "legacy" } as never);
    const r = await evm.waitForTransactionReceipt({ hash: h, timeout: 120_000, pollingInterval: 2_000 });
    console.log(`${c.label}: ${r.status}, block ${r.blockNumber}, tx ${h}`);
    if (r.status !== "success") throw new Error(`${c.label} reverted`);
    txs[c.label] = h;
  }
} finally {
  try {
    if ((await reader.evmWindow(ua.cosmos)).live) { txs["close admin window"] = await native([closeEvmWindowMsg(ua.cosmos)], 300_000); console.log(`admin window closed: ${txs["close admin window"]}`); }
    else console.log("admin window already closed");
  } catch (e) { console.error("WARNING: could not close the admin window:", e instanceof Error ? e.message : e); process.exitCode = 1; }
  const s1 = await state();
  console.log(`after: paused=${s1.paused}, drill agent active=${s1.agentActive}`);
  dep.freeze = { at: new Date().toISOString(), ...s1, txs };
  writeFileSync(DEP, JSON.stringify(dep, null, 2) + "\n");
}
