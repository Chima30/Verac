/**
 * Drill-day watch for the Q-Day Survivor accounts. Every 30 seconds it reads, for the drill account and the drill admin:
 * EVM window state, account sequence, QOR balance (plus the drill account's fest tokens), and the drill vault's balance,
 * pause state and the drill agent's rights.
 *
 * Defence: if an EVM window is ever open on either account, it CLOSES IT AT ONCE with that account's hybrid key
 * (classical + ML-DSA-87), which the attack bot does not have. Nothing else is ever sent.
 *
 * Every reading and every action is appended to deployments/qday-watch.jsonl (public data only) as evidence.
 *
 *   tsx qday-watch.ts            run until 19 Nov 2026 00:10 UTC or Ctrl+C
 *   tsx qday-watch.ts --once     one reading (and a close, if a window is open), then exit
 *   --interval N                 seconds between readings (default 30, minimum 10)
 *
 * Keep the computer awake while it runs.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StargateClient } from "@cosmjs/stargate";
import { EthNativeSigner, closeEvmWindowMsg, pqcKeyFromRecoveryCode, unifiedAccountFromSeed, type UnifiedAccount } from "@qorechain/sdk";
import { getAddress, type Abi, type Hex } from "viem";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { QoreReader } from "../src/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CHAIN_ID = "qorechain-diana";
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const LOG = resolve(root, "deployments/qday-watch.jsonl");
const STOP_AT = Date.UTC(2026, 10, 19, 0, 10);
const once = process.argv.includes("--once");
const iIdx = process.argv.indexOf("--interval");
const intervalS = Math.max(10, iIdx >= 0 ? Number(process.argv[iIdx + 1]) : 30);
const FEST: Record<string, string> = {
  fUSD: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA", fETH: "erc20:0x02292293c13880a26242690eb70a0e42B8E91c28", fBTC: "erc20:0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A",
};

const dep = JSON.parse(readFileSync(resolve(root, "deployments/qday-drill.json"), "utf8")) as { TreasuryVault: Hex; drillAccount: Hex };
const TV = JSON.parse(readFileSync(resolve(root, "contracts/out/TreasuryVault.sol/TreasuryVault.json"), "utf8")).abi as Abi;
const accounts = (["drill", "admin"] as const).map((role) => {
  const dir = resolve(root, `.secrets/qday-${role}`);
  const pub = JSON.parse(readFileSync(resolve(dir, "account.json"), "utf8")) as { qorAddress: string; evmAddress: string; mlDsa87PublicKey: string };
  return { role, dir, pub };
});

const reader = new QoreReader();
await reader.assertConnectedToTestnet();
const rest = QORE_NETWORK.rest;
const get = async <T>(path: string): Promise<T> => (await (await fetch(`${rest}${path}`)).json()) as T;
const log = (entry: Record<string, unknown>) => appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");

/** Closes an open window with the account's hybrid key. Keys are read from disk only at this moment. */
async function closeWindow(a: (typeof accounts)[number]): Promise<string> {
  const key = readFileSync(resolve(a.dir, "ecdsa-private-key.txt"), "utf8").trim();
  const pq = pqcKeyFromRecoveryCode(readFileSync(resolve(a.dir, "pqc-recovery-code.txt"), "utf8").trim(), a.pub.qorAddress);
  if (Buffer.from(pq.publicKey).toString("hex") !== a.pub.mlDsa87PublicKey) throw new Error("recovery code does not match the recorded key");
  const ua: UnifiedAccount = { ...unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.replace(/^0x/, ""), "hex")), { pqcSecret: crypto.getRandomValues(new Uint8Array(32)) }), pqc: pq };
  const acc = await get<{ account?: { account_number?: string; sequence?: string } }>(`/cosmos/auth/v1beta1/accounts/${ua.cosmos}`);
  const client = await StargateClient.connect(QORE_NETWORK.rpc);
  try {
    const res = await new EthNativeSigner(ua, { signMode: "hybrid", rest }).signAndBroadcast(client, {
      chainId: CHAIN_ID, messages: [closeEvmWindowMsg(ua.cosmos)], fee: { amount: [{ denom: "uqor", amount: "45000" }], gas: "300000" },
      accountNumber: BigInt(acc.account?.account_number ?? "0"), sequence: BigInt(acc.account?.sequence ?? "0"),
    });
    return res.code === 0 ? `closed, tx ${res.transactionHash}` : `close FAILED code ${res.code}: ${res.rawLog}`;
  } finally { client.disconnect(); }
}

