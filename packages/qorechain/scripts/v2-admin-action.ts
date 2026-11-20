/**
 * Runs ONE TreasuryVault V2 administrative change, authorised by two administrators' ML-DSA-87 signatures and relayed by
 * the relayer inside a short window that admits only the vault (closed again afterwards, even on failure).
 *
 * Changes:   recipient <0x> [--remove]  |  add-admin <0x>  |  remove-admin <0x>
 *
 * Each administrator on their OWN computer (recommended; keys never meet):
 *   tsx v2-admin-action.ts prepare add-admin 0xNEW --out add.json        anyone: writes a signing request (no key used)
 *   tsx v2-admin.ts sign <their key folder> add.json                      each administrator, on their own computer
 *   tsx v2-admin-action.ts relay add.json add.signature-*.json [--broadcast]   anyone holding the relayer key
 *
 * All keys on this computer (testnet convenience):
 *   tsx v2-admin-action.ts add-admin 0xNEW [--signers admin-1,admin-3] [--broadcast]
 *
 * Replacing a lost or exposed administrator key: add the new one first, then remove the old one (two changes, so the
 * vault never drops below its threshold). The new key must already be registered on QoreChain with proof of possession
 * (v2-admin-key.ts). DRY RUN BY DEFAULT: everything is checked and simulated on the live vault; nothing is sent.
 * Results are appended to deployments/v2-diana.json under adminActions.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeEvmWindowMsg, openEvmWindowMsg } from "@qorechain/sdk";
import { createWalletClient, getAddress, http, parseAbi, type Hex } from "viem";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { QoreReader, qoreDianaTestnet } from "../src/index";
import { AdminOp, adminDigestV2, signApprovalV2, sortSigs, treasuryVaultV2Abi, verifyApprovalV2, type V2AdminSig } from "../src/v2";
import { LocalAccount, broadcastNative } from "./lib/accounts";
import { ADMIN_REQUEST_FORMAT, adminSubject, buildAdminOp, describeAdminOp, type AdminRequest } from "./lib/v2-admin-ops";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = resolve(root, "deployments/v2-diana.json");
const argv = process.argv.slice(2);
const BROADCAST = argv.includes("--broadcast");
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m: string): never => { console.error(`REFUSED: ${m}`); process.exit(1); };
const USAGE = "usage: v2-admin-action.ts [prepare] recipient|add-admin|remove-admin <0x> [--remove] [--signers a,b] [--out file] [--broadcast]\n       v2-admin-action.ts relay <request.json> <signature.json>... [--broadcast]";

const state = JSON.parse(readFileSync(OUT, "utf8")) as Record<string, unknown> & { TreasuryVaultV2: Hex; adminActions?: unknown[] };
const vault = getAddress(state.TreasuryVaultV2);
const reader = new QoreReader();
await reader.assertConnectedToTestnet();
const evm = reader.evm;
const read = <T>(fn: string, args: readonly unknown[] = []) => evm.readContract({ address: vault, abi: treasuryVaultV2Abi, functionName: fn, args } as never) as Promise<T>;
const keyStatus = async (a: Hex) => {
  const [registered, alg, pk, proven] = await evm.readContract({ address: "0x0000000000000000000000000000000000000a02", abi: parseAbi(["function pqcKeyStatus(address) view returns (bool, uint8, bytes, bool)"]), functionName: "pqcKeyStatus", args: [a] });
  return { ok: registered && proven && (pk.length - 2) / 2 === 2592, alg, pk: pk as Hex };
};

/** Checks that would make the vault refuse, or that make a change unsafe, before anyone signs or sends. */
async function preflight(op: number, data: Hex) {
  const subject = adminSubject(op, data);
  const [count, threshold] = await Promise.all([read<number>("adminCount"), read<number>("threshold")]);
  if (op === AdminOp.AddAdmin && subject) {
    if (await read<boolean>("isAdmin", [subject])) die(`${subject} is already an administrator`);
    const k = await keyStatus(subject);
    if (!k.ok) die(`${subject} has no ML-DSA-87 key registered with proof of possession on QoreChain; run v2-admin-key.ts register on the new administrator's computer first`);
    const roles = (state as { accounts?: Record<string, { evm?: string }> }).accounts ?? {};
    for (const role of ["agent", "relayer"]) if (roles[role]?.evm && getAddress(roles[role]!.evm!) === subject) die(`the ${role} key must never be an administrator`);
    console.log(`checked: ${subject} has a proven ML-DSA-87 key on QoreChain; administrators will be ${count + 1}, threshold ${threshold}`);
  }
  if (op === AdminOp.RemoveAdmin && subject) {
    if (!(await read<boolean>("isAdmin", [subject]))) die(`${subject} is not an administrator`);
    if (count - 1 < threshold) die(`removing it would leave ${count - 1} administrators for a threshold of ${threshold}; add the replacement first`);
    console.log(`checked: administrators will be ${count - 1}, threshold ${threshold}${count - 1 === threshold ? " (WARNING: no spare key left: losing one more would freeze administration)" : ""}`);
  }
  if (op === AdminOp.SetRecipient) {
    const [who, ok] = [getAddress(`0x${data.slice(26, 66)}`), BigInt(`0x${data.slice(66)}`) === 1n];
    if ((await read<boolean>("approvedRecipient", [who])) === ok) { console.log(`Nothing to do: ${who} is already ${ok ? "approved" : "not approved"}.`); process.exit(0); }
  }
}

