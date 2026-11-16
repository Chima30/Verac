/**
 * Creates the fresh Q-Day Survivor drill account on the Diana testnet. It shares nothing with Verac's other keys.
 *
 * Writes three files under .secrets/qday-drill/ (gitignored). Only public addresses are printed.
 *   ecdsa-private-key.txt    the classical secp256k1 key, one line of hex. THIS is what the drill form asks for;
 *                            it is handed to the attack bot and is to be treated as stolen from that moment on.
 *   pqc-recovery-code.txt    the QRC1 recovery code the ML-DSA-87 key is derived from. NEVER paste it anywhere.
 *                            Kept in its own file, as the QoreChain docs advise, so one copy does not take both keys.
 *   account.json             public data only: addresses and the ML-DSA-87 public key.
 *
 * Refuses to overwrite an existing drill account.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evmToQor, generatePqcRecoveryCode, pqcKeyFromRecoveryCode } from "@qorechain/sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const dir = resolve(process.cwd(), process.argv[2] ?? ".secrets/qday-drill");
if (existsSync(resolve(dir, "ecdsa-private-key.txt")) || existsSync(resolve(dir, "pqc-recovery-code.txt"))) {
  console.error(`Refusing to overwrite the drill account in ${dir}.`);
  process.exit(1);
}
const privateKey = generatePrivateKey();
const evm = privateKeyToAccount(privateKey).address;
const qor = evmToQor(evm);
const code = generatePqcRecoveryCode();
const pqc = pqcKeyFromRecoveryCode(code, qor);

mkdirSync(dir, { recursive: true });
const opts = { mode: 0o600, flag: "wx" } as const;
writeFileSync(resolve(dir, "ecdsa-private-key.txt"), `${privateKey}\n`, opts);
writeFileSync(resolve(dir, "pqc-recovery-code.txt"), `${code}\n`, opts);
writeFileSync(resolve(dir, "account.json"), JSON.stringify({
  purpose: process.env.QDAY_ROLE === "admin"
    ? "Q-Day drill ADMIN: owns and approves for the drill contracts. NEVER submit this key anywhere. Testnet only."
    : "QoreChain Build Before Q-Day: Q-Day Survivor drill account. Testnet only. Not a Verac operating key.",
  network: "qorechain-diana", evmAddress: evm, qorAddress: qor,
  mlDsa87PublicKey: Buffer.from(pqc.publicKey).toString("hex"),
  files: {
    "ecdsa-private-key.txt": "Classical key. Paste ONLY this into the drill form. Treat as compromised once submitted.",
    "pqc-recovery-code.txt": "Post-quantum recovery code. Never share, never paste into any form.",
  },
}, null, 2), opts);

console.log("Created the Q-Day drill account. Secrets were written to files and are not shown.");
console.log("QOR address :", qor);
console.log("EVM address :", evm);
