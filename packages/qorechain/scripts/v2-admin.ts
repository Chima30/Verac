/**
 * Verac administrator signing tool for TreasuryVault V2. Runs on the ADMINISTRATOR'S OWN COMPUTER, with their own key folder
 * (split layout: ecdsa-private-key.txt, pqc-recovery-code.txt, account.json). The website never sees the key.
 *
 *   tsx v2-admin.ts sign <admin-key-folder> <signing-request.json> [--vault 0x…] [--yes]
 *
 * It does NOT trust the request file. It:
 *   1. refuses any vault other than the expected one (--vault, or deployments/v2-diana.json), and any chain but Diana (9800);
 *   2. recomputes the digest from the payment fields and compares it with the request and with the live vault's paymentDigest;
 *   3. checks this key is an administrator on the vault and that its ML-DSA-87 key is the one registered on QoreChain;
 *   4. shows the payment in plain words and asks for "yes" (unless --yes);
 *   5. signs "verac-v2-approval|" + digest with ML-DSA-87 and writes a signature file to upload to Verac.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, parseAbi, type Hex } from "viem";
import { QoreReader } from "../src/index";
import { paymentDigestV2, signApprovalV2, treasuryVaultV2Abi, verifyApprovalV2, type V2Payment } from "../src/v2";
import { LocalAccount } from "./lib/accounts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const [cmd, keyDir, reqFile, ...rest] = process.argv.slice(2);
const flag = (n: string) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
if (cmd !== "sign" || !keyDir || !reqFile) { console.error("usage: v2-admin.ts sign <admin-key-folder> <signing-request.json> [--vault 0x…] [--yes]"); process.exit(2); }

const die = (m: string): never => { console.error(`REFUSED: ${m}`); process.exit(1); };
const req = JSON.parse(readFileSync(resolve(process.cwd(), reqFile), "utf8")) as {
  format?: string; chainId?: number; vault?: string; agent?: string; transactionId?: string; digest?: string;
  payment?: { token: string; to: string; amount: string; purposeHash: string; policyVersion: string; expiry: string; nonce: string };
};
if (req.format !== "verac-v2-signing-request/1") die("not a Verac V2 signing request");
if (req.chainId !== 9800) die(`chain ${req.chainId} is not Diana testnet (9800)`);
const recorded = existsSync(resolve(root, "deployments/v2-diana.json")) ? (JSON.parse(readFileSync(resolve(root, "deployments/v2-diana.json"), "utf8")) as { TreasuryVaultV2?: string }).TreasuryVaultV2 : undefined;
const expectedVault = flag("--vault") ?? recorded ?? die("no expected vault: pass --vault 0x…");
if (getAddress(req.vault!) !== getAddress(expectedVault)) die(`the request names vault ${req.vault}, not the expected ${expectedVault}`);
const vault = getAddress(expectedVault), agent = getAddress(req.agent!);
const P = req.payment ?? die("no payment fields");
const p: V2Payment = { token: getAddress(P.token), to: getAddress(P.to), amount: BigInt(P.amount), purposeHash: P.purposeHash as Hex, policyVersion: BigInt(P.policyVersion), expiry: BigInt(P.expiry), nonce: BigInt(P.nonce) };
const digest = paymentDigestV2(9800n, vault, agent, p);
if (digest.toLowerCase() !== String(req.digest).toLowerCase()) die("the digest in the request does not match its payment fields");

const me = LocalAccount.load(resolve(process.cwd(), keyDir));
const reader = new QoreReader();
await reader.assertConnectedToTestnet();
const evm = reader.evm;
const read = <T>(fn: string, args: readonly unknown[] = []) => evm.readContract({ address: vault, abi: treasuryVaultV2Abi, functionName: fn, args } as never) as Promise<T>;
const [onChainDigest, isAdmin, recipientOk, executed, policyVersion, paused, block] = await Promise.all([
  read<Hex>("paymentDigest", [agent, p]), read<boolean>("isAdmin", [me.pub.evmAddress]), read<boolean>("approvedRecipient", [p.to]),
  read<boolean>("executed", [digest]), read<bigint>("policyVersion"), read<boolean>("paused"), evm.getBlock(),
]);
if (onChainDigest.toLowerCase() !== digest.toLowerCase()) die("the vault computes a different digest for this payment");
if (!isAdmin) die(`${me.pub.evmAddress} is not an administrator on this vault`);
if (executed) die("this exact payment has already been executed");
const [registered, , pubkey, proven] = await evm.readContract({ address: "0x0000000000000000000000000000000000000a02", abi: parseAbi(["function pqcKeyStatus(address) view returns (bool, uint8, bytes, bool)"]), functionName: "pqcKeyStatus", args: [me.pub.evmAddress] });
if (!registered || !proven || pubkey.slice(2).toLowerCase() !== me.pub.mlDsa87PublicKey.toLowerCase()) die("your ML-DSA-87 key is not the one registered (with proof of possession) on QoreChain");

const qor = Number(p.amount / 10n ** 12n) / 1e6;
console.log("\nYou are asked to approve this payment from TreasuryVault V2 on Diana testnet:\n");
console.log(`  Pay           ${qor} ${p.token === "0x0000000000000000000000000000000000000000" ? "QOR (native)" : `of token ${p.token}`}`);
console.log(`  To            ${p.to}${recipientOk ? "  (approved recipient on the vault)" : "  (NOT an approved recipient: the vault will refuse)"}`);
console.log(`  By agent      ${agent}`);
console.log(`  Purpose hash  ${p.purposeHash}`);
console.log(`  Policy        version ${p.policyVersion}${p.policyVersion === policyVersion ? "" : `  (the vault is on version ${policyVersion}: it will refuse)`}`);
console.log(`  Expires       ${new Date(Number(p.expiry) * 1000).toISOString()}${p.expiry < block.timestamp ? "  (ALREADY EXPIRED)" : ""}`);
console.log(`  Vault         ${vault}${paused ? "  (PAUSED)" : ""}`);
console.log(`  Digest        ${digest}`);
console.log(`  Signing as    ${me.pub.evmAddress}\n`);

if (!rest.includes("--yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question('Type "yes" to sign exactly this payment: ')).trim().toLowerCase();
  rl.close();
  if (a !== "yes") die("not confirmed; nothing was signed");
}
const kp = me.pqc();
const signature = signApprovalV2(kp.secretKey, digest);
if (!verifyApprovalV2(Uint8Array.from(Buffer.from(pubkey.slice(2), "hex")), digest, signature)) die("self-check failed: the signature does not verify against your registered key");
const out = resolve(process.cwd(), flag("--out") ?? reqFile.replace(/\.json$/i, "") + `.signature-${me.pub.evmAddress.slice(2, 8).toLowerCase()}.json`);
writeFileSync(out, JSON.stringify({ format: "verac-v2-signature/1", transactionId: req.transactionId, vault, signer: me.pub.evmAddress, digest, signature }, null, 2) + "\n");
console.log(`Signed. Upload this file in Verac (Approvals): ${out}`);
console.log("It contains only your public address, the payment digest and the signature: no key.");
