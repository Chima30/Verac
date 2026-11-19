/**
 * Writes the server settings that switch on TreasuryVault V2 on the website to .secrets/v2/website-env.txt (gitignored,
 * file mode 0600). Nothing is printed. Copy the lines into Vercel (Settings > Environment Variables, marked Sensitive).
 *
 * They hold only the V2 AGENT's testnet key (capped on the vault: it cannot pay without two administrators' signatures)
 * and the vault address. No administrator key is ever written here: administrators keep theirs on their own computers.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { LocalAccount } from "./lib/accounts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const vault = (JSON.parse(readFileSync(resolve(root, "deployments/v2-diana.json"), "utf8")) as { TreasuryVaultV2: string }).TreasuryVaultV2;
const agent = LocalAccount.load(resolve(root, ".secrets/v2/agent"));
const pq = agent.pqc();
const key = readFileSync(resolve(root, ".secrets/v2/agent/ecdsa-private-key.txt"), "utf8").trim();
const out = resolve(root, ".secrets/v2/website-env.txt");
writeFileSync(out, [
  "# TreasuryVault V2 settings for the website (testnet). Keep private. Paste each line into Vercel as a Sensitive variable.",
  `V2_VAULT_ADDRESS=${vault}`,
  `V2_AGENT_EVM_PRIVATE_KEY=${key}`,
  `V2_AGENT_MLDSA_PUBLIC_KEY=${Buffer.from(pq.publicKey).toString("hex")}`,
  `V2_AGENT_MLDSA_SECRET_KEY=${Buffer.from(pq.secretKey).toString("hex")}`,
  "",
].join("\n"), { mode: 0o600 });
console.log(`Wrote ${out} (V2 vault ${vault}, agent ${agent.pub.evmAddress}). Values not shown.`);
