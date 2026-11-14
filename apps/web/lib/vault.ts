import { parseAbi, type PublicClient } from "viem";
import deployment from "../../../deployments/diana-testnet.json";
import { reader } from "./server";

const VAULT = deployment.contracts.TreasuryVault.address as `0x${string}`;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

export const vaultAbi = parseAbi([
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function approvalThreshold() view returns (uint8)",
  "function approverCount() view returns (uint32)",
  "function policyManager() view returns (address)",
  "function limits(address agent, address token) view returns (bool active, uint64 validUntil, uint128 perTxCap, uint128 dailyCap, uint128 autoApproveCap)",
  "function remainingDaily(address agent, address token) view returns (uint256)",
  "event Deposited(address indexed token, address indexed from, uint256 amount)",
  "event AgentLimitsSet(address indexed agent, address indexed token, uint128 perTxCap, uint128 dailyCap, uint128 autoApproveCap, uint64 validUntil)",
  "event AgentRevoked(address indexed agent, address indexed token)",
  "event RecipientSet(address indexed recipient, bool approved)",
  "event PaymentApproved(bytes32 indexed paymentHash, address indexed approver, uint32 approvals)",
  "event PaymentExecuted(bytes32 indexed paymentHash, address indexed agent, address indexed to, address token, uint256 amount, bytes32 purposeHash, uint64 policyVersion)",
  "event EscrowFunded(bytes32 indexed paymentHash, address indexed escrow, uint256 indexed projectId, address token, uint256 amount)",
]);
const pmAbi = parseAbi(["function activeVersion() view returns (uint64)"]);

export interface AgentRule { agent: string; token: string; active: boolean; validUntil: number; perTxCap: bigint; dailyCap: bigint; autoApproveCap: bigint; remainingToday: bigint }
export interface VaultEvent { block: bigint; tx: string; kind: string; detail: string }
export interface VaultSnapshot {
  ok: boolean; error?: string; readAtBlock?: string;
  address: string; balance?: bigint; owner?: string; paused?: boolean; approvalThreshold?: number; approverCount?: number; policyManager?: string; policyVersion?: string;
  rules: AgentRule[]; events: VaultEvent[]; eventsError?: string;
}

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;
const isNative = (t: string) => t.toLowerCase() === ZERO;

