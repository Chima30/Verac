/**
 * Creates a fresh THROWAWAY Diana-testnet account locally: a secp256k1 key plus an ML-DSA-87 key.
 * Secrets are written to .secrets/testnet-account.json (gitignored, never printed). Only public values are shown.
 * Refuses to overwrite an existing account file.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generatePqcKeypair, evmToQor } from "@qorechain/sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const file = resolve(process.cwd(), process.argv[2] ?? ".secrets/testnet-account.json");
if (existsSync(file)) {
  console.error(`Refusing to overwrite ${file}. Delete it yourself first if you really want a new account.`);
  process.exit(1);
}
const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);
const pqc = generatePqcKeypair();
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify({
  warning: "THROWAWAY TESTNET KEYS ONLY. Never put funds of value here. Never commit or share this file.",
  network: "qorechain-diana", evmAddress: account.address, qorAddress: evmToQor(account.address),
  secp256k1PrivateKey: privateKey, mlDsa87PublicKey: hex(pqc.publicKey), mlDsa87SecretKey: hex(pqc.secretKey),
}, null, 2), { mode: 0o600 });

console.log("Created throwaway testnet account (secrets saved to the account file, not shown).");
console.log("QOR address :", evmToQor(account.address));
console.log("EVM address :", account.address);
console.log("Next: fund the QOR address from the faucet, then send me ONLY the addresses above.");
