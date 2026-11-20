/**
 * EMERGENCY actions on TreasuryVault V2 by its guardian (the relayer key in .secrets/v2/relayer). Both only REDUCE risk
 * and need no administrator signatures; undoing either needs two administrators (v2-admin-action.ts).
 *
 *   tsx v2-guardian.ts pause [--broadcast]                       stop every V2 payment at once
 *   tsx v2-guardian.ts revoke-agent [0x agent] [--broadcast]     switch the agent off (default: the website's V2 agent)
 *
 * DRY RUN BY DEFAULT: simulates against the live vault and sends nothing. With --broadcast it opens a short vault-only
 * window for the guardian, sends the one call, reads the result back and closes the window, even on failure.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeEvmWindowMsg, openEvmWindowMsg } from "@qorechain/sdk";
import { createWalletClient, getAddress, http, type Hex } from "viem";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { QoreReader, qoreDianaTestnet } from "../src/index";
import { treasuryVaultV2Abi } from "../src/v2";
import { LocalAccount, broadcastNative } from "./lib/accounts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const [cmd, ...rest] = process.argv.slice(2);
const BROADCAST = rest.includes("--broadcast");
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const deployment = JSON.parse(readFileSync(resolve(root, "deployments/v2-diana.json"), "utf8")) as { vault?: string; contracts?: { TreasuryVaultV2?: string }; accounts?: { agent?: { evmAddress?: string } } };
const vault = getAddress(process.env.V2_VAULT_ADDRESS ?? deployment.vault ?? deployment.contracts?.TreasuryVaultV2 ?? "0xAbd8CB36dd17b7aC35432c4A04f44f2d197504E2");

const reader = new QoreReader();
const evm = reader.evm;
await reader.assertConnectedToTestnet();
const guardian = LocalAccount.load(resolve(root, ".secrets/v2/relayer"));
const account = guardian.evm();
if (!(await evm.readContract({ address: vault, abi: treasuryVaultV2Abi, functionName: "isGuardian", args: [account.address] }))) throw new Error(`${account.address} is not a guardian of ${vault}; the vault would refuse. Nothing sent.`);

let fn: "pause" | "guardianRevokeAgent", args: readonly unknown[], label: string, check: () => Promise<string>;
if (cmd === "pause") {
  fn = "pause"; args = []; label = "TreasuryVaultV2.pause()  stops every payment until two administrators unpause";
  check = async () => `on-chain now: paused = ${await evm.readContract({ address: vault, abi: treasuryVaultV2Abi, functionName: "paused" })}`;
} else if (cmd === "revoke-agent") {
  const agent = getAddress(rest.find((x) => x.startsWith("0x")) ?? LocalAccount.load(resolve(root, ".secrets/v2/agent")).pub.evmAddress);
  fn = "guardianRevokeAgent"; args = [agent, NATIVE]; label = `TreasuryVaultV2.guardianRevokeAgent(${agent}, native QOR)  re-enabling needs two administrators`;
  check = async () => `on-chain now: agent active = ${((await evm.readContract({ address: vault, abi: treasuryVaultV2Abi, functionName: "limits", args: [agent, NATIVE] })))[0]}`;
} else {
  console.error("usage: v2-guardian.ts pause | revoke-agent [0x agent]   [--broadcast]");
  process.exit(2);
}

console.log(`${BROADCAST ? "BROADCAST" : "DRY RUN"}  ${label}\nfrom guardian ${account.address}  to vault ${vault}  chain 9800`);
await evm.simulateContract({ account, address: vault, abi: treasuryVaultV2Abi, functionName: fn, args: args as never });
console.log("simulation OK");
if (!BROADCAST) { console.log("Nothing was sent. Re-run with --broadcast to send."); process.exit(0); }

let opened = false;
try {
  const o = await broadcastNative(guardian.unified(), "hybrid", [openEvmWindowMsg({ sender: guardian.pub.qorAddress, blocks: 120, maxTxs: 2, maxValue: "1000000", allowedTargets: [vault] })], 500_000);
  if (o.code !== 0) throw new Error(`window open failed: ${o.rawLog}`);
  opened = true;
  console.log(`window opened (vault only): ${o.hash}`);
  const wallet = createWalletClient({ account, chain: qoreDianaTestnet, transport: http(QORE_NETWORK.evmRpc) });
  const hash: Hex = await wallet.writeContract({ address: vault, abi: treasuryVaultV2Abi, functionName: fn, args: args as never, gasPrice: await evm.getGasPrice(), type: "legacy" });
  const r = await evm.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 2_000 });
  console.log(`sent: ${hash}  status ${r.status}, block ${r.blockNumber}`);
  console.log(await check());
  if (r.status !== "success") process.exitCode = 1;
} finally {
  if (opened) {
    const c = await broadcastNative(guardian.unified(), "hybrid", [closeEvmWindowMsg(guardian.pub.qorAddress)], 300_000);
    console.log(c.code === 0 ? `window closed: ${c.hash}` : `WARNING: window not closed: ${c.rawLog}`);
  }
}