let prev: Record<string, string> = {};
async function tick() {
  const snap: Record<string, string> = {};
  const alerts: string[] = [];
  for (const a of accounts) {
    const [w, acc, bal] = await Promise.all([
      reader.evmWindow(a.pub.qorAddress),
      get<{ account?: { sequence?: string } }>(`/cosmos/auth/v1beta1/accounts/${a.pub.qorAddress}`),
      get<{ balances?: Array<{ denom: string; amount: string }> }>(`/cosmos/bank/v1beta1/balances/${a.pub.qorAddress}`),
    ]);
    const b = Object.fromEntries((bal.balances ?? []).map((x) => [x.denom, x.amount]));
    snap[`${a.role}.window`] = w.live ? `OPEN(${w.remainingTxs} txs, ${w.remainingBlocks} blocks)` : "closed";
    snap[`${a.role}.sequence`] = acc.account?.sequence ?? "?";
    snap[`${a.role}.QOR`] = (Number(b.uqor ?? 0) / 1e6).toFixed(6);
    if (a.role === "drill") for (const [sym, denom] of Object.entries(FEST)) snap[`drill.${sym}`] = b[denom] ?? "0";
    if (w.live) {
      alerts.push(`${a.role} EVM window OPEN`);
      let result: string;
      try { result = await closeWindow(a); } catch (e) { result = `close FAILED: ${e instanceof Error ? e.message : e}`; }
      alerts.push(`${a.role} window ${result}`);
      log({ type: "action", account: a.role, action: "close-window", result });
    }
  }
  const [vBal, paused, lim] = await Promise.all([
    reader.evm.getBalance({ address: dep.TreasuryVault }),
    reader.evm.readContract({ address: dep.TreasuryVault, abi: TV, functionName: "paused" }) as Promise<boolean>,
    reader.evm.readContract({ address: dep.TreasuryVault, abi: TV, functionName: "limits", args: [getAddress(dep.drillAccount), NATIVE] }) as Promise<readonly [boolean, ...bigint[]]>,
  ]);
  snap["vault.QOR"] = (Number(vBal) / 1e18).toFixed(6);
  snap["vault.paused"] = String(paused);
  snap["vault.drillAgentActive"] = String(lim[0]);
  if (!paused) alerts.push("vault is NOT paused");
  if (lim[0]) alerts.push("drill agent is ACTIVE on the vault");

  const changes = Object.entries(snap).filter(([k, v]) => prev[k] !== undefined && prev[k] !== v).map(([k, v]) => `${k}: ${prev[k]} -> ${v}`);
  log({ type: "reading", snap, changes, alerts });
  const t = new Date().toISOString().slice(11, 19);
  console.log(`${t}Z  drill ${snap["drill.QOR"]} QOR seq ${snap["drill.sequence"]} window ${snap["drill.window"]} | admin window ${snap["admin.window"]} | vault ${snap["vault.QOR"]} QOR paused=${paused} agent=${lim[0]}`);
  for (const c of changes) console.log(`          CHANGE ${c}`);
  for (const al of alerts) console.log(`          ALERT  ${al}`);
  prev = snap;
}

console.log(`Watching (every ${intervalS}s). Log: ${LOG}. Stop with Ctrl+C.`);
log({ type: "start", intervalS, once });
do {
  try { await tick(); } catch (e) { const m = e instanceof Error ? e.message : String(e); console.log(`reading failed (will retry): ${m}`); log({ type: "error", message: m }); }
  if (once || Date.now() > STOP_AT) break;
  await new Promise((r) => setTimeout(r, intervalS * 1000));
} while (true);
log({ type: "stop" });