async function relay(op: number, data: Hex, nonce: bigint, expiry: bigint, sigs: V2AdminSig[], label: string) {
  const relayer = LocalAccount.load(resolve(root, ".secrets/v2/relayer"));
  const rEvm = relayer.evm();
  await evm.simulateContract({ account: rEvm, address: vault, abi: treasuryVaultV2Abi, functionName: "executeAdminAction", args: [op, data, nonce, expiry, sigs] });
  console.log(`${BROADCAST ? "BROADCAST" : "DRY RUN"}  ${label} on ${vault}, admin nonce ${nonce}, signed by ${sigs.map((s) => s.signer).join(" + ")}; simulation OK`);
  if (!BROADCAST) { console.log("Nothing was sent. Re-run with --broadcast."); return; }
  const rUa = relayer.unified();
  const open = await broadcastNative(rUa, "hybrid", [openEvmWindowMsg({ sender: rUa.cosmos, blocks: 120, maxTxs: 2, maxValue: "500000", allowedTargets: [vault] })], 500_000);
  if (open.code !== 0) throw new Error(`window open failed: ${open.rawLog}`);
  console.log(`relayer window opened (vault only, 2 txs): ${open.hash}`);
  const record: Record<string, unknown> = { action: label, at: new Date().toISOString(), adminNonce: nonce.toString(), signers: sigs.map((s) => s.signer), windowOpen: open.hash };
  try {
    const wallet = createWalletClient({ account: rEvm, chain: qoreDianaTestnet, transport: http(QORE_NETWORK.evmRpc) });
    const { request } = await evm.simulateContract({ account: rEvm, address: vault, abi: treasuryVaultV2Abi, functionName: "executeAdminAction", args: [op, data, nonce, expiry, sigs] });
    const hash = await wallet.writeContract({ ...request, gasPrice: await evm.getGasPrice(), type: "legacy" } as never);
    const r = await evm.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 2_000 });
    console.log(`${label}: ${r.status}, block ${r.blockNumber}, tx ${hash}`);
    Object.assign(record, { tx: hash, block: r.blockNumber.toString(), status: r.status });
  } finally {
    if ((await reader.evmWindow(rUa.cosmos)).live) {
      const c = await broadcastNative(rUa, "hybrid", [closeEvmWindowMsg(rUa.cosmos)], 300_000);
      console.log(c.code === 0 ? `relayer window closed: ${c.hash}` : `WARNING: window not closed: ${c.rawLog}`);
      record.windowClose = c.code === 0 ? c.hash : `FAILED: ${c.rawLog}`;
    }
    const subject = adminSubject(op, data);
    if (subject) { record.isAdminAfter = await read<boolean>("isAdmin", [subject]); console.log(`read back: isAdmin(${subject}) = ${record.isAdminAfter}, administrators ${await read<number>("adminCount")}`); }
    state.adminActions = [...(state.adminActions ?? []), record];
    writeFileSync(OUT, JSON.stringify(state, null, 2) + "\n");
  }
}

