/** Read-only: owners, approvers, guardians, threshold and agent limits of the deployed Verac contracts. Sends nothing. */
import { parseAbi } from "viem";
import { DEPLOYED, treasuryVaultAbi } from "../src/contracts";
import { QoreReader } from "../src/index";

const evm = new QoreReader().evm;
const V = DEPLOYED.TreasuryVault;
const own = parseAbi(["function owner() view returns (address)", "function pendingOwner() view returns (address)"]);
const r = (address: `0x${string}`, abi: readonly unknown[], functionName: string, args: readonly unknown[] = []) =>
  evm.readContract({ address, abi: abi as never, functionName, args } as never).catch((e: unknown) => `ERR ${String(e).slice(0, 60)}`);

for (const [n, a] of Object.entries(DEPLOYED)) console.log(n.padEnd(22), a, "owner", await r(a, own, "owner"), "pending", await r(a, own, "pendingOwner"));
console.log("vault approvalThreshold", await r(V, treasuryVaultAbi, "approvalThreshold"), "approverCount", await r(V, treasuryVaultAbi, "approverCount"), "paused", await r(V, treasuryVaultAbi, "paused"));
for (const [n, a] of [["approver", "0x0Db385bBa0D24d47F1a73EDE8df84FAce785f91A"], ["agent", "0x7615DAb4651b47f69F80305f89F39B211F829dd7"], ["owner", "0x5B108321e824faf53AA198fcD1682A07a68970F2"]] as const)
  console.log(n.padEnd(9), a, "isApprover", await r(V, treasuryVaultAbi, "isApprover", [a]), "isGuardian", await r(V, treasuryVaultAbi, "isGuardian", [a]));
const l = await r(V, treasuryVaultAbi, "limits", ["0x7615DAb4651b47f69F80305f89F39B211F829dd7", "0x0000000000000000000000000000000000000000"]);
console.log("agent limits", Array.isArray(l) ? l.map(String) : l);
console.log("vault balance", Number(await evm.getBalance({ address: V })) / 1e18, "QOR");
