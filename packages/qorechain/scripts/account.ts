import { qorToEvm } from "@qorechain/sdk";
import { QoreReader } from "../src/index";
const qor = process.argv[2];
if (!qor) throw new Error("usage: tsx account.ts <qor1... address>");
const q = new QoreReader();
await q.assertConnectedToTestnet();
const evm = qorToEvm(qor) as `0x${string}`;
const s = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x && typeof x === "string" && x.length > 120 ? x.slice(0, 24) + "…" : x));
console.log("evm address :", evm);
console.log("evm balance :", (await q.evmBalance(evm)).toString(), "wei");
for (const [n, f] of [["window", () => q.evmWindow(qor)], ["pqc", () => q.pqcStatus(qor)], ["kem", () => q.kemKey(qor)], ["rules", () => q.spendingRules(qor)], ["limits", () => q.evmLimits()]] as const) {
  try { console.log(n.padEnd(11), ":", s(await f())); } catch (e) { console.log(n.padEnd(11), ": FAILED", e instanceof Error ? e.message : e); }
}
