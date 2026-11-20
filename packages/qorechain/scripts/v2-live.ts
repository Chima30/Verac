/**
 * HISTORICAL RECORD of the 2026-11-19 run. admin-3 was replaced by admin-4 on 2026-11-20 (docs/RUNBOOK.md 2a), so
 * running this again as it is would be refused by the vault. Kept unchanged so the published results can be traced.
 *
 * Live active-attack test of TreasuryVault V2 on Diana testnet (the isolated environment from v2-setup.ts).
 * A legitimate payment succeeds while an attacker who holds EVERYTHING the application server holds (the agent key,
 * the relayer key, their ML-DSA keys, the database) tries to move money without the administrators.
 *
 * Every result is labelled by where it was stopped:
 *   executed                   included and succeeded
 *   rejected-by-contract       sent, included, reverted by TreasuryVaultV2 (the revert reason comes from simulating the
 *                              same call just before sending)
 *   rejected-by-chain          refused by QoreChain before inclusion (no transaction exists)
 *   simulated-only             eth_call only; nothing sent
 * Results: deployments/v2-live-results.json. DRY RUN unless --broadcast (a dry run simulates everything, sends nothing).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyEvmWindowRejection, closeEvmWindowMsg, openEvmWindowMsg } from "@qorechain/sdk";
import { BaseError, ContractFunctionRevertedError, createWalletClient, decodeEventLog, encodeFunctionData, getAddress, http, keccak256, toBytes, toHex, type Hex, type PrivateKeyAccount } from "viem";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { QoreReader, qoreDianaTestnet } from "../src/index";
import { AdminOp, adminData, adminDigestV2, paymentDigestV2, signApprovalV2, sortSigs, treasuryVaultV2Abi, type V2AdminSig, type V2Payment } from "../src/v2";
import { LocalAccount, assertDiana, broadcastNative } from "./lib/accounts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BROADCAST = process.argv.includes("--broadcast");
const env = JSON.parse(readFileSync(resolve(root, "deployments/v2-diana.json"), "utf8")) as { TreasuryVaultV2: Hex; vendor: Hex; configuredAt?: string };
if (!env.configuredAt) throw new Error("Run v2-setup.ts --broadcast first.");
const vault = env.TreasuryVaultV2, vendor = getAddress(env.vendor);
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const E18 = 10n ** 18n;
const ATTACKER = getAddress("0x000000000000000000000000000000000000bEEF");

await assertDiana();
const reader = new QoreReader();
const evm = reader.evm;
const dir = (n: string) => resolve(root, ".secrets/v2", n);
const [a1, a2, a3] = ["admin-1", "admin-2", "admin-3"].map((n) => LocalAccount.load(dir(n))) as [LocalAccount, LocalAccount, LocalAccount];
const agent = LocalAccount.load(dir("agent")), relayer = LocalAccount.load(dir("relayer"));
const agentEvm = agent.evm(), relayerEvm = relayer.evm();
const gasPrice = await evm.getGasPrice();

type Outcome = "executed" | "rejected-by-contract" | "rejected-by-chain" | "simulated-only";
interface Result { id: string; scenario: string; attacker?: string; expected: string; outcome: Outcome; error?: string; txHash?: string; block?: string; at: string; detail?: Record<string, unknown> }
const results: Result[] = [];
const rec = (r: Omit<Result, "at">) => { const full = { ...r, at: new Date().toISOString() }; results.push(full); console.log(`${r.id.padEnd(4)} ${r.outcome.padEnd(21)} ${r.scenario}${r.error ? `  [${r.error}]` : ""}${r.txHash ? `  ${r.txHash}` : ""}`); };

const errorName = (e: unknown): string => {
  const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
  if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ? `${r.data.errorName}(${(r.data.args ?? []).map(String).join(", ")})` : r.reason ?? "revert";
  return (e instanceof Error ? e.message.split("\n")[0] : String(e))!.slice(0, 160);
};

const sign = (signers: LocalAccount[], digest: Hex): V2AdminSig[] => sortSigs(signers.map((a) => ({ signer: a.pub.evmAddress, signature: signApprovalV2(a.pqc().secretKey, digest) })));
const now = async () => (await evm.getBlock()).timestamp;
const policyVersion = async () => (await evm.readContract({ address: vault, abi: treasuryVaultV2Abi, functionName: "policyVersion" })) as bigint;
let nonceSeq = BigInt(Date.now()) * 1000n;
const payment = async (to: Hex, qor: number): Promise<V2Payment> => ({ token: NATIVE, to, amount: BigInt(Math.round(qor * 1e6)) * 10n ** 12n, purposeHash: keccak256(toBytes(`v2-live|${Date.now()}`)), policyVersion: await policyVersion(), expiry: (await now()) + 3600n, nonce: nonceSeq++ });

/** Simulates, then (when broadcasting) sends with a fixed gas limit so a reverting call is still included as evidence. */
async function attempt(id: string, scenario: string, from: PrivateKeyAccount, fn: "executePayment" | "executeAdminAction" | "pause" | "guardianRevokeAgent", args: readonly unknown[], expected: string, attacker?: string): Promise<boolean> {
  let simErr: string | null = null;
  try { await evm.simulateContract({ account: from, address: vault, abi: treasuryVaultV2Abi, functionName: fn, args } as never); } catch (e) { simErr = errorName(e); }
  if (!BROADCAST) { rec({ id, scenario, attacker, expected, outcome: "simulated-only", error: simErr ?? "would succeed" }); return simErr === null; }
  const wallet = createWalletClient({ account: from, chain: qoreDianaTestnet, transport: http(QORE_NETWORK.evmRpc) });
  try {
    const hash = await wallet.sendTransaction({ to: vault, data: encodeFunctionData({ abi: treasuryVaultV2Abi, functionName: fn, args } as never), gas: 1_500_000n, gasPrice, type: "legacy" } as never);
    const r = await evm.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 2_000 });
    const ok = r.status === "success";
    const events = r.logs.filter((l) => l.address.toLowerCase() === vault.toLowerCase()).map((l) => { try { return decodeEventLog({ abi: treasuryVaultV2Abi, data: l.data, topics: l.topics }); } catch { return null; } }).filter(Boolean);
    rec({ id, scenario, attacker, expected, outcome: ok ? "executed" : "rejected-by-contract", error: ok ? undefined : simErr ?? "reverted", txHash: hash, block: r.blockNumber.toString(), detail: ok ? { events: events.map((e) => ({ name: e!.eventName, args: JSON.parse(JSON.stringify(e!.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) })) } : undefined });
    return ok;
  } catch (e) {
    const c = classifyEvmWindowRejection(e);
    rec({ id, scenario, attacker, expected, outcome: "rejected-by-chain", error: c ? `window: ${JSON.stringify(c)}` : errorName(e) });
    return false;
  }
}

