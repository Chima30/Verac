/**
 * Checks that the Q-Day drill account cannot get around its limits, using ONLY what the attack bot will have: the
 * classical ECDSA key. Nothing here can move value out of the account:
 *
 *   A. read-only state: windows closed, owners, approvers, caps, vault balance
 *   B. contract simulations (eth_call) from the drill address: no signature, nothing sent
 *   C. two live attempts signed with the classical key only, both SELF-transfers, expected to be refused before inclusion:
 *      a classical-only native MsgSend, and an EVM transfer with no window open
 *
 * Results are printed and written to deployments/qday-drill-verification.json. Exit code 1 if any check fails.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StargateClient } from "@cosmjs/stargate";
import { EthNativeSigner, classifyEvmWindowRejection, msg, unifiedAccountFromSeed } from "@qorechain/sdk";
import { BaseError, ContractFunctionRevertedError, createWalletClient, getAddress, http, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { QoreReader, qoreDianaTestnet } from "../src/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dep = JSON.parse(readFileSync(resolve(root, "deployments/qday-drill.json"), "utf8")) as { PolicyManager: Hex; TreasuryVault: Hex; admin: Hex; drillAccount: Hex };
const drillPub = JSON.parse(readFileSync(resolve(root, ".secrets/qday-drill/account.json"), "utf8")) as { qorAddress: string; evmAddress: Hex };
const adminPub = JSON.parse(readFileSync(resolve(root, ".secrets/qday-admin/account.json"), "utf8")) as { qorAddress: string };
const abi = (n: string) => JSON.parse(readFileSync(resolve(root, `contracts/out/${n}.sol/${n}.json`), "utf8")).abi as Abi;
const TV = abi("TreasuryVault"), PM = abi("PolicyManager");
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const E18 = 10n ** 18n;
const ATTACKER = getAddress("0x000000000000000000000000000000000000bEEF");
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
const pq = await reader.pqcStatus(drillPub.qorAddress);
rec("drill account: ML-DSA-87 key registered", "registered", JSON.stringify((pq as { registered?: boolean }).registered), (pq as { registered?: boolean }).registered === true);
const vOwner = getAddress(String(await read(dep.TreasuryVault, TV, "owner"))), pOwner = getAddress(String(await read(dep.PolicyManager, PM, "owner")));
rec("vault owner is the admin, not the drill account", dep.admin, vOwner, vOwner === getAddress(dep.admin));
rec("policy owner is the admin, not the drill account", dep.admin, pOwner, pOwner === getAddress(dep.admin));
rec("drill account is not an approver", "false", String(await read(dep.TreasuryVault, TV, "isApprover", [drill])), (await read(dep.TreasuryVault, TV, "isApprover", [drill])) === false);
rec("drill account is not an approved recipient", "false", String(await read(dep.TreasuryVault, TV, "approvedRecipient", [drill])), (await read(dep.TreasuryVault, TV, "approvedRecipient", [drill])) === false);
const l = (await read(dep.TreasuryVault, TV, "limits", [drill, NATIVE])) as readonly [boolean, bigint, bigint, bigint, bigint];
rec("drill agent caps", "active, 0.5 per tx, 1 per day, auto-approve 0", `active=${l[0]} perTx=${Number(l[2]) / 1e18} daily=${Number(l[3]) / 1e18} auto=${l[4]}`, l[0] && l[2] === E18 / 2n && l[3] === E18 && l[4] === 0n);
const bal = await evm.getBalance({ address: dep.TreasuryVault });
rec("vault balance", "5 QOR", `${Number(bal) / 1e18} QOR`, bal === 5n * E18);
const active = (await read(dep.PolicyManager, PM, "activeVersion")) as bigint;

// ---- B. simulations from the drill address
const block = await evm.getBlock();
const pay = (to: Hex, amount: bigint, nonce: bigint) => ({ token: NATIVE, to, amount, purposeHash: `0x${"11".repeat(32)}` as Hex, policyVersion: active, expiry: block.timestamp + 3600n, nonce });
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
await sim("pay 0.4 QOR to the approved recipient without approval", dep.TreasuryVault, TV, "executePayment", [pay(dep.admin, 4n * E18 / 10n, 1n)], "InsufficientApprovals");
await sim("pay 0.4 QOR to an attacker address", dep.TreasuryVault, TV, "executePayment", [pay(ATTACKER, 4n * E18 / 10n, 2n)], "InsufficientApprovals");
await sim("pay 0.6 QOR (over the 0.5 per-payment cap)", dep.TreasuryVault, TV, "executePayment", [pay(dep.admin, 6n * E18 / 10n, 3n)], "ExceedsPerTxCap");
await sim("pay the whole 5 QOR vault", dep.TreasuryVault, TV, "executePayment", [pay(ATTACKER, 5n * E18, 4n)], "ExceedsPerTxCap");
await sim("approve its own payment", dep.TreasuryVault, TV, "approvePayment", [drill, pay(ATTACKER, 4n * E18 / 10n, 5n)], "NotApprover");
await sim("add the attacker as an approved recipient", dep.TreasuryVault, TV, "setApprovedRecipient", [ATTACKER, true], "OwnableUnauthorizedAccount");
await sim("raise its own caps", dep.TreasuryVault, TV, "setAgentLimits", [drill, NATIVE, 5n * E18, 5n * E18, 5n * E18, 2n ** 63n], "OwnableUnauthorizedAccount");
await sim("make itself an approver", dep.TreasuryVault, TV, "setApprover", [drill, true], "OwnableUnauthorizedAccount");
await sim("take ownership of the vault", dep.TreasuryVault, TV, "transferOwnership", [ATTACKER], "OwnableUnauthorizedAccount");
await sim("pause the vault", dep.TreasuryVault, TV, "pause", [], "NotGuardianOrOwner");
await sim("swap the policy", dep.PolicyManager, PM, "activate", [`0x${"22".repeat(32)}`], "OwnableUnauthorizedAccount");

// ---- C. live attempts with the classical key only (self-transfers)
const key = readFileSync(resolve(root, ".secrets/qday-drill/ecdsa-private-key.txt"), "utf8").trim() as Hex;
const evmAcct = privateKeyToAccount(key);
if (evmAcct.address !== drill) throw new Error("Drill key does not match its address; refusing.");
const before = await evm.getBalance({ address: drill });
{ // classical-only native transfer (no ML-DSA signature), to itself
  const ua = unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.slice(2), "hex")), { pqcSecret: crypto.getRandomValues(new Uint8Array(32)) });
  const acc = (await (await fetch(`${QORE_NETWORK.rest}/cosmos/auth/v1beta1/accounts/${ua.cosmos}`)).json()) as { account?: { account_number?: string; sequence?: string } };
  const client = await StargateClient.connect(QORE_NETWORK.rpc);
  let actual: string, refused: boolean;
  try {
    const res = await new EthNativeSigner(ua, { signMode: "classical", rest: QORE_NETWORK.rest }).signAndBroadcast(client, {
      chainId: "qorechain-diana", messages: [msg.bank.send({ fromAddress: ua.cosmos, toAddress: ua.cosmos, amount: [{ denom: "uqor", amount: "10000" }] })],
      fee: { amount: [{ denom: "uqor", amount: "30000" }], gas: "200000" }, accountNumber: BigInt(acc.account?.account_number ?? "0"), sequence: BigInt(acc.account?.sequence ?? "0"),
    });
    refused = res.code !== 0; actual = res.code === 0 ? `ACCEPTED, tx ${res.transactionHash}` : `refused, code ${res.code}: ${(res.rawLog ?? "").slice(0, 160)}`;
  } catch (e) { refused = true; actual = `refused: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200)}`; }
  finally { client.disconnect(); }
  rec("classical-only native transfer (stolen ECDSA key alone)", "refused", actual, refused);
}
{ // EVM transfer with no window, to itself
  const wallet = createWalletClient({ account: evmAcct, chain: qoreDianaTestnet, transport: http(QORE_NETWORK.evmRpc) });
  let actual: string, refused: boolean;
  try {
    const h = await wallet.sendTransaction({ to: drill, value: 1n, gas: 21_000n, gasPrice: await evm.getGasPrice(), type: "legacy" } as never);
    const r = await evm.waitForTransactionReceipt({ hash: h, timeout: 60_000 }).catch(() => null);
    refused = !r || r.status !== "success"; actual = r ? `INCLUDED, status ${r.status}, tx ${h}` : `sent ${h} but never included`;
  } catch (e) {
    refused = true;
    const c = classifyEvmWindowRejection(e);
    actual = `refused before inclusion: ${c ? JSON.stringify(c).slice(0, 160) : (e instanceof Error ? e.message.split("\n").find((x) => x.trim()) ?? "" : String(e)).slice(0, 200)}`;
  }
  rec("EVM transfer with the window closed (stolen ECDSA key alone)", "refused", actual, refused);
}
const after = await evm.getBalance({ address: drill });
rec("drill account balance unchanged by the attempts", String(before), String(after), after === before);

const failed = results.filter((r) => !r.pass).length;
writeFileSync(resolve(root, "deployments/qday-drill-verification.json"), JSON.stringify({ checkedAt: new Date().toISOString(), drillAccount: drill, vault: dep.TreasuryVault, policyManager: dep.PolicyManager, passed: results.length - failed, failed, results }, null, 2) + "\n");
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
if (failed) process.exitCode = 1;