export function formatWei(v: bigint): string {
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
export const tokenLabel = (t: string) => (isNative(t) ? "QOR" : short(t));

/** Turns decoded logs into rows a person can read. Pure, so it is unit tested. */
export function describeEvents(logs: Array<{ eventName: string; args: Record<string, unknown>; blockNumber: bigint; transactionHash: string }>): VaultEvent[] {
  return logs.map((l) => {
    const str = (k: string) => String(l.args[k] ?? "");
    const big = (k: string) => formatWei(BigInt(String(l.args[k] ?? 0)));
    let detail = "";
    switch (l.eventName) {
      case "Deposited": detail = `${big("amount")} ${tokenLabel(str("token"))} from ${short(str("from"))}`; break;
      case "AgentLimitsSet": detail = `agent ${short(str("agent"))}: ${big("perTxCap")} per payment, ${big("dailyCap")} per day, ${big("autoApproveCap")} auto-approve`; break;
      case "AgentRevoked": detail = `agent ${short(str("agent"))} revoked`; break;
      case "RecipientSet": detail = `${short(str("recipient"))} ${l.args.approved ? "approved" : "removed"} as recipient`; break;
      case "PaymentApproved": detail = `approved by ${short(str("approver"))} (${str("approvals")} so far)`; break;
      case "PaymentExecuted": detail = `agent ${short(str("agent"))} paid ${big("amount")} ${tokenLabel(str("token"))} to ${short(str("to"))}`; break;
      case "EscrowFunded": detail = `${big("amount")} ${tokenLabel(str("token"))} into escrow project ${str("projectId")}`; break;
      default: detail = "";
    }
    return { block: l.blockNumber, tx: l.transactionHash, kind: l.eventName, detail };
  });
}

type RawLog = { eventName: string; args: Record<string, unknown>; blockNumber: bigint; transactionHash: string };
/** The testnet node refuses log queries spanning more than 10,000 blocks, so scan in chunks and remember what was already scanned. */
const CHUNK = 9_000n;
const cache: { scannedTo: bigint | null; logs: RawLog[] } = { scannedTo: null, logs: [] };

async function scanLogs(evm: PublicClient, deployBlock: bigint, latest: bigint): Promise<RawLog[]> {
  const from = cache.scannedTo === null ? deployBlock : cache.scannedTo + 1n;
  const ranges: Array<[bigint, bigint]> = [];
  for (let a = from; a <= latest; a += CHUNK) ranges.push([a, a + CHUNK - 1n > latest ? latest : a + CHUNK - 1n]);
  const events = vaultAbi.filter((x) => x.type === "event");
  const found: RawLog[] = [];
  for (let i = 0; i < ranges.length; i += 6) {
    const batch = await Promise.all(ranges.slice(i, i + 6).map(([a, b]) => evm.getLogs({ address: VAULT, events, fromBlock: a, toBlock: b })));
    for (const logs of batch) found.push(...(logs as unknown as RawLog[]));
  }
  cache.logs.push(...found);   // only after every chunk succeeded, so a failure never leaves a gap
  cache.scannedTo = latest;
  return cache.logs;
}

export async function vaultSnapshot(): Promise<VaultSnapshot> {
  const base: VaultSnapshot = { ok: false, address: VAULT, rules: [], events: [] };
  try {
    const evm = reader().evm as PublicClient;
    const [block, balance, owner, paused, approvalThreshold, approverCount, pm] = await Promise.all([
      evm.getBlockNumber(), evm.getBalance({ address: VAULT }),
      evm.readContract({ address: VAULT, abi: vaultAbi, functionName: "owner" }),
      evm.readContract({ address: VAULT, abi: vaultAbi, functionName: "paused" }),
      evm.readContract({ address: VAULT, abi: vaultAbi, functionName: "approvalThreshold" }),
      evm.readContract({ address: VAULT, abi: vaultAbi, functionName: "approverCount" }),
      evm.readContract({ address: VAULT, abi: vaultAbi, functionName: "policyManager" }),
    ]);
    const policyVersion = await evm.readContract({ address: pm, abi: pmAbi, functionName: "activeVersion" }).then((v) => v.toString()).catch(() => undefined);
    const snap: VaultSnapshot = { ...base, ok: true, readAtBlock: block.toString(), balance, owner, paused, approvalThreshold, approverCount, policyManager: pm, policyVersion };

    try {
      const receipt = await evm.getTransactionReceipt({ hash: deployment.contracts.TreasuryVault.tx as `0x${string}` });
      const decoded = await scanLogs(evm, receipt.blockNumber, block);
      snap.events = describeEvents(decoded).sort((a, b) => Number(b.block - a.block)).slice(0, 40);
      const pairs = new Map<string, { agent: `0x${string}`; token: `0x${string}` }>();
      for (const l of decoded) if (l.eventName === "AgentLimitsSet") { const a = l.args as { agent: `0x${string}`; token: `0x${string}` }; pairs.set(`${a.agent}:${a.token}`, a); }
      snap.rules = await Promise.all([...pairs.values()].map(async ({ agent, token }) => {
        const [l, rem] = await Promise.all([
          evm.readContract({ address: VAULT, abi: vaultAbi, functionName: "limits", args: [agent, token] }),
          evm.readContract({ address: VAULT, abi: vaultAbi, functionName: "remainingDaily", args: [agent, token] }),
        ]);
        return { agent, token, active: l[0], validUntil: Number(l[1]), perTxCap: l[2], dailyCap: l[3], autoApproveCap: l[4], remainingToday: rem };
      }));
    } catch (e) { snap.eventsError = e instanceof Error ? e.message.slice(0, 200) : String(e); }
    return snap;
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}
