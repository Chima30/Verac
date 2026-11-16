/**
 * Category proofs for "Post-Quantum AI Agents" on Diana testnet, run on a DEDICATED, ISOLATED throwaway account.
 * Never point this at the vault owner, the payment agent or the approver.
 *
 *   ACCOUNT_FILE=.secrets/category-proof-account.json tsx category-proofs.ts <scenario> [--broadcast]
 *
 * DRY RUN BY DEFAULT: it reads the chain, builds and signs locally, prints the plan and sends nothing. With --broadcast it
 * sends real testnet transactions and appends what actually happened (tx hashes, heights, RPC errors, before/after
 * read-backs) to deployments/category-proofs.json. Nothing is recorded that the chain did not return.
 *
 * Scenarios (window = QoreChain's native EVM authorisation window; aa = native abstract-account delegated key):
 *   window-count    open {maxTxs: 1}; send one permitted tx; send a second; expect refusal before inclusion
 *   window-value    open {maxValue: one tx's max fee + 0.001 QOR}; send 0.5 QOR; expect refusal (value + fees counted)
 *   window-expiry   open {blocks: 3}; wait past the expiry height; send; expect refusal
 *   window-target   open {allowedTargets: [TreasuryVault]}; a harmless call to the vault; a zero-value transfer to 0x…dEaD; expect refusal
 *   aa-link         link a fresh ed25519 key: permissions [send], expiry +1 day, rule per-tx 0.1 QOR, daily 0.2 QOR, denom uqor only
 *   aa-within       the delegated key sends 0.05 QOR: expect success
 *   aa-over-per-tx  the delegated key sends 0.15 QOR: expect a failed execution (code 0 envelope, success=false)
 *   aa-over-daily   the delegated key sends 0.09 QOR twice after aa-within: expect the second to fail on the daily limit
 *   aa-wrong-denom  the delegated key sends 1 of another denom: expect refusal
 *   aa-revoke       revoke the key; then aa-after-revoke: expect refusal
 *   aa-replay       re-broadcast the exact signed bytes of aa-within: expect refusal (nonce consumed)
 *   status          print the account's window, authenticators and spending rules
 *
 * Before the first run: `pnpm account:new .secrets/category-proof-account.json`, fund it with about 5 test QOR, then
 * `ACCOUNT_FILE=... tsx chain-tx.ts register-pqc --broadcast`. Requires explicit owner approval to broadcast.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { StargateClient } from "@cosmjs/stargate";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  EthNativeSigner, classifyEvmWindowRejection, closeEvmWindowMsg, cosmosAuthSignBytes, decodeAuthenticatorExecutions, executeCosmosMsg,
  fetchAuthNonce, fetchAuthenticators, fetchEvmWindow, fetchSpendingRules, linkAuthenticatorMsgs, openEvmWindowMsg, revokeAuthenticatorMsg,
  signAuthenticatorLinkEd25519, unifiedAccountFromSeed, type UnifiedAccount,
} from "@qorechain/sdk";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { createPublicClient, createWalletClient, defineChain, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEPLOYED } from "../src/contracts";

const CHAIN_ID = "qorechain-diana";
const [scenario, ...flags] = process.argv.slice(2);
const BROADCAST = flags.includes("--broadcast");
const ROOT = resolve(import.meta.dirname, "../../..");
const EVIDENCE = resolve(ROOT, "deployments/category-proofs.json");
const ACCOUNT_FILE = resolve(process.cwd(), process.env.ACCOUNT_FILE ?? ".secrets/category-proof-account.json");
const unhex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fee = (gas: number) => ({ amount: [{ denom: "uqor", amount: String(Math.ceil(gas * 0.15)) }], gas: String(gas) });
const DEAD = "0x000000000000000000000000000000000000dEaD";

if (!scenario) { console.error("usage: category-proofs.ts <scenario> [--broadcast]  (see the header for scenarios)"); process.exit(2); }
if (!existsSync(ACCOUNT_FILE)) { console.error(`No account file at ${ACCOUNT_FILE}. Create a dedicated throwaway account first (see header).`); process.exit(2); }
const f = JSON.parse(readFileSync(ACCOUNT_FILE, "utf8")) as { qorAddress: string; evmAddress: string; secp256k1PrivateKey: string; mlDsa87PublicKey: string; mlDsa87SecretKey: string; delegatedEd25519Seed?: string };

// Guard rails: never run against the accounts that operate the real vault.
const PROTECTED = [process.env.LIVE_AGENT_ADDRESS, process.env.LIVE_APPROVER_ADDRESS, "0x5B108321e824faf53AA198fcD1682A07a68970F2"].filter(Boolean).map((a) => a!.toLowerCase());
if (PROTECTED.includes(f.evmAddress.toLowerCase())) { console.error("This is an operating account (owner, agent or approver). Use a dedicated throwaway account."); process.exit(2); }

const base = unifiedAccountFromSeed(unhex(f.secp256k1PrivateKey), { pqcSecret: crypto.getRandomValues(new Uint8Array(32)) });
const account: UnifiedAccount = { ...base, pqc: { publicKey: unhex(f.mlDsa87PublicKey), secretKey: unhex(f.mlDsa87SecretKey) } };
if (account.cosmos !== f.qorAddress) throw new Error("Stored key does not match the stored address; refusing.");

const rest = QORE_NETWORK.rest;
const info = (await (await fetch(`${rest}/cosmos/base/tendermint/v1beta1/node_info`)).json()) as { default_node_info?: { network?: string } };
if (info.default_node_info?.network !== CHAIN_ID) throw new Error(`Node reports "${info.default_node_info?.network}", expected ${CHAIN_ID}. Refusing.`);

const chain = defineChain({ id: 9800, name: "QoreChain Diana", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [QORE_NETWORK.evmRpc] } } });
const evmAccount = privateKeyToAccount(f.secp256k1PrivateKey as Hex);
const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ chain, account: evmAccount, transport: http() });

interface Evidence {
  id: string; requirement: string; scenario: string; account: string; target?: string;
  txHash?: string; height?: string; expected: string; actual: string; denial: "on-chain" | "before-inclusion" | null;
  before?: unknown; after?: unknown; rpcError?: string; classified?: string; verifiedAt: string; source: string;
}
const record: Evidence[] = [];
function save(e: Omit<Evidence, "verifiedAt" | "source" | "account">) {
  const full: Evidence = { ...e, account: account.cosmos, verifiedAt: new Date().toISOString(), source: "packages/qorechain/scripts/category-proofs.ts" };
  record.push(full);
  console.log(JSON.stringify(full, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}
function persist() {
  if (!BROADCAST || !record.length) return;
  const all = existsSync(EVIDENCE) ? (JSON.parse(readFileSync(EVIDENCE, "utf8")) as { runs: Evidence[] }) : { runs: [] as Evidence[] };
  all.runs.push(...record);
  writeFileSync(EVIDENCE, JSON.stringify(all, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
  console.log(`Appended ${record.length} result(s) to ${EVIDENCE}`);
}

async function native(messages: Parameters<EthNativeSigner["sign"]>[0]["messages"], gas: number, label: string) {
  const acc = (await (await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${account.cosmos}`)).json()) as { account?: { account_number?: string; sequence?: string } };
  const signer = new EthNativeSigner(account, { signMode: "hybrid", rest });
  const params = { chainId: CHAIN_ID, messages, fee: fee(gas), accountNumber: BigInt(acc.account?.account_number ?? "0"), sequence: BigInt(acc.account?.sequence ?? "0") };
  console.log(`${BROADCAST ? "BROADCAST" : "DRY RUN"}  ${label}`);
  if (!BROADCAST) { signer.sign({ ...params, signBytesVersion: await signer.resolveSignBytesVersion(CHAIN_ID) }); console.log("  signed locally, not sent"); return null; }
  const client = await StargateClient.connect(QORE_NETWORK.rpc);
  try { return await signer.signAndBroadcast(client, params); } finally { client.disconnect(); }
}
const window = () => fetchEvmWindow({ rest, address: account.cosmos });
async function evmSend(to: string, valueWei: bigint, data?: Hex): Promise<{ ok: true; hash: string; height: string } | { ok: false; error: string; classified?: string }> {
  if (!BROADCAST) { console.log(`  DRY RUN: would send EVM tx to ${to}, value ${valueWei} wei`); return { ok: false, error: "dry run" }; }
  try {
    const hash = await wallet.sendTransaction({ to: to as Hex, value: valueWei, ...(data ? { data } : {}), gas: 60_000n });
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    return { ok: true, hash, height: r.blockNumber.toString() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 500), classified: classifyEvmWindowRejection(e) };
  }
}
async function waitBlocks(n: bigint) {
  const start = await pub.getBlockNumber();
  while ((await pub.getBlockNumber()) < start + n) await new Promise((r) => setTimeout(r, 2000));
}

// Delegated (abstract-account) key: an ed25519 seed stored next to the account, created on first use.
function delegatedKey(): { seed: Uint8Array; pubkey: Uint8Array } {
  if (!f.delegatedEd25519Seed) {
    if (!BROADCAST) return { seed: new Uint8Array(32).fill(7), pubkey: ed25519.getPublicKey(new Uint8Array(32).fill(7)) };
    f.delegatedEd25519Seed = hex(ed25519.utils.randomSecretKey());
    writeFileSync(ACCOUNT_FILE, JSON.stringify(f, null, 2), { mode: 0o600 });
  }
  const seed = unhex(f.delegatedEd25519Seed);
  return { seed, pubkey: ed25519.getPublicKey(seed) };
}
async function delegatedSend(uqor: bigint, denom = "uqor", label = "") {
  const k = delegatedKey();
  const { nonce } = await fetchAuthNonce({ rest, address: account.cosmos, pubkey: k.pubkey });
  const to = account.cosmos; // self-transfer: proves the rule without sending funds anywhere else
  const amount = `${uqor}${denom}`;
  const digest = cosmosAuthSignBytes({ chainId: CHAIN_ID, account: account.cosmos, pubkey: k.pubkey, to, amount, nonce });
  const signature = ed25519.sign(digest, k.seed);
  const m = executeCosmosMsg({ relayer: account.cosmos, account: account.cosmos, scheme: "ed25519", pubkey: k.pubkey, signature, to, amount, nonce });
  const res = await native([m], 400_000, `MsgExecuteCosmos ${amount} by delegated key (nonce ${nonce}) ${label}`);
  if (!res) return { res: null, exec: null, m };
  const exec = res.code === 0 ? decodeAuthenticatorExecutions(res as never, [m]) : [];
  return { res, exec, m };
}
async function aaState() {
  const [auths, rules] = await Promise.all([fetchAuthenticators({ rest, address: account.cosmos }).catch((e) => String(e)), fetchSpendingRules({ rest, address: account.cosmos }).catch((e) => String(e))]);
  return { authenticators: auths, spendingRules: rules };
}

switch (scenario) {
  case "status": {
    console.log(JSON.stringify({ window: await window(), ...(await aaState()) }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    break;
  }
  case "window-count": {
    const r = await native([openEvmWindowMsg({ sender: account.cosmos, blocks: 60, maxTxs: 1, maxValue: "200000" })], 500_000, "open window {blocks 60, maxTxs 1, maxValue 0.2 QOR}");
    if (!r) break;
    const before = await window();
    const first = await evmSend(account.evm, 0n);
    const mid = await window();
    const second = await evmSend(account.evm, 0n);
    const after = await window();
    save({ id: "B-1", requirement: "B Transaction-count limits", scenario, target: account.evm, txHash: first.ok ? first.hash : undefined, height: first.ok ? first.height : undefined, expected: "first tx admitted", actual: first.ok ? "admitted" : `refused: ${first.error}`, denial: null, before, after: mid });
    save({ id: "B-2", requirement: "B Transaction-count limits", scenario, target: account.evm, expected: "second tx refused, remainingTxs 0", actual: second.ok ? `ADMITTED (unexpected) ${second.hash}` : "refused", denial: second.ok ? null : "before-inclusion", rpcError: second.ok ? undefined : second.error, classified: second.ok ? undefined : second.classified, before: mid, after });
    await native([closeEvmWindowMsg(account.cosmos)], 300_000, "close window");
    break;
  }
  case "window-value": {
    const r = await native([openEvmWindowMsg({ sender: account.cosmos, blocks: 60, maxTxs: 3, maxValue: "50000" })], 500_000, "open window {maxValue 0.05 QOR incl. fees}");
    if (!r) break;
    const before = await window();
    const over = await evmSend(account.evm, parseEther("0.5"));
    const after = await window();
    save({ id: "C1-1", requirement: "C Value limits (native window)", scenario, target: account.evm, expected: "0.5 QOR transfer refused: maxValue 0.05 QOR covers value plus max fee", actual: over.ok ? `ADMITTED (unexpected) ${over.hash}` : "refused", denial: over.ok ? null : "before-inclusion", rpcError: over.ok ? undefined : over.error, classified: over.ok ? undefined : over.classified, before, after });
    await native([closeEvmWindowMsg(account.cosmos)], 300_000, "close window");
    break;
  }
  case "window-expiry": {
    const r = await native([openEvmWindowMsg({ sender: account.cosmos, blocks: 3, maxTxs: 3, maxValue: "200000" })], 500_000, "open window {blocks 3}");
    if (!r) break;
    const opened = await window();
    await waitBlocks(5n);
    const late = await evmSend(account.evm, 0n);
    const after = await window();
    save({ id: "D-1", requirement: "D Duration limits", scenario, target: account.evm, txHash: r.transactionHash, height: String(r.height), expected: `tx after expiry height ${opened.expiryHeight} refused`, actual: late.ok ? `ADMITTED (unexpected) ${late.hash}` : "refused", denial: late.ok ? null : "before-inclusion", rpcError: late.ok ? undefined : late.error, classified: late.ok ? undefined : late.classified, before: opened, after });
    break;
  }
  case "window-target": {
    const r = await native([openEvmWindowMsg({ sender: account.cosmos, blocks: 60, maxTxs: 3, maxValue: "300000", allowedTargets: [DEPLOYED.TreasuryVault] })], 500_000, "open window {allowedTargets [TreasuryVault]}");
    if (!r) break;
    const before = await window();
    // A harmless permitted call: a zero-value call to the vault's paused() view (it writes nothing).
    const ok = await evmSend(DEPLOYED.TreasuryVault, 0n, "0x5c975abb");
    const bad = await evmSend(DEAD, 0n);
    const after = await window();
    save({ id: "E-1", requirement: "E Target restrictions", scenario, target: DEPLOYED.TreasuryVault, txHash: ok.ok ? ok.hash : undefined, height: ok.ok ? ok.height : undefined, expected: "call to the approved vault admitted", actual: ok.ok ? "admitted" : `refused: ${ok.error}`, denial: null, before });
    save({ id: "E-2", requirement: "E Target restrictions", scenario, target: DEAD, expected: "transfer to an unapproved target refused", actual: bad.ok ? `ADMITTED (unexpected) ${bad.hash}` : "refused", denial: bad.ok ? null : "before-inclusion", rpcError: bad.ok ? undefined : bad.error, classified: bad.ok ? undefined : bad.classified, after });
    await native([closeEvmWindowMsg(account.cosmos)], 300_000, "close window");
    break;
  }
  case "aa-link": {
    const k = delegatedKey();
    const proof = signAuthenticatorLinkEd25519({ chainId: CHAIN_ID, account: account.cosmos, privateKey: k.seed });
    const msgs = linkAuthenticatorMsgs({
      owner: account.cosmos, chainId: CHAIN_ID, scheme: "ed25519", pubkey: proof.pubkey, possessionProof: proof.possessionProof,
      permissions: ["send"], expiryUnix: Math.floor(Date.now() / 1000) + 86_400, label: "verac-category-proof",
      spendingRule: { id: "verac-proof", enabled: true, perTxLimit: "100000", dailyLimit: "200000", allowedDenoms: ["uqor"], denomLimits: [{ denom: "uqor", perTxLimit: "100000", dailyLimit: "200000" }], allowedEvmCalls: [] },
    });
    const before = await aaState();
    const r = await native(msgs, 600_000, "MsgUpdateSpendingRules + MsgRegisterAuthenticator (send only; 0.1 QOR per tx, 0.2 per day, uqor only; expires in 24h)");
    if (!r) break;
    save({ id: "F-1", requirement: "F Native smart-account spending rules", scenario, txHash: r.transactionHash, height: String(r.height), expected: "delegated ed25519 key linked with proof of possession, bounded by a spending rule", actual: r.code === 0 ? "linked" : `failed code ${r.code}: ${r.rawLog}`, denial: null, before, after: await aaState() });
    break;
  }
  case "aa-within": case "aa-over-per-tx": case "aa-over-daily": case "aa-wrong-denom": case "aa-after-revoke": {
    const plan: Record<string, { amt: bigint; denom?: string; expect: string; id: string; times?: number }> = {
      "aa-within": { amt: 50_000n, expect: "success", id: "F-2" },
      "aa-over-per-tx": { amt: 150_000n, expect: "failed: per-transaction limit", id: "F-3" },
      "aa-over-daily": { amt: 90_000n, expect: "second execution failed: daily limit", id: "F-4", times: 2 },
      "aa-wrong-denom": { amt: 1n, denom: "ibc/NOTALLOWED", expect: "refused: denomination not allowed", id: "F-5" },
      "aa-after-revoke": { amt: 10_000n, expect: "refused: key revoked", id: "F-7" },
    };
    const p = plan[scenario]!;
    for (let i = 0; i < (p.times ?? 1); i++) {
      const { res, exec } = await delegatedSend(p.amt, p.denom, `#${i + 1}`);
      if (!res) break;
      const e = exec?.[0];
      // A code-0 envelope is not success: the execution result decides (chain v3.2.8).
      const actual = res.code !== 0 ? `refused, code ${res.code}: ${(res.rawLog ?? "").slice(0, 300)}` : e?.success ? "execution succeeded" : `execution failed: ${e?.reason || e?.vmError || "no reason"}`;
      save({ id: p.times && p.times > 1 ? `${p.id}.${i + 1}` : p.id, requirement: "F Native smart-account spending rules", scenario, txHash: res.transactionHash, height: String(res.height), expected: p.times && i === 0 ? "first within limits succeeds" : p.expect, actual, denial: res.code !== 0 || (e && !e.success) ? "on-chain" : null });
    }
    break;
  }
  case "aa-revoke": {
    const k = delegatedKey();
    const r = await native([revokeAuthenticatorMsg({ owner: account.cosmos, scheme: "ed25519", pubkey: k.pubkey })], 300_000, "MsgRevokeAuthenticator");
    if (!r) break;
    save({ id: "F-6", requirement: "F Native smart-account spending rules", scenario, txHash: r.transactionHash, height: String(r.height), expected: "key revoked", actual: r.code === 0 ? "revoked" : `failed code ${r.code}`, denial: null, after: await aaState() });
    break;
  }
  case "aa-replay": {
    console.log("Replay is covered by aa-within + a second broadcast of the same signed message: the per-key nonce is consumed by the first execution (success or failure), so the chain refuses the copy with abstractaccount code 11.");
    const k = delegatedKey();
    const { nonce } = await fetchAuthNonce({ rest, address: account.cosmos, pubkey: k.pubkey });
    if (nonce === 0n) { console.log("Run aa-within first."); break; }
    const to = account.cosmos, amount = "1000uqor", stale = nonce - 1n;
    const signature = ed25519.sign(cosmosAuthSignBytes({ chainId: CHAIN_ID, account: account.cosmos, pubkey: k.pubkey, to, amount, nonce: stale }), k.seed);
    const m = executeCosmosMsg({ relayer: account.cosmos, account: account.cosmos, scheme: "ed25519", pubkey: k.pubkey, signature, to, amount, nonce: stale });
    const res = await native([m], 400_000, `MsgExecuteCosmos with a used nonce ${stale}`);
    if (!res) break;
    save({ id: "F-8", requirement: "F Native smart-account spending rules (replay)", scenario, txHash: res.transactionHash, height: String(res.height), expected: "refused: nonce already used", actual: res.code !== 0 ? `refused, code ${res.code}` : "ACCEPTED (unexpected)", denial: res.code !== 0 ? "on-chain" : null });
    break;
  }
  default:
    console.error(`unknown scenario ${scenario}`); process.exit(2);
}
persist();