async function openWindow(a: LocalAccount, maxTxs: number, maxQor: number, label: string) {
  if (!BROADCAST) return;
  const r = await broadcastNative(a.unified(), "hybrid", [openEvmWindowMsg({ sender: a.pub.qorAddress, blocks: 600, maxTxs, maxValue: String(Math.round(maxQor * 1e6)), allowedTargets: [vault] })], 500_000);
  if (r.code !== 0) throw new Error(`${label} window open failed: ${r.rawLog}`);
  console.log(`${label} window opened (vault only, ${maxTxs} txs): ${r.hash}`);
  windows.push([a, label]);
}
const windows: Array<[LocalAccount, string]> = [];
async function closeWindows() {
  for (const [a, label] of windows) {
    const w = await reader.evmWindow(a.pub.qorAddress);
    if (!w.live) continue;
    const r = await broadcastNative(a.unified(), "hybrid", [closeEvmWindowMsg(a.pub.qorAddress)], 300_000);
    console.log(r.code === 0 ? `${label} window closed: ${r.hash}` : `WARNING: ${label} window not closed: ${r.rawLog}`);
  }
}

const adminCall = async (op: AdminOp, data: Hex, signers: LocalAccount[]) => {
  const nonce = (await evm.readContract({ address: vault, abi: treasuryVaultV2Abi, functionName: "adminNonce" })) as bigint;
  const expiry = (await now()) + 3600n;
  return [op, data, nonce, expiry, sign(signers, adminDigestV2(9800n, vault, op, data, nonce, expiry))] as const;
};

