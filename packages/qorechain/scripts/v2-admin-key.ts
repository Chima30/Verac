/**
 * Creates and registers a NEW administrator key for TreasuryVault V2. Run it ON THE NEW ADMINISTRATOR'S OWN COMPUTER:
 * the key is made there and never leaves it. Only the public account (account.json) is shared.
 *
 *   tsx v2-admin-key.ts create <folder>                 new EVM key + ML-DSA-87 key (with a recovery code) in <folder>
 *   tsx v2-admin-key.ts status <folder>                 balance and registration state on QoreChain
 *   tsx v2-admin-key.ts register <folder> [--broadcast] registers the ML-DSA-87 key with proof of possession
 *
 * After registering, the existing administrators add it and then remove the key it replaces:
 *   v2-admin-action.ts prepare add-admin <new 0x> → each signs with v2-admin.ts → v2-admin-action.ts relay … --broadcast
 *   v2-admin-action.ts prepare remove-admin <old 0x> → the same
 * Registration costs a small native fee: fund the account's qor1… address with about 1 testnet QOR first.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseAbi } from "viem";
import { QoreReader } from "../src/index";
import { LocalAccount, assertDiana, pqcRegistered, registerPqc, uqorBalance } from "./lib/accounts";

const [cmd, folder, ...rest] = process.argv.slice(2);
if (!["create", "status", "register"].includes(cmd ?? "") || !folder) { console.error("usage: v2-admin-key.ts create|status|register <folder> [--broadcast]"); process.exit(2); }
const dir = resolve(process.cwd(), folder);
const die = (m: string): never => { console.error(`REFUSED: ${m}`); process.exit(1); };

if (cmd === "create") {
  if (existsSync(resolve(dir, "account.json"))) die(`${dir} already holds an account; choose a new folder`);
  const a = LocalAccount.create(dir, "admin");
  console.log(`New administrator account in ${dir} (keep this folder private; back up pqc-recovery-code.txt offline):`);
  console.log(`  EVM address   ${a.pub.evmAddress}   ← the address administrators add`);
  console.log(`  qor address   ${a.pub.qorAddress}   ← fund this with about 1 testnet QOR for the registration fee`);
  console.log(`Next: tsx v2-admin-key.ts register ${folder} --broadcast`);
  process.exit(0);
}

await assertDiana();
const a = LocalAccount.load(dir);
const reader = new QoreReader();
const status = async () => {
  const [bal, reg] = await Promise.all([uqorBalance(a.pub.qorAddress), pqcRegistered(a.pub.qorAddress)]);
  const [registered, alg, pk, proven] = await reader.evm.readContract({ address: "0x0000000000000000000000000000000000000a02", abi: parseAbi(["function pqcKeyStatus(address) view returns (bool, uint8, bytes, bool)"]), functionName: "pqcKeyStatus", args: [a.pub.evmAddress] });
  const matches = pk.slice(2).toLowerCase() === a.pub.mlDsa87PublicKey.toLowerCase();
  return { bal, reg, precompile: { registered, alg, proven, matches } };
};
const s = await status();
console.log(`${a.pub.evmAddress} (${a.pub.qorAddress})\n  balance ${Number(s.bal) / 1e6} QOR\n  ML-DSA-87 key: ${s.reg.found ? `registered, possession ${s.reg.proven ? "proven" : "NOT proven"}, ${s.reg.pub === a.pub.mlDsa87PublicKey ? "matches this folder" : "DIFFERENT from this folder"}` : "not registered"}\n  as the vault sees it (precompile 0x…0a02): registered ${s.precompile.registered}, proven ${s.precompile.proven}, matches ${s.precompile.matches}`);
if (cmd === "status") process.exit(0);

if (s.reg.found) {
  if (s.reg.pub !== a.pub.mlDsa87PublicKey || !s.reg.proven) die("a different or unproven key is registered for this account; use a new folder");
  console.log("Already registered with proof of possession. Nothing to do.");
  process.exit(0);
}
if (s.bal < 300_000n) die(`the account needs about 1 testnet QOR for the registration fee (it has ${Number(s.bal) / 1e6}); send some to ${a.pub.qorAddress}`);
if (!rest.includes("--broadcast")) { console.log("DRY RUN: would register this account's ML-DSA-87 key with proof of possession. Re-run with --broadcast."); process.exit(0); }
const r = await registerPqc(a);
if (r.code !== 0) die(`registration failed: ${r.rawLog}`);
console.log(`registered: ${r.hash} (height ${r.height})`);
const after = await status();
console.log(after.precompile.registered && after.precompile.proven && after.precompile.matches ? `The vault will now accept ${a.pub.evmAddress} as an administrator.` : "WARNING: the precompile does not show a proven matching key yet; check again in a few blocks with status.");
