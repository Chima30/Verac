/**
 * End-to-end run of the website's TreasuryVault V2 code path on Diana testnet, with only the database replaced by an
 * in-memory stand-in (the real one needs migration 0018 in Supabase). Everything else is the code the website runs:
 *
 *   propose  -> the same on-chain checks and digest as proposeLivePaymentV2
 *   request  -> toSigningRequest (the file the website serves)
 *   sign     -> the real administrator signing tool (v2-admin.ts), run twice with two administrators' own key folders
 *   upload   -> checkSignatureV2 (what the website checks before recording a signature)
 *   execute  -> executeV2Payment with v2ChainAdapter + v2AgentAdapter (what the website's Execute button runs)
 *
 * Also checks two defences: the signing tool refuses a request whose amount was changed after the digest was computed, and
 * the upload check refuses a signature made for a different payment. DRY RUN unless --broadcast (stops before execution).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, keccak256, toBytes, toHex, type Hex } from "viem";
import { QoreReader } from "../src/index";
import { paymentDigestV2, type V2AdminSig, type V2Payment } from "../src/v2";
import { checkSignatureV2, toSigningRequest, v2AgentAdapter, v2ChainAdapter, vaultReadV2 } from "../src/v2-adapters";
import { executeV2Payment, type V2Db, type V2Row } from "../src/v2-executor";
import { LocalAccount } from "./lib/accounts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BROADCAST = process.argv.includes("--broadcast");
const env = JSON.parse(readFileSync(resolve(root, "deployments/v2-diana.json"), "utf8")) as { TreasuryVaultV2: Hex; vendor: Hex };
const vault = getAddress(env.TreasuryVaultV2), vendor = getAddress(env.vendor);
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const reader = new QoreReader();
await reader.assertConnectedToTestnet();
const evm = reader.evm;
const agent = LocalAccount.load(resolve(root, ".secrets/v2/agent"));
const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
const step = (s: string, ok: boolean, detail: string) => { steps.push({ step: s, ok, detail }); console.log(`${ok ? "OK  " : "FAIL"} ${s}: ${detail}`); };

// ---- propose (as proposeLivePaymentV2)
const [limits, remaining, approved, policyVersion, threshold, paused] = await Promise.all([
  vaultReadV2<readonly [boolean, bigint, bigint, bigint]>(evm, vault, "limits", [agent.pub.evmAddress, NATIVE]),
  vaultReadV2<bigint>(evm, vault, "remainingDaily", [agent.pub.evmAddress, NATIVE]),
  vaultReadV2<boolean>(evm, vault, "approvedRecipient", [vendor]),
  vaultReadV2<bigint>(evm, vault, "policyVersion"), vaultReadV2<number>(evm, vault, "threshold"), vaultReadV2<boolean>(evm, vault, "paused"),
]);
const amount = 250_000_000_000_000_000n; // 0.25 QOR
if (paused || !limits[0] || !approved || amount > limits[2] || amount > remaining) throw new Error(`vault state does not allow the test payment (paused=${paused} active=${limits[0]} approved=${approved} remaining=${remaining})`);
const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
const p: V2Payment = { token: NATIVE, to: vendor, amount, purposeHash: keccak256(toBytes(`Invoice E2E-${Date.now()}`)), policyVersion, expiry, nonce: BigInt(toHex(crypto.getRandomValues(new Uint8Array(12)))) };
const digest = paymentDigestV2(9800n, vault, agent.pub.evmAddress, p);
const chainDigest = await vaultReadV2<Hex>(evm, vault, "paymentDigest", [agent.pub.evmAddress, p]);
step("propose", chainDigest === digest, `0.25 QOR to ${vendor}, digest ${digest} (matches the vault: ${chainDigest === digest}), ${threshold} signatures required`);

const row: V2Row & { evaluation: { purpose: string } } = {
  id: `e2e-${Date.now()}`, organization_id: "e2e", state: "AWAITING_APPROVAL", vault_version: 2, vault_address: vault, payment_hash: digest,
  token: NATIVE, recipient: vendor, amount: amount.toString(), purpose_hash: p.purposeHash, policy_version: Number(policyVersion), nonce: p.nonce.toString(),
  expires_at: new Date(Number(expiry) * 1000).toISOString(), agent_account: agent.pub.evmAddress, required_approvals: threshold,
  evaluation: { purpose: "E2E: invoice payment through the website's V2 code path" },
};

// ---- signing request file (as GET /api/live/v2/request)
const dir = resolve(root, "deployments/v2-e2e");
mkdirSync(dir, { recursive: true });
const reqFile = resolve(dir, `${row.id}.request.json`);
writeFileSync(reqFile, JSON.stringify(toSigningRequest(row), null, 2) + "\n");
step("signing request", true, `written to deployments/v2-e2e/${row.id}.request.json`);

// ---- tampered request: the signing tool must refuse it
const tampered = JSON.parse(readFileSync(reqFile, "utf8"));
tampered.payment.amount = "900000000000000000";
const tamperedFile = resolve(dir, `${row.id}.tampered.json`);
writeFileSync(tamperedFile, JSON.stringify(tampered, null, 2) + "\n");
const tool = (keyDir: string, file: string) => execFileSync(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), resolve(root, "packages/qorechain/scripts/v2-admin.ts"), "sign", keyDir, file, "--yes"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try { tool(resolve(root, ".secrets/v2/admin-1"), tamperedFile); step("tampered request refused by signing tool", false, "the tool signed a tampered request"); }
catch (e) { const m = String((e as { stderr?: string }).stderr ?? e); step("tampered request refused by signing tool", /REFUSED: the digest in the request does not match/.test(m), m.trim().split("\n").pop()!); }

// ---- two administrators sign with the real tool
const sigs: V2AdminSig[] = [];
for (const name of ["admin-1", "admin-3"]) {
  const out = tool(resolve(root, `.secrets/v2/${name}`), reqFile);
  const file = /Upload this file in Verac \(Approvals\): (.+)/.exec(out)?.[1]?.trim();
  if (!file) throw new Error(`signing tool gave no file for ${name}: ${out}`);
  const sub = JSON.parse(readFileSync(file, "utf8")) as { signer: string; digest: string; signature: string };
  // ---- upload check (as POST /api/live/v2/signature)
  const c = await checkSignatureV2(evm, vault, row, sub);
  step(`${name} signs with the tool, website check`, c.ok, c.ok ? `signer ${c.signer}, verified against its registered ML-DSA-87 key` : c.error);
  if (c.ok) sigs.push({ signer: c.signer, signature: sub.signature as Hex });
}
// A signature for a different payment is refused at upload
const other: V2Row = { ...row, amount: "100000000000000000" };
other.payment_hash = paymentDigestV2(9800n, vault, agent.pub.evmAddress, { ...p, amount: 100_000_000_000_000_000n });
const wrong = await checkSignatureV2(evm, vault, other, { signer: sigs[0]!.signer, digest: digest, signature: sigs[0]!.signature });
step("signature for another payment refused at upload", !wrong.ok, wrong.ok ? "accepted" : wrong.error);

if (!BROADCAST) { console.log("\nDRY RUN: stopped before execution. Re-run with --broadcast to execute the payment."); process.exit(steps.every((s) => s.ok) ? 0 : 1); }

// ---- execute with the website's executor and adapters; the database is an in-memory stand-in
row.state = "APPROVED";
const log: string[] = [];
const db: V2Db = {
  claim: async () => { if (row.state !== "APPROVED") throw new Error(`state ${row.state}`); row.state = "READY"; return row; },
  signatures: async () => sigs,
  recordSubmitted: async (_id, h) => { row.state = "SUBMITTED"; log.push(`submitted ${h}`); },
  recordOutcome: async (_id, ok, b, reason) => { row.state = ok ? "CONFIRMED" : "FAILED"; log.push(`outcome ${ok} block ${b} ${reason ?? ""}`); },
  recordFailure: async (_id, reason) => { row.state = "FAILED"; log.push(`failure ${reason}`); },
  alert: async (_o, kind, _id, d) => { log.push(`alert ${kind} ${JSON.stringify(d)}`); },
};
const pq = agent.pqc();
const agentAdapter = v2AgentAdapter({ evm, privateKey: (await import("node:fs")).readFileSync(resolve(root, ".secrets/v2/agent/ecdsa-private-key.txt"), "utf8").trim() as Hex, mlDsa87PublicKey: Buffer.from(pq.publicKey).toString("hex"), mlDsa87SecretKey: Buffer.from(pq.secretKey).toString("hex"), vault, kill: { enabled: () => true } });
const before = await evm.getBalance({ address: vault });
const result = await executeV2Payment({ db, chain: v2ChainAdapter(evm), agent: agentAdapter, vault }, row.id);
const after = await evm.getBalance({ address: vault });
step("execute", result.state === "CONFIRMED", JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
step("vault balance", before - after === amount, `${Number(before) / 1e18} -> ${Number(after) / 1e18} QOR`);
const w = await reader.evmWindow(agent.pub.qorAddress);
step("agent window closed afterwards", !w.live, w.live ? "OPEN" : "closed");

writeFileSync(resolve(root, "deployments/v2-e2e-results.json"), JSON.stringify({ ranAt: new Date().toISOString(), vault, digest, payment: { to: vendor, amountQor: "0.25" }, result, log, steps }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
console.log(`\n${steps.filter((s) => s.ok).length}/${steps.length} steps OK. Wrote deployments/v2-e2e-results.json`);
if (!steps.every((s) => s.ok)) process.exitCode = 1;