console.log(`${BROADCAST ? "LIVE" : "DRY RUN (simulations only)"} against TreasuryVaultV2 ${vault}`);
const balBefore = await evm.getBalance({ address: vault });
try {
  await openWindow(agent, 16, 3, "agent");
  await openWindow(relayer, 10, 2, "relayer");

  // L1: legitimate payment, approved by two administrators
  const p1 = await payment(vendor, 0.4);
  const s1 = sign([a1, a3], paymentDigestV2(9800n, vault, agent.pub.evmAddress, p1));
  await attempt("L1", "Legitimate payment: 0.4 QOR to the approved vendor, signed by admin-1 and admin-3 (ML-DSA-87, verified on chain)", agentEvm, "executePayment", [p1, s1], "executed");

  // Attacks by someone holding everything the server holds
  const p2 = await payment(vendor, 0.4);
  await attempt("A1", "Server compromise: pay with no administrator signatures", agentEvm, "executePayment", [p2, []], "NotEnoughSignatures(0, 2)", "server");
  await attempt("A2", "Server compromise: sign with the server's own registered ML-DSA keys (agent + relayer)", agentEvm, "executePayment", [p2, sign([agent, relayer], paymentDigestV2(9800n, vault, agent.pub.evmAddress, p2))], "NotAdmin", "server");
  const forged = sortSigs([{ signer: a1.pub.evmAddress, signature: signApprovalV2(a1.pqc().secretKey, paymentDigestV2(9800n, vault, agent.pub.evmAddress, p2)) }, { signer: a2.pub.evmAddress, signature: toHex(crypto.getRandomValues(new Uint8Array(4627))) }]);
  await attempt("A3", "Forged approval: one real admin signature plus 4,627 made-up bytes for admin-2", agentEvm, "executePayment", [p2, forged], "BadSignature(admin-2)", "server");
  await attempt("A4", "Replay: send the exact approved payment L1 again", agentEvm, "executePayment", [p1, s1], "AlreadyExecuted", "server");
  await attempt("A5", "Tampering: L1's signatures on the same payment with the amount raised to 0.9 QOR", agentEvm, "executePayment", [{ ...p1, amount: 900_000_000_000_000_000n, nonce: nonceSeq++ }, s1], "BadSignature", "server");
  const p6 = await payment(ATTACKER, 0.4);
  await attempt("A6", "Unauthorised recipient 0x…bEEF, even with two genuine admin signatures", agentEvm, "executePayment", [p6, sign([a1, a2], paymentDigestV2(9800n, vault, agent.pub.evmAddress, p6))], "RecipientNotApproved", "insider");
  const p7 = await payment(vendor, 1.5);
  await attempt("A7", "Excessive payment: 1.5 QOR against a 1 QOR per-payment cap, with two genuine admin signatures", agentEvm, "executePayment", [p7, sign([a1, a2], paymentDigestV2(9800n, vault, agent.pub.evmAddress, p7))], "ExceedsPerTxCap", "insider");
  const p8 = await payment(vendor, 0.9);
  await attempt("L2", "Legitimate payment: 0.9 QOR (day total 1.3 of 2 QOR), signed by admin-2 and admin-3", agentEvm, "executePayment", [p8, sign([a2, a3], paymentDigestV2(9800n, vault, agent.pub.evmAddress, p8))], "executed");
  const p9 = await payment(vendor, 0.9);
  await attempt("A8", "Daily limit: another 0.9 QOR (would make 2.2 of 2 QOR today), with two genuine admin signatures", agentEvm, "executePayment", [p9, sign([a1, a3], paymentDigestV2(9800n, vault, agent.pub.evmAddress, p9))], "ExceedsDailyCap", "insider");
  await attempt("A9", "Unauthorised policy change: admin-1 plus the agent's own key", agentEvm, "executeAdminAction", await adminCall(AdminOp.SetPolicy, adminData.setPolicy(keccak256(toBytes("attacker policy"))), [a1, agent]), "NotAdmin(agent)", "server");
  await attempt("A10", "Unauthorised recipient change: raise 0x…bEEF with only one admin signature", relayerEvm, "executeAdminAction", await adminCall(AdminOp.SetRecipient, adminData.setRecipient(ATTACKER, true), [a1]), "NotEnoughSignatures(1, 2)", "server");

  // Emergency controls
  await attempt("G1", "Guardian revokes the agent at once (no admin signatures needed to reduce risk)", relayerEvm, "guardianRevokeAgent", [agent.pub.evmAddress, NATIVE], "executed");
  const p11 = await payment(vendor, 0.1);
  await attempt("A11", "Revoked agent tries a payment with two genuine admin signatures", agentEvm, "executePayment", [p11, sign([a1, a2], paymentDigestV2(9800n, vault, agent.pub.evmAddress, p11))], "AgentNotActive", "server");
  const shortly = (await now()) + 30n;
  await attempt("G2", "Administrators (2 of 3) restore the agent with an expiry 30 seconds away", relayerEvm, "executeAdminAction", await adminCall(AdminOp.SetAgentLimits, adminData.setAgentLimits(agent.pub.evmAddress, NATIVE, E18, 2n * E18, shortly), [a1, a2]), "executed");
  if (BROADCAST) while ((await now()) <= shortly + 2n) await new Promise((r) => setTimeout(r, 3000));
  const p12 = await payment(vendor, 0.1);
  await attempt("A12", "Agent pays after its permission expired, with two genuine admin signatures", agentEvm, "executePayment", [p12, sign([a2, a3], paymentDigestV2(9800n, vault, agent.pub.evmAddress, p12))], BROADCAST ? "AgentNotActive" : "(dry run: not expired yet)", "server");
  const until = (await now()) + 14n * 86_400n;
  await attempt("G3", "Administrators (2 of 3) restore the agent for 14 days", relayerEvm, "executeAdminAction", await adminCall(AdminOp.SetAgentLimits, adminData.setAgentLimits(agent.pub.evmAddress, NATIVE, E18, 2n * E18, until), [a1, a3]), "executed");

  // A transaction outside the agent's vault-only window: QoreChain refuses it before inclusion
  if (BROADCAST) {
    const wallet = createWalletClient({ account: agentEvm, chain: qoreDianaTestnet, transport: http(QORE_NETWORK.evmRpc) });
    try {
      const h = await wallet.sendTransaction({ to: ATTACKER, value: 1n, gas: 21_000n, gasPrice, type: "legacy" } as never);
      const r = await evm.waitForTransactionReceipt({ hash: h, timeout: 60_000 });
      rec({ id: "A13", scenario: "Agent sends QOR to 0x…bEEF directly, outside its vault-only window", attacker: "server", expected: "refused before inclusion", outcome: r.status === "success" ? "executed" : "rejected-by-contract", txHash: h, block: r.blockNumber.toString() });
    } catch (e) {
      const c = classifyEvmWindowRejection(e);
      rec({ id: "A13", scenario: "Agent sends QOR to 0x…bEEF directly, outside its vault-only window", attacker: "server", expected: "refused before inclusion", outcome: "rejected-by-chain", error: c ? `window: ${JSON.stringify(c)}` : errorName(e) });
    }
  }
} finally {
  if (BROADCAST) await closeWindows();
}

const balAfter = await evm.getBalance({ address: vault });
const summary = {
  checkedAt: new Date().toISOString(), network: "qorechain-diana", vault, broadcast: BROADCAST,
  vaultBalanceBefore: (Number(balBefore) / 1e18).toString(), vaultBalanceAfter: (Number(balAfter) / 1e18).toString(),
  counts: results.reduce<Record<string, number>>((m, r) => ((m[r.outcome] = (m[r.outcome] ?? 0) + 1), m), {}),
  results,
};
if (BROADCAST) writeFileSync(resolve(root, "deployments/v2-live-results.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`\nvault balance ${summary.vaultBalanceBefore} -> ${summary.vaultBalanceAfter} QOR`, summary.counts);
