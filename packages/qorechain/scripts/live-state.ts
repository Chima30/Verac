/** Read-only: prints the vault's current agent limits, approvers and threshold. Sends nothing, needs no key. */
import { createPublicClient, formatEther, http, parseAbi } from "viem";
import { DEPLOYED } from "../src/contracts";

const evm = createPublicClient({ transport: http(process.env.QORE_EVM_RPC ?? "https://evm-testnet.qore.host") });
const vault = DEPLOYED.TreasuryVault;
const abi = parseAbi([
  "function owner() view returns (address)",
  "function approvalThreshold() view returns (uint8)",
  "function approverCount() view returns (uint32)",
  "function paused() view returns (bool)",
  "function limits(address,address) view returns (bool active,uint64 validUntil,uint128 perTxCap,uint128 dailyCap,uint128 autoApproveCap)",
  "function isApprover(address) view returns (bool)",
  "function approvedRecipient(address) view returns (bool)",
]);
const read = (functionName: string, args: unknown[] = []) => evm.readContract({ address: vault, abi, functionName, args } as never);
const NATIVE = "0x0000000000000000000000000000000000000000";
const agent = (process.env.AGENT ?? "0x7615DAb4651b47f69F80305f89F39B211F829dd7") as `0x${string}`;

console.log("chain id", await evm.getChainId());
console.log("vault", vault, "balance", formatEther(await evm.getBalance({ address: vault })), "QOR");
console.log("owner", await read("owner"), "| paused", await read("paused"));
console.log("approvalThreshold", await read("approvalThreshold"), "| approverCount", await read("approverCount"));
const l = (await read("limits", [agent, NATIVE])) as readonly [boolean, bigint, bigint, bigint, bigint];
console.log("agent", agent);
console.log("  active", l[0], "| validUntil", new Date(Number(l[1]) * 1000).toISOString(), `(${l[1]})`);
console.log("  perTxCap", formatEther(l[2]), "| dailyCap", formatEther(l[3]), "| autoApproveCap", formatEther(l[4]));
console.log("  agent is also an approver?", await read("isApprover", [agent]));
for (const a of process.argv.slice(2)) console.log("address", a, "isApprover", await read("isApprover", [a]), "approvedRecipient", await read("approvedRecipient", [a]));
