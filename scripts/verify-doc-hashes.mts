/**
 * Checks that the transaction evidence quoted in the docs is real and consistent:
 *
 *  1. every full EVM transaction hash (0x + 64 hex) in docs/ is mined on Diana testnet, and succeeded or reverted as the
 *     docs line quoting it says ("reverted" or "refused" means it must have reverted);
 *  2. every full native (Cosmos) transaction hash (64 upper-case hex) in docs/ is found by the chain's RPC;
 *  3. every abbreviated hash or address in docs/ ("0x1bd9aa17…00ac") matches exactly one full value recorded in deployments/ or docs/.
 *
 * A 64-hex value that is not a transaction (a source-code digest, a key fingerprint) is listed as "not a transaction"
 * only if it is in NOT_TRANSACTIONS below, with the reason. Exit code 1 if anything else fails.
 * Writes deployments/doc-hash-check.json.
 *
 *   npx tsx scripts/verify-doc-hashes.mts
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const EVM_RPC = process.env.QORE_EVM_RPC ?? "https://evm-testnet.qore.host";
const RPC = process.env.QORE_RPC ?? "https://rpc-testnet.qore.host";

/** 64-hex values quoted in the docs that are not transactions. Keep the reason specific. */
const NOT_TRANSACTIONS: Record<string, string> = {
  "0x5c6e8b53572356a3a40f0d5716d4909ff26039f2880b459a92d2c09c480686b5": "TreasuryVault payment hash (the digest approvals sign), not a transaction; its approval and payment transactions are listed next to it",
  "0x7360e4fa4840be82234716d48233031ccf9b95547182afd51216d5b8a558181c": "TreasuryVault payment hash (the digest approvals sign), not a transaction; its payment transaction is listed next to it",
};

function files(dir: string, ext: RegExp, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, ext, acc);
    else if (ext.test(n)) acc.push(p);
  }
  return acc;
}
const docs = files(join(root, "docs"), /\.md$/);
// Evidence records, plus the website's Live Proof list, which keeps the full hashes of the 2026-11-14 run.
const records = [...files(join(root, "deployments"), /\.json$/).filter((f) => !f.endsWith("doc-hash-check.json")), join(root, "apps/web/lib/live-run.ts")];
const where = new Map<string, Set<string>>();
const note = (h: string, f: string) => (where.get(h) ?? where.set(h, new Set()).get(h)!).add(relative(root, f).replace(/\\/g, "/"));

const evm = new Set<string>(), native = new Set<string>(), short = new Set<string>(), known = new Set<string>();
for (const f of docs) {
  const t = readFileSync(f, "utf8");
  for (const m of t.matchAll(/\b0x[0-9a-fA-F]{64}\b/g)) { evm.add(m[0].toLowerCase()); note(m[0].toLowerCase(), f); }
  for (const m of t.matchAll(/(?<![0-9a-fA-Fx])[0-9A-F]{64}(?![0-9a-fA-F])/g)) { native.add(m[0]); note(m[0], f); }
  for (const m of t.matchAll(/\b0x[0-9a-fA-F]{4,12}…[0-9a-fA-F]{3,8}\b/g)) { short.add(m[0]); note(m[0], f); }
}
// Full transaction hashes and 20-byte addresses recorded anywhere in the repository's evidence files and docs.
for (const f of [...records, ...docs]) for (const m of readFileSync(f, "utf8").matchAll(/0x(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{40})(?![0-9a-fA-F])/g)) known.add(m[0].toLowerCase());

/** fetch with up to four attempts and backoff: a dropped connection is not a failed proof. */
async function get(url: string, init: RequestInit = {}): Promise<Response> {
  for (let i = 0; ; i++) {
    try { return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); }
    catch (e) { if (i >= 3) throw e; await new Promise((r) => setTimeout(r, 1500 * 2 ** i)); }
  }
}
async function rpc(url: string, method: string, params: unknown[]) {
  const r = await get(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()) as { result?: Record<string, unknown> | null; error?: { message: string } };
}

type Row = { hash: string; kind: "evm" | "native" | "abbreviated"; result: string; detail?: string; docs: string[] };
const rows: Row[] = [];
let failures = 0;
const push = (r: Row, ok: boolean) => { rows.push(r); if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${r.kind.padEnd(11)} ${r.hash.slice(0, 20)}…  ${r.result}${r.detail ? ` (${r.detail})` : ""}`); };

for (const h of [...evm].sort()) {
  const d = [...(where.get(h) ?? [])];
  if (NOT_TRANSACTIONS[h]) { push({ hash: h, kind: "evm", result: "not a transaction", detail: NOT_TRANSACTIONS[h], docs: d }, true); continue; }
  try {
    const r = await rpc(EVM_RPC, "eth_getTransactionReceipt", [h]);
    if (r.result) {
      // The docs line that quotes the hash says what happened; the chain must agree.
      const said = docs.flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => l.toLowerCase().includes(h)));
      const saysRefused = said.some((l) => /revert|refus/i.test(l)), ok = r.result.status === "0x1";
      push({ hash: h, kind: "evm", result: ok ? "mined, succeeded" : "mined, reverted", detail: `block ${Number(r.result.blockNumber)}${ok === saysRefused ? "; the docs say the opposite" : ""}`, docs: d }, ok !== saysRefused);
    }
    else push({ hash: h, kind: "evm", result: "not found on Diana", detail: r.error?.message, docs: d }, false);
  } catch (e) { push({ hash: h, kind: "evm", result: "RPC error", detail: (e as Error).message, docs: d }, false); }
}
for (const h of [...native].sort()) {
  const d = [...(where.get(h) ?? [])];
  if (NOT_TRANSACTIONS[h]) { push({ hash: h, kind: "native", result: "not a transaction", detail: NOT_TRANSACTIONS[h], docs: d }, true); continue; }
  try {
    const r = await get(`${RPC}/tx?hash=0x${h}`);
    const j = (await r.json()) as { result?: { height: string; tx_result: { code: number } }; error?: { data?: string } };
    if (j.result) push({ hash: h, kind: "native", result: j.result.tx_result.code === 0 ? "included, code 0" : `included, code ${j.result.tx_result.code}`, detail: `height ${j.result.height}`, docs: d }, true);
    else push({ hash: h, kind: "native", result: "not found on Diana", detail: j.error?.data?.slice(0, 120), docs: d }, false);
  } catch (e) { push({ hash: h, kind: "native", result: "RPC error", detail: (e as Error).message, docs: d }, false); }
}
for (const s of [...short].sort()) {
  const [a, b] = s.toLowerCase().split("…") as [string, string];
  const matches = [...known].filter((k) => k.startsWith(a) && k.endsWith(b));
  push({ hash: s, kind: "abbreviated", result: matches.length === 1 ? "matches one recorded hash" : matches.length ? `ambiguous (${matches.length})` : "no recorded full hash", detail: matches[0], docs: [...(where.get(s) ?? [])] }, matches.length === 1);
}

writeFileSync(join(root, "deployments/doc-hash-check.json"), JSON.stringify({ checkedAt: new Date().toISOString(), evmRpc: EVM_RPC, rpc: RPC, failures, rows }, null, 2) + "\n");
console.log(`\n${rows.length} checked, ${failures} failed. Report: deployments/doc-hash-check.json`);
process.exit(failures ? 1 : 0);
