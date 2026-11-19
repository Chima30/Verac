/**
 * Sets up an ISOLATED TreasuryVault V2 environment on Diana testnet. It shares no key or contract with Verac's existing
 * treasury, which is not touched.
 *
 *   .secrets/v2/admin-1, admin-2, admin-3   administrators (ML-DSA-87 keys registered with proof of possession)
 *   .secrets/v2/agent                        the payment agent (capped; not an administrator)
 *   .secrets/v2/relayer                      deploys and relays transactions; also the guardian (can only pause)
 *
 * The administrators' keys stand in for keys held on each administrator's own device. They are never given to the
 * website server. Admin actions below are signed here, with the admin keys, exactly as the admin tool would.
 *
 * Funding comes from the throwaway category-proof account (.secrets/category-proof-account.json), which is also the
 * vault's one approved recipient, so test payments return to it.
 *
 * DRY RUN BY DEFAULT: prints what it would do. --broadcast sends. Re-running continues where it stopped.
 * Public results go to deployments/v2-diana.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeEvmWindowMsg, msg, openEvmWindowMsg, unifiedAccountFromSeed, type UnifiedAccount } from "@qorechain/sdk";
import { createWalletClient, getAddress, http, keccak256, toBytes, type Hex } from "viem";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { QoreReader, qoreDianaTestnet } from "../src/index";
import { AdminOp, adminData, adminDigestV2, paymentDigestV2, signApprovalV2, sortSigs, treasuryVaultV2Abi } from "../src/v2";
import { LocalAccount, assertDiana, broadcastNative, pqcRegistered, registerPqc, uqorBalance } from "./lib/accounts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BROADCAST = process.argv.includes("--broadcast");
const OUT = resolve(root, "deployments/v2-diana.json");
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const E18 = 10n ** 18n;
const QOR = (n: number) => BigInt(Math.round(n * 1e6)); // uqor

const state = (existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { network: "qorechain-diana", evmChainId: 9800, txs: {} }) as Record<string, any> & { txs: Record<string, string> };
const save = () => writeFileSync(OUT, JSON.stringify(state, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
const step = (s: string) => console.log(`${BROADCAST ? "" : "[dry run] "}${s}`);

await assertDiana();
const reader = new QoreReader();
const evm = reader.evm;

// ---- funder: the category-proof account (single-file layout)
const fFile = JSON.parse(readFileSync(resolve(root, ".secrets/category-proof-account.json"), "utf8")) as { qorAddress: string; evmAddress: Hex; secp256k1PrivateKey: string; mlDsa87PublicKey: string; mlDsa87SecretKey: string };
const unhex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const funder: UnifiedAccount = { ...unifiedAccountFromSeed(unhex(fFile.secp256k1PrivateKey), { pqcSecret: crypto.getRandomValues(new Uint8Array(32)) }), pqc: { publicKey: unhex(fFile.mlDsa87PublicKey), secretKey: unhex(fFile.mlDsa87SecretKey) } };
if (funder.cosmos !== fFile.qorAddress) throw new Error("funder key mismatch");
const vendor = getAddress(fFile.evmAddress);

// ---- 1. accounts
const dir = (n: string) => resolve(root, ".secrets/v2", n);
const admins = ["admin-1", "admin-2", "admin-3"].map((n) => LocalAccount.loadOrCreate(dir(n), "v2-admin"));
const agent = LocalAccount.loadOrCreate(dir("agent"), "v2-agent");
const relayer = LocalAccount.loadOrCreate(dir("relayer"), "v2-relayer");
const all = [...admins, agent, relayer];
state.accounts = Object.fromEntries(all.map((a) => [a.dir.split(/[\\/]/).pop(), { evm: a.pub.evmAddress, qor: a.pub.qorAddress }]));
state.vendor = vendor;
if (BROADCAST) save();
for (const a of all) console.log(`account ${a.dir.split(/[\\/]/).pop()?.padEnd(8)} ${a.pub.evmAddress} ${a.pub.qorAddress}`);

// ---- 2. funding
const targets: Array<[LocalAccount, bigint]> = [...admins.map((a) => [a, QOR(1)] as [LocalAccount, bigint]), [agent, QOR(4)], [relayer, QOR(12)]];
for (const [a, want] of targets) {
  const have = await uqorBalance(a.pub.qorAddress);
  if (have >= want - QOR(0.5)) continue;
  const send = want - have;
  step(`fund ${a.pub.qorAddress} with ${Number(send) / 1e6} QOR from the category-proof account`);
  if (!BROADCAST) continue;
  const r = await broadcastNative(funder, "hybrid", [msg.bank.send({ fromAddress: funder.cosmos, toAddress: a.pub.qorAddress, amount: [{ denom: "uqor", amount: send.toString() }] })], 300_000);
  if (r.code !== 0) throw new Error(`funding failed: ${r.rawLog}`);
  state.txs[`fund ${a.dir.split(/[\\/]/).pop()}`] = r.hash; save();
}

// ---- 3. ML-DSA-87 registration
for (const a of all) {
  const s = await pqcRegistered(a.pub.qorAddress);
  if (s.found) { if (s.pub !== a.pub.mlDsa87PublicKey || !s.proven) throw new Error(`${a.dir}: a different or unproven key is registered`); continue; }
  step(`register the ML-DSA-87 key of ${a.pub.qorAddress}`);
  if (!BROADCAST) continue;
  const r = await registerPqc(a);
  if (r.code !== 0) throw new Error(`registration failed: ${r.rawLog}`);
  state.txs[`register pqc ${a.dir.split(/[\\/]/).pop()}`] = r.hash; save();
}

// ---- 4. deploy and configure (one relayer window, closed afterwards)
const art = JSON.parse(readFileSync(resolve(root, "deployments/artifacts/TreasuryVaultV2.json"), "utf8")) as { bytecode: { object: Hex }; sourceSha256: string };
const adminAddrs = admins.map((a) => a.pub.evmAddress).sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
const policyHash = keccak256(toBytes("verac-v2-policy-v1: payments need 2 of 3 administrators; agent 1 QOR per payment, 2 QOR per day"));
const validUntil = BigInt(Math.floor(Date.now() / 1000) + 14 * 86_400); // past the 2 December deadline
const configured = !!state.configuredAt;
step(`${state.TreasuryVaultV2 ? "use" : "deploy"} TreasuryVaultV2 (admins ${adminAddrs.join(", ")}, threshold 2); then: approve recipient ${vendor}, agent ${agent.pub.evmAddress} 1 QOR/payment 2 QOR/day until ${new Date(Number(validUntil) * 1000).toISOString()}, guardian ${relayer.pub.evmAddress}, fund 5 QOR`);
if (!BROADCAST || configured) { console.log(configured ? `Already configured: ${state.TreasuryVaultV2}` : "DRY RUN: nothing was sent. Re-run with --broadcast."); process.exit(0); }

const rUa = relayer.unified();
const rEvm = relayer.evm();
const wallet = createWalletClient({ account: rEvm, chain: qoreDianaTestnet, transport: http(QORE_NETWORK.evmRpc) });
const gasPrice = await evm.getGasPrice();
const wait = async (label: string, hash: Hex) => {
  const r = await evm.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 2_000 });
  console.log(`${label}: ${r.status}, block ${r.blockNumber}, tx ${hash}`);
  if (r.status !== "success") throw new Error(`${label} reverted`);
  state.txs[label] = hash; save();
  return r;
};

const open = await broadcastNative(rUa, "hybrid", [openEvmWindowMsg({ sender: rUa.cosmos, blocks: 300, maxTxs: 8, maxValue: QOR(9).toString() })], 500_000);
if (open.code !== 0) throw new Error(`window open failed: ${open.rawLog}`);
state.txs["relayer window open"] = open.hash; save();
console.log(`relayer window opened: ${open.hash}`);
try {
  if (!state.TreasuryVaultV2) {
    const r = await wait("deploy TreasuryVaultV2", await wallet.deployContract({ abi: treasuryVaultV2Abi, bytecode: art.bytecode.object, args: [adminAddrs, 2, policyHash], gasPrice, type: "legacy" } as never));
    state.TreasuryVaultV2 = getAddress(r.contractAddress!);
    state.artifactSourceSha256 = art.sourceSha256;
    state.admins = adminAddrs; state.threshold = 2; state.policyHash = policyHash; save();
  }
  const vault = state.TreasuryVaultV2 as Hex;

  // The off-chain digest must equal the contract's: checked here on the live contract.
  const probe = { token: NATIVE, to: vendor, amount: 1n, purposeHash: policyHash, policyVersion: 1n, expiry: 1_900_000_000n, nonce: 7n } as const;
  const onChain = await evm.readContract({ address: vault, abi: treasuryVaultV2Abi, functionName: "paymentDigest", args: [agent.pub.evmAddress, probe] });
  if (onChain !== paymentDigestV2(9800n, vault, agent.pub.evmAddress, probe)) throw new Error("payment digest mismatch between contract and TypeScript");
  console.log("digest check: contract and TypeScript agree");

  const signers = [admins[0]!, admins[1]!];
  const adminAction = async (label: string, op: AdminOp, data: Hex) => {
    const nonce = (await evm.readContract({ address: vault, abi: treasuryVaultV2Abi, functionName: "adminNonce" })) as bigint;
    const expiry = (await evm.getBlock()).timestamp + 3600n;
    const digest = adminDigestV2(9800n, vault, op, data, nonce, expiry);
    const chainDigest = await evm.readContract({ address: vault, abi: treasuryVaultV2Abi, functionName: "adminDigest", args: [op, data, nonce, expiry] });
    if (chainDigest !== digest) throw new Error("admin digest mismatch");
    const sigs = sortSigs(signers.map((a) => ({ signer: a.pub.evmAddress, signature: signApprovalV2(a.pqc().secretKey, digest) })));
    const { request } = await evm.simulateContract({ account: rEvm, address: vault, abi: treasuryVaultV2Abi, functionName: "executeAdminAction", args: [op, data, nonce, expiry, sigs] });
    return wait(label, await wallet.writeContract({ ...request, gasPrice, type: "legacy" } as never));
  };
  await adminAction("admin: approve recipient (2 of 3 signed)", AdminOp.SetRecipient, adminData.setRecipient(vendor, true));
  await adminAction("admin: agent limits 1 QOR/payment, 2 QOR/day (2 of 3 signed)", AdminOp.SetAgentLimits, adminData.setAgentLimits(agent.pub.evmAddress, NATIVE, E18, 2n * E18, validUntil));
  await adminAction("admin: guardian = relayer (2 of 3 signed)", AdminOp.SetGuardian, adminData.setGuardian(relayer.pub.evmAddress, true));
  await wait("fund vault 5 QOR", await wallet.sendTransaction({ to: vault, value: 5n * E18, gasPrice, type: "legacy" } as never));
  state.agentLimits = { perTxCap: "1", dailyCap: "2", validUntil: new Date(Number(validUntil) * 1000).toISOString() };
  state.configuredAt = new Date().toISOString(); save();
} finally {
  const w = await reader.evmWindow(rUa.cosmos);
  if (w.live) {
    const c = await broadcastNative(rUa, "hybrid", [closeEvmWindowMsg(rUa.cosmos)], 300_000);
    console.log(c.code === 0 ? `relayer window closed: ${c.hash}` : `WARNING: could not close the window: ${c.rawLog}`);
    if (c.code === 0) { state.txs["relayer window close"] = c.hash; save(); } else process.exitCode = 1;
  }
}
console.log(`TreasuryVaultV2 ready at ${state.TreasuryVaultV2}. Wrote ${OUT}`);