if (argv[0] === "relay") {
  // ---- relay a request signed elsewhere: trust nothing in the files; the vault re-checks everything on chain.
  const reqFile = argv[1] ?? die(USAGE);
  const req = JSON.parse(readFileSync(resolve(process.cwd(), reqFile), "utf8")) as AdminRequest;
  if (req.format !== ADMIN_REQUEST_FORMAT || req.chainId !== 9800 || getAddress(req.vault) !== vault) die("not a request for this vault on Diana");
  const nonce = BigInt(req.nonce), expiry = BigInt(req.expiry);
  const digest = adminDigestV2(9800n, vault, req.op, req.data, nonce, expiry);
  if (digest !== req.digest || (await read<Hex>("adminDigest", [req.op, req.data, nonce, expiry])) !== digest) die("the request's digest does not match its contents");
  if ((await read<bigint>("adminNonce")) !== nonce) die("the vault has moved on (admin nonce changed): prepare and sign a new request");
  const sigs: V2AdminSig[] = [];
  for (const f of argv.slice(2).filter((x) => x.endsWith(".json"))) {
    const s = JSON.parse(readFileSync(resolve(process.cwd(), f), "utf8")) as { digest?: string; signer?: string; signature?: Hex };
    if (s.digest?.toLowerCase() !== digest.toLowerCase()) die(`${f} signs a different change`);
    const signer = getAddress(s.signer!);
    if (!(await read<boolean>("isAdmin", [signer]))) die(`${f}: ${signer} is not an administrator`);
    const k = await keyStatus(signer);
    if (!k.ok || !verifyApprovalV2(Uint8Array.from(Buffer.from(k.pk.slice(2), "hex")), digest, s.signature!)) die(`${f}: the signature does not verify against ${signer}'s registered key`);
    sigs.push({ signer, signature: s.signature! });
  }
  const threshold = await read<number>("threshold");
  if (new Set(sigs.map((s) => s.signer)).size < threshold) die(`${sigs.length} distinct valid signature(s); the vault needs ${threshold}`);
  await preflight(req.op, req.data);
  await relay(req.op, req.data, nonce, expiry, sortSigs(sigs), describeAdminOp(req.op, req.data));
} else {
  const prepare = argv[0] === "prepare";
  const [cmd, target] = prepare ? [argv[1], argv[2]] : [argv[0], argv[1]];
  let built;
  try { built = buildAdminOp(cmd ?? "", target, argv.includes("--remove")); } catch (e) { console.error((e as Error).message); console.error(USAGE); process.exit(2); }
  await preflight(built.op, built.data);
  const nonce = await read<bigint>("adminNonce");
  const expiry = (await evm.getBlock()).timestamp + BigInt(prepare ? 86_400 : 3_600);
  const digest = adminDigestV2(9800n, vault, built.op, built.data, nonce, expiry);
  if ((await read<Hex>("adminDigest", [built.op, built.data, nonce, expiry])) !== digest) die("admin digest mismatch between the vault and TypeScript");
  if (prepare) {
    const req: AdminRequest = { format: ADMIN_REQUEST_FORMAT, chainId: 9800, vault, op: built.op, opName: AdminOp[built.op]!, data: built.data, nonce: nonce.toString(), expiry: expiry.toString(), digest, summary: built.summary, createdAt: new Date().toISOString() };
    const out = resolve(process.cwd(), flag("--out") ?? `v2-admin-request-${nonce}.json`);
    writeFileSync(out, JSON.stringify(req, null, 2) + "\n");
    console.log(`Signing request written: ${out}\n  ${built.summary}\n  admin nonce ${nonce}, valid until ${new Date(Number(expiry) * 1000).toISOString()}\nEach administrator runs: tsx v2-admin.ts sign <their key folder> ${out}\nThen: tsx v2-admin-action.ts relay ${out} <signature files> --broadcast`);
  } else {
    const names = (flag("--signers") ?? "admin-1,admin-2").split(",").map((s) => s.trim());
    if (new Set(names).size !== names.length || names.length < 2) die("need at least two distinct administrators");
    const admins = names.map((n) => LocalAccount.load(resolve(root, ".secrets/v2", n)));
    for (const a of admins) if (!(await read<boolean>("isAdmin", [a.pub.evmAddress]))) die(`${a.pub.evmAddress} (${a.dir}) is not an administrator on the vault`);
    const subject = adminSubject(built.op, built.data);
    if (built.op === AdminOp.RemoveAdmin && admins.some((a) => getAddress(a.pub.evmAddress) === subject)) console.log("note: the administrator being removed is one of the signers; that is allowed (it cannot act alone)");
    const sigs = sortSigs(admins.map((a) => ({ signer: a.pub.evmAddress, signature: signApprovalV2(a.pqc().secretKey, digest) })));
    await relay(built.op, built.data, nonce, expiry, sigs, built.summary);
  }
}
