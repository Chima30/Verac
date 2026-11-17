/**
 * Checks that the Q-Day drill account cannot get around its limits, using ONLY what the attack bot will have: the
 * classical ECDSA key. Nothing here can move value out of the account:
 *
 *   A. read-only state: windows closed, key registered, owners, approvers, caps or freeze, vault balance
 *   B. contract simulations (eth_call) from the drill address: no signature, nothing sent
 *   C. live attempts signed with the classical key only, each expected to be refused before inclusion:
 *      native QOR transfer (to itself), native fest-token transfer (to itself), opening an EVM window, linking a delegated
 *      key, an EVM transfer (to itself) and an ERC-20 approval (to the 0x…dEaD address) with no window open.
 *      If the chain ever ACCEPTED one, the script undoes it at once with the hybrid key (close the window / revoke the
 *      key) and reports a failure.
 *
 * Expectations follow the vault's state: a paused vault reverts EnforcedPause, a revoked agent AgentNotActive.
 * Results are printed and written to deployments/qday-drill-verification.json. Exit code 1 if any check fails.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StargateClient } from "@cosmjs/stargate";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  EthNativeSigner, classifyEvmWindowRejection, closeEvmWindowMsg, linkAuthenticatorMsgs, msg, openEvmWindowMsg, pqcKeyFromRecoveryCode,
  revokeAuthenticatorMsg, signAuthenticatorLinkEd25519, unifiedAccountFromSeed, type UnifiedAccount,
} from "@qorechain/sdk";
import { BaseError, ContractFunctionRevertedError, createWalletClient, encodeFunctionData, erc20Abi, getAddress, http, maxUint256, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { QoreReader, qoreDianaTestnet } from "../src/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CHAIN_ID = "qorechain-diana";
const dep = JSON.parse(readFileSync(resolve(root, "deployments/qday-drill.json"), "utf8")) as { PolicyManager: Hex; TreasuryVault: Hex; admin: Hex; drillAccount: Hex };
const drillDir = resolve(root, ".secrets/qday-drill");
const drillPub = JSON.parse(readFileSync(resolve(drillDir, "account.json"), "utf8")) as { qorAddress: string; evmAddress: Hex; mlDsa87PublicKey: string };
const adminPub = JSON.parse(readFileSync(resolve(root, ".secrets/qday-admin/account.json"), "utf8")) as { qorAddress: string };
const abi = (n: string) => JSON.parse(readFileSync(resolve(root, `contracts/out/${n}.sol/${n}.json`), "utf8")).abi as Abi;
const TV = abi("TreasuryVault"), PM = abi("PolicyManager");
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const E18 = 10n ** 18n;
const ATTACKER = getAddress("0x000000000000000000000000000000000000bEEF");
const DEAD = getAddress("0x000000000000000000000000000000000000dEaD");
const FUSD_ERC20 = getAddress("0x97143B771D34ddb9130b807b135Ae675A5a963CA");
const FUSD_DENOM = `erc20:${FUSD_ERC20}`;
const drill = getAddress(drillPub.evmAddress);

const reader = new QoreReader();
const evm = reader.evm;
await reader.assertConnectedToTestnet();
const results: Array<{ check: string; expected: string; actual: string; pass: boolean }> = [];
const rec = (check: string, expected: string, actual: string, pass: boolean) => { results.push({ check, expected, actual, pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${check}\n      expected ${expected}; got ${actual}`); };
const read = (address: Hex, a: Abi, functionName: string, args: readonly unknown[] = []) => evm.readContract({ address, abi: a, functionName, args }) as Promise<unknown>;

// ---- A. state
for (const [who, q] of [["drill account", drillPub.qorAddress], ["drill admin", adminPub.qorAddress]] as const) {
  const w = await reader.evmWindow(q);
  rec(`${who}: EVM window`, "closed", w.live ? `OPEN (${w.remainingTxs} txs left)` : "closed", !w.live);
}
const pq = (await reader.pqcStatus(drillPub.qorAddress)) as { registered?: boolean };
rec("drill account: ML-DSA-87 key registered", "registered", String(pq.registered), pq.registered === true);
const vOwner = getAddress(String(await read(dep.TreasuryVault, TV, "owner"))), pOwner = getAddress(String(await read(dep.PolicyManager, PM, "owner")));
rec("vault owner is the admin, not the drill account", dep.admin, vOwner, vOwner === getAddress(dep.admin));
rec("policy owner is the admin, not the drill account", dep.admin, pOwner, pOwner === getAddress(dep.admin));
rec("drill account is not an approver", "false", String(await read(dep.TreasuryVault, TV, "isApprover", [drill])), (await read(dep.TreasuryVault, TV, "isApprover", [drill])) === false);
rec("drill account is not an approved recipient", "false", String(await read(dep.TreasuryVault, TV, "approvedRecipient", [drill])), (await read(dep.TreasuryVault, TV, "approvedRecipient", [drill])) === false);
const paused = (await read(dep.TreasuryVault, TV, "paused")) as boolean;
const l = (await read(dep.TreasuryVault, TV, "limits", [drill, NATIVE])) as readonly [boolean, bigint, bigint, bigint, bigint];
const capsDesc = `active=${l[0]} perTx=${Number(l[2]) / 1e18} daily=${Number(l[3]) / 1e18} auto=${l[4]}`;
if (l[0]) rec("drill agent caps", "active, 0.5 per tx, 1 per day, auto-approve 0", capsDesc, l[2] === E18 / 2n && l[3] === E18 && l[4] === 0n);
else rec("drill agent rights", "revoked (frozen for the drill)", capsDesc, true);
rec("vault state", paused ? "paused (frozen for the drill)" : "running", paused ? "paused" : "running", true);
const bal = await evm.getBalance({ address: dep.TreasuryVault });
rec("vault balance", "5 QOR", `${Number(bal) / 1e18} QOR`, bal === 5n * E18);
const active = (await read(dep.PolicyManager, PM, "activeVersion")) as bigint;

// ---- B. simulations from the drill address
const block = await evm.getBlock();
const pay = (to: Hex, amount: bigint, nonce: bigint) => ({ token: NATIVE, to, amount, purposeHash: `0x${"11".repeat(32)}` as Hex, policyVersion: active, expiry: block.timestamp + 3600n, nonce });
// A paused vault stops executePayment first; a revoked agent fails the agent check before any cap.
const payErr = (normal: string) => (paused ? "EnforcedPause" : !l[0] ? "AgentNotActive" : normal);
const sim = async (label: string, address: Hex, a: Abi, functionName: string, args: readonly unknown[], want: string) => {
  try {
    await evm.simulateContract({ account: drill, address, abi: a, functionName, args });
    rec(label, `revert ${want}`, "WOULD SUCCEED", false);
  } catch (e) {
    const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    const name = r instanceof ContractFunctionRevertedError ? (r.data?.errorName ?? r.reason ?? "revert") : (e instanceof Error ? e.message.split("\n")[0]! : String(e));
    rec(label, `revert ${want}`, `revert ${name}`, name === want);
  }
};
await sim("pay 0.4 QOR to the approved recipient without approval", dep.TreasuryVault, TV, "executePayment", [pay(dep.admin, 4n * E18 / 10n, 1n)], payErr("InsufficientApprovals"));
await sim("pay 0.4 QOR to an attacker address", dep.TreasuryVault, TV, "executePayment", [pay(ATTACKER, 4n * E18 / 10n, 2n)], payErr("InsufficientApprovals"));
await sim("pay 0.6 QOR (over the 0.5 per-payment cap)", dep.TreasuryVault, TV, "executePayment", [pay(dep.admin, 6n * E18 / 10n, 3n)], payErr("ExceedsPerTxCap"));
await sim("pay the whole 5 QOR vault", dep.TreasuryVault, TV, "executePayment", [pay(ATTACKER, 5n * E18, 4n)], payErr("ExceedsPerTxCap"));
await sim("approve its own payment", dep.TreasuryVault, TV, "approvePayment", [drill, pay(ATTACKER, 4n * E18 / 10n, 5n)], "NotApprover");
await sim("add the attacker as an approved recipient", dep.TreasuryVault, TV, "setApprovedRecipient", [ATTACKER, true], "OwnableUnauthorizedAccount");
await sim("raise its own caps", dep.TreasuryVault, TV, "setAgentLimits", [drill, NATIVE, 5n * E18, 5n * E18, 5n * E18, 2n ** 63n], "OwnableUnauthorizedAccount");
await sim("make itself an approver", dep.TreasuryVault, TV, "setApprover", [drill, true], "OwnableUnauthorizedAccount");
await sim("take ownership of the vault", dep.TreasuryVault, TV, "transferOwnership", [ATTACKER], "OwnableUnauthorizedAccount");
await sim(paused ? "unpause the vault" : "pause the vault", dep.TreasuryVault, TV, paused ? "unpause" : "pause", [], paused ? "OwnableUnauthorizedAccount" : "NotGuardianOrOwner");
await sim("swap the policy", dep.PolicyManager, PM, "activate", [`0x${"22".repeat(32)}`], "OwnableUnauthorizedAccount");

// ---- C. live attempts with the classical key only
const key = readFileSync(resolve(drillDir, "ecdsa-private-key.txt"), "utf8").trim() as Hex;
const evmAcct = privateKeyToAccount(key);
if (evmAcct.address !== drill) throw new Error("Drill key does not match its address; refusing.");
const classical = unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.slice(2), "hex")), { pqcSecret: crypto.getRandomValues(new Uint8Array(32)) });
// The hybrid account is used ONLY to undo an attempt the chain wrongly accepted.
const hybrid = (): UnifiedAccount => ({ ...classical, pqc: pqcKeyFromRecoveryCode(readFileSync(resolve(drillDir, "pqc-recovery-code.txt"), "utf8").trim(), drillPub.qorAddress) });
const nativeTx = async (ua: UnifiedAccount, mode: "classical" | "hybrid", messages: Parameters<EthNativeSigner["sign"]>[0]["messages"], gas: number) => {
  const acc = (await (await fetch(`${QORE_NETWORK.rest}/cosmos/auth/v1beta1/accounts/${ua.cosmos}`)).json()) as { account?: { account_number?: string; sequence?: string } };
  const client = await StargateClient.connect(QORE_NETWORK.rpc);
  try {
    const res = await new EthNativeSigner(ua, { signMode: mode, rest: QORE_NETWORK.rest }).signAndBroadcast(client, {
      chainId: CHAIN_ID, messages, fee: { amount: [{ denom: "uqor", amount: String(Math.ceil(gas * 0.15)) }], gas: String(gas) },
      accountNumber: BigInt(acc.account?.account_number ?? "0"), sequence: BigInt(acc.account?.sequence ?? "0"),
    });
    return { accepted: res.code === 0, detail: res.code === 0 ? `ACCEPTED, tx ${res.transactionHash}` : `refused, code ${res.code}: ${(res.rawLog ?? "").slice(0, 160)}` };
  } catch (e) { return { accepted: false, detail: `refused: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200)}` }; }
  finally { client.disconnect(); }
};
const classicalAttempt = async (label: string, messages: Parameters<EthNativeSigner["sign"]>[0]["messages"], gas: number, undo?: () => Promise<string>) => {
  const r = await nativeTx(classical, "classical", messages, gas);
  let actual = r.detail;
  if (r.accepted && undo) actual += `; UNDONE: ${await undo()}`;
  rec(`${label} (stolen ECDSA key alone)`, "refused", actual, !r.accepted);
};

const before = await evm.getBalance({ address: drill });
const fusdBefore = (await (await fetch(`${QORE_NETWORK.rest}/cosmos/bank/v1beta1/balances/${drillPub.qorAddress}/by_denom?denom=${encodeURIComponent(FUSD_DENOM)}`)).json()) as { balance?: { amount?: string } };

await classicalAttempt("native QOR transfer", [msg.bank.send({ fromAddress: classical.cosmos, toAddress: classical.cosmos, amount: [{ denom: "uqor", amount: "10000" }] })], 200_000);
await classicalAttempt("native fest-token (fUSD) transfer", [msg.bank.send({ fromAddress: classical.cosmos, toAddress: classical.cosmos, amount: [{ denom: FUSD_DENOM, amount: "1" }] })], 200_000);
await classicalAttempt("open an EVM window", [openEvmWindowMsg({ sender: classical.cosmos, blocks: 20, maxTxs: 1, maxValue: "1000" })], 500_000,
  async () => (await nativeTx(hybrid(), "hybrid", [closeEvmWindowMsg(classical.cosmos)], 300_000)).detail);
{
  const seed = ed25519.utils.randomSecretKey();
  const proof = signAuthenticatorLinkEd25519({ chainId: CHAIN_ID, account: classical.cosmos, privateKey: seed });
  const msgs = linkAuthenticatorMsgs({
    owner: classical.cosmos, chainId: CHAIN_ID, scheme: "ed25519", pubkey: proof.pubkey, possessionProof: proof.possessionProof,
    permissions: ["send"], expiryUnix: Math.floor(Date.now() / 1000) + 3600, label: "qday-verify-attacker-key",
    spendingRule: { id: "qday-verify", enabled: true, perTxLimit: "1", dailyLimit: "1", allowedDenoms: ["uqor"], denomLimits: [{ denom: "uqor", perTxLimit: "1", dailyLimit: "1" }], allowedEvmCalls: [] },
  });
  await classicalAttempt("link a delegated key (smart-account backdoor)", msgs, 600_000,
    async () => (await nativeTx(hybrid(), "hybrid", [revokeAuthenticatorMsg({ owner: classical.cosmos, scheme: "ed25519", pubkey: proof.pubkey })], 300_000)).detail);
}
const wallet = createWalletClient({ account: evmAcct, chain: qoreDianaTestnet, transport: http(QORE_NETWORK.evmRpc) });
const evmAttempt = async (label: string, tx: { to: Hex; value?: bigint; data?: Hex; gas: bigint }) => {
  let actual: string, refused: boolean;
  try {
    const h = await wallet.sendTransaction({ ...tx, gasPrice: await evm.getGasPrice(), type: "legacy" } as never);
    const r = await evm.waitForTransactionReceipt({ hash: h, timeout: 60_000 }).catch(() => null);
    refused = !r || r.status !== "success"; actual = r ? `INCLUDED, status ${r.status}, tx ${h}` : `sent ${h} but never included`;
  } catch (e) {
    refused = true;
    const c = classifyEvmWindowRejection(e);
    actual = `refused before inclusion: ${c ? JSON.stringify(c).slice(0, 160) : (e instanceof Error ? e.message.split("\n").find((x) => x.trim()) ?? "" : String(e)).slice(0, 200)}`;
  }
  rec(`${label} (stolen ECDSA key alone)`, "refused", actual, refused);
};
await evmAttempt("EVM transfer with the window closed", { to: drill, value: 1n, gas: 21_000n });
await evmAttempt("ERC-20 approval (fUSD, unlimited, to 0x…dEaD)", { to: FUSD_ERC20, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [DEAD, maxUint256] }), gas: 80_000n });

const after = await evm.getBalance({ address: drill });
const fusdAfter = (await (await fetch(`${QORE_NETWORK.rest}/cosmos/bank/v1beta1/balances/${drillPub.qorAddress}/by_denom?denom=${encodeURIComponent(FUSD_DENOM)}`)).json()) as { balance?: { amount?: string } };
rec("drill QOR balance unchanged by the attempts", String(before), String(after), after === before);
rec("drill fUSD balance unchanged by the attempts", String(fusdBefore.balance?.amount), String(fusdAfter.balance?.amount), fusdBefore.balance?.amount === fusdAfter.balance?.amount);
const wAfter = await reader.evmWindow(drillPub.qorAddress);
rec("drill account: EVM window after the attempts", "closed", wAfter.live ? "OPEN" : "closed", !wAfter.live);

const failed = results.filter((r) => !r.pass).length;
writeFileSync(resolve(root, "deployments/qday-drill-verification.json"), JSON.stringify({ checkedAt: new Date().toISOString(), drillAccount: drill, vault: dep.TreasuryVault, policyManager: dep.PolicyManager, vaultPaused: paused, agentActive: l[0], passed: results.length - failed, failed, results }, null, 2) + "\n");
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
if (failed) process.exitCode = 1;
