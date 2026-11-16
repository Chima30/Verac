/**
 * Read-only: takes the contract addresses from deployments/diana-testnet.json (plus the agent account), checks each one on
 * QoreChain Diana testnet, and prints the native qor1 form. Sends nothing, needs no key.
 *   pnpm exec tsx packages/qorechain/scripts/addresses.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, formatEther, getAddress, http, parseAbi } from "viem";
import { evmToQor, isChecksumAddress, isValidBech32, qorToEvm } from "@qorechain/sdk";

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "deployments/diana-testnet.json"), "utf8")) as {
  evmChainId: number; owner: string; contracts: Record<string, { address: string }>;
};
const evm = createPublicClient({ transport: http(process.env.QORE_EVM_RPC ?? "https://evm-testnet.qore.host") });
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const vault = manifest.contracts.TreasuryVault!.address as `0x${string}`;
// The deployment manifest does not list the agent. It is the account the vault itself reports as active (checked below).
const agent = (process.env.AGENT ?? "0x7615DAb4651b47f69F80305f89F39B211F829dd7") as `0x${string}`;

const vaultAbi = parseAbi([
  "function owner() view returns (address)",
  "function policyManager() view returns (address)",
  "function limits(address,address) view returns (bool active,uint64 validUntil,uint128 perTxCap,uint128 dailyCap,uint128 autoApproveCap)",
]);
const read = (address: `0x${string}`, functionName: string, args: unknown[] = []) => evm.readContract({ address, abi: vaultAbi, functionName, args } as never);

const chainId = await evm.getChainId();
if (chainId !== manifest.evmChainId) throw new Error(`connected to chain ${chainId}, manifest says ${manifest.evmChainId}`);
console.log(`chain ${chainId} (manifest agrees)\n`);

type Row = { name: string; evm: `0x${string}`; kind: "contract" | "account"; check: string };
const rows: Row[] = [];
for (const name of ["TreasuryVault", "MilestoneEscrow", "PolicyManager"]) {
  const a = manifest.contracts[name]!.address as `0x${string}`;
  const code = await evm.getCode({ address: a });
  let link = "";
  if (name === "TreasuryVault") link = `; owner() = ${await read(a, "owner")}, policyManager() = ${await read(a, "policyManager")}`;
  rows.push({ name, evm: a, kind: "contract", check: `${code && code !== "0x" ? `bytecode present (${(code.length - 2) / 2} bytes)` : "NO BYTECODE"}${link}` });
}
const lim = (await read(vault, "limits", [agent, NATIVE])) as readonly [boolean, bigint, bigint, bigint, bigint];
const agentCode = await evm.getCode({ address: agent });
rows.push({ name: "Agent (executes payments)", evm: agent, kind: "account", check: `${agentCode && agentCode !== "0x" ? "UNEXPECTED BYTECODE" : "plain account"}; vault limits: active=${lim[0]}, perTx ${formatEther(lim[2])} QOR, daily ${formatEther(lim[3])} QOR` });
const owner = manifest.owner as `0x${string}`;
rows.push({ name: "Owner / deployer", evm: owner, kind: "account", check: `vault.owner() ${String((await read(vault, "owner")) as string).toLowerCase() === owner.toLowerCase() ? "matches" : "DOES NOT MATCH"}; balance ${formatEther(await evm.getBalance({ address: owner }))} QOR` });

let bad = 0;
for (const r of rows) {
  const qor = evmToQor(r.evm);
  const back = qorToEvm(qor);
  const roundTrip = back.toLowerCase() === r.evm.toLowerCase();
  const ok = roundTrip && isValidBech32(qor) && isChecksumAddress(getAddress(r.evm)) && !/NO BYTECODE|UNEXPECTED|DOES NOT/.test(r.check);
  if (!ok) bad++;
  console.log(`${ok ? "OK " : "BAD"} ${r.name}\n    EVM    ${r.evm}\n    native ${qor}\n    round trip ${roundTrip ? "yes" : "NO"}; ${r.check}\n`);
}
if (bad) process.exit(1);
