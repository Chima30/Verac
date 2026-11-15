/**
 * Owner-only configuration of the TreasuryVault on Diana testnet, using the throwaway owner key in
 * .secrets/testnet-account.json (never printed). DRY RUN BY DEFAULT: it simulates the call against the chain and prints
 * exactly what would be sent. Add --broadcast to send.
 *
 *   tsx owner-ops.ts set-agent-limits [--broadcast]       perTx 10 QOR, daily 20 QOR, no auto-approval, valid 7 days
 *   tsx owner-ops.ts set-approver <0x address> [--broadcast]
 *
 * To send, it opens a SHORT EVM window that admits only the vault (120 blocks, 3 txs, 2 QOR cap), sends the one call,
 * reads the result back from the chain, and closes the window again even if something fails.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, decodeEventLog, encodeFunctionData, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { DEPLOYED, treasuryVaultAbi } from "../src/contracts";
import { QoreReader, qoreDianaTestnet } from "../src/index";
import { WindowManager } from "../src/window";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const [cmd, ...rest] = process.argv.slice(2);
const broadcast = rest.includes("--broadcast");
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const E18 = 10n ** 18n;

const file = JSON.parse(readFileSync(resolve(root, process.env.ACCOUNT_FILE ?? ".secrets/testnet-account.json"), "utf8")) as {
  evmAddress: string; qorAddress: string; secp256k1PrivateKey: string; mlDsa87PublicKey: string; mlDsa87SecretKey: string;
};
const key = (file.secp256k1PrivateKey.startsWith("0x") ? file.secp256k1PrivateKey : `0x${file.secp256k1PrivateKey}`) as Hex;
const account = privateKeyToAccount(key);
if (account.address.toLowerCase() !== file.evmAddress.toLowerCase()) throw new Error("Stored key does not match the stored address; refusing.");

const reader = new QoreReader();
const evm = reader.evm;
await reader.assertConnectedToTestnet(); // throws unless the node is chain 9800

const owner = (await evm.readContract({ address: DEPLOYED.TreasuryVault, abi: treasuryVaultAbi, functionName: "owner" })) as string;
if (owner.toLowerCase() !== account.address.toLowerCase()) throw new Error(`This key (${account.address}) is not the vault owner (${owner}); the vault would reject it. Refusing.`);

let data: Hex, label: string, check: () => Promise<string>;
if (cmd === "set-agent-limits") {
  const agent = getAddress(process.env.AGENT ?? "0x7615DAb4651b47f69F80305f89F39B211F829dd7");
  const validUntil = BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400);
  const args = [agent, NATIVE, 10n * E18, 20n * E18, 0n, validUntil] as const;
  data = encodeFunctionData({ abi: treasuryVaultAbi, functionName: "setAgentLimits", args });
  label = `TreasuryVault.setAgentLimits(agent ${agent}, token native QOR, perTxCap 10 QOR, dailyCap 20 QOR, autoApproveCap 0, validUntil ${new Date(Number(validUntil) * 1000).toISOString()})`;
  check = async () => {
    const l = (await evm.readContract({ address: DEPLOYED.TreasuryVault, abi: treasuryVaultAbi, functionName: "limits", args: [agent, NATIVE] })) as readonly [boolean, bigint, bigint, bigint, bigint];
    const ok = l[0] && l[2] === 10n * E18 && l[3] === 20n * E18 && l[4] === 0n && l[1] === validUntil;
    return `on-chain now: active=${l[0]} perTxCap=${l[2] / E18} dailyCap=${l[3] / E18} autoApproveCap=${l[4]} validUntil=${l[1]}  => ${ok ? "MATCHES" : "DOES NOT MATCH"}`;
  };
} else if (cmd === "set-approver") {
  const who = getAddress(rest[0] ?? "");
  if (who.toLowerCase() === getAddress("0x7615DAb4651b47f69F80305f89F39B211F829dd7").toLowerCase()) throw new Error("The agent must never be an approver. Refusing.");
  data = encodeFunctionData({ abi: treasuryVaultAbi, functionName: "setApprover", args: [who, true] });
  label = `TreasuryVault.setApprover(${who}, true)`;
  check = async () => `on-chain now: isApprover(${who}) = ${await evm.readContract({ address: DEPLOYED.TreasuryVault, abi: treasuryVaultAbi, functionName: "isApprover", args: [who] })}, approverCount = ${await evm.readContract({ address: DEPLOYED.TreasuryVault, abi: treasuryVaultAbi, functionName: "approverCount" })}`;
} else {
  console.error("usage: owner-ops.ts set-agent-limits | set-approver <0x address>   [--broadcast]");
  process.exit(2);
}

console.log(`${broadcast ? "BROADCAST" : "DRY RUN"}  ${label}`);
console.log(`from owner ${account.address}  to vault ${DEPLOYED.TreasuryVault}  value 0  chain 9800`);
const gas = await evm.estimateGas({ account, to: DEPLOYED.TreasuryVault, data, value: 0n }); // also fails here if the vault would revert
console.log(`simulation OK, gas estimate ${gas}`);
if (!broadcast) { console.log("Nothing was sent. Re-run with --broadcast to send."); process.exit(0); }

const windows = new WindowManager(
  { secp256k1PrivateKey: key, mlDsa87PublicKey: file.mlDsa87PublicKey, mlDsa87SecretKey: file.mlDsa87SecretKey },
  { enabled: () => true }, // local script run by the operator; the website's kill switch is not involved
  reader,
);
let sent: Hex | undefined;
try {
  const opened = await windows.ensureOpen(1);
  console.log(opened ? `window opened: ${opened}` : "a sufficient vault-only window was already open");
  const wallet = createWalletClient({ account, chain: qoreDianaTestnet, transport: http(QORE_NETWORK.evmRpc) });
  sent = await wallet.sendTransaction({ to: DEPLOYED.TreasuryVault, data, value: 0n, gas: (gas * 13n) / 10n, gasPrice: await evm.getGasPrice(), type: "legacy" });
  console.log(`sent: ${sent}`);
  const r = await evm.waitForTransactionReceipt({ hash: sent, timeout: 90_000, pollingInterval: 2_000 });
  console.log(`receipt: status ${r.status}, block ${r.blockNumber}`);
  const names = r.logs.filter((l) => l.address.toLowerCase() === DEPLOYED.TreasuryVault.toLowerCase()).map((l) => { try { return decodeEventLog({ abi: treasuryVaultAbi, data: l.data, topics: l.topics }).eventName; } catch { return "?"; } });
  console.log(`vault events in receipt: ${names.join(", ") || "none"}`);
  console.log(`explorer: ${QORE_NETWORK.explorer.replace(/\/$/, "")}/tx/${sent}`);
  if (r.status !== "success") { console.error("The transaction reverted on chain. Nothing changed."); process.exitCode = 1; }
  else console.log(await check());
} finally {
  try { const closed = await windows.close(); console.log(closed ? `window closed: ${closed}` : "no window left open"); }
  catch (e) { console.error("WARNING: could not close the window:", e instanceof Error ? e.message : e); process.exitCode = 1; }
}
