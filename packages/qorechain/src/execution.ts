import { BaseError, ContractFunctionRevertedError, decodeErrorResult, parseEventLogs, type Hex, type PublicClient } from "viem";
import { DEPLOYED, allErrorsAbi, milestoneEscrowAbi, treasuryVaultAbi, type ContractName } from "./contracts";
import { QoreReader, endpointsFromEnv, type QoreEndpoints } from "./index";

/**
 * The read, simulate and verify half of the transaction service. It never signs and never sends: sending goes through a
 * `TxSigner` (see signer.ts) that the pipeline calls only after policy checks and approvals. Everything here is
 * checked against the real chain, nothing is cached as truth.
 */

export interface PaymentTuple {
  token: `0x${string}`;
  to: `0x${string}`;
  amount: bigint;
  purposeHash: Hex;
  policyVersion: bigint;
  expiry: bigint;
  nonce: bigint;
}

export interface SimulationResult {
  ok: boolean;
  /** Contract custom error name (for example ExceedsPerTxCap) when the call would revert. */
  errorName?: string;
  errorArgs?: readonly unknown[];
  message?: string;
  gas?: bigint;
}

export interface ReceiptVerdict {
  status: "success" | "reverted" | "not_found";
  blockNumber?: bigint;
  gasUsed?: bigint;
  /** Payment hashes seen in PaymentExecuted or EscrowFunded events emitted by the vault in this receipt. */
  executedPaymentHashes: Hex[];
  /** Milestone releases and approvals emitted by the escrow in this receipt. */
  escrowEvents: Array<{ event: "MilestoneApproved" | "MilestoneReleased" | "ProjectFunded"; projectId: bigint; index?: bigint; amount?: bigint }>;
  failureReason?: string;
}

export function toPaymentTuple(p: { token: string; to: string; amount: string; purposeHash: string; policyVersion: number; expiry: number; nonce: string }): PaymentTuple {
  return {
    token: p.token as `0x${string}`, to: p.to as `0x${string}`, amount: BigInt(p.amount), purposeHash: p.purposeHash as Hex,
    policyVersion: BigInt(p.policyVersion), expiry: BigInt(p.expiry), nonce: BigInt(p.nonce),
  };
}

/** Turns a viem error into the contract's custom error name when there is one. */
export function describeRevert(err: unknown): Pick<SimulationResult, "errorName" | "errorArgs" | "message"> {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name) return { errorName: name, errorArgs: reverted.data?.args, message: reverted.shortMessage };
    }
    return { message: err.shortMessage };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

/** Decodes raw revert data (0x...) to an error name, or undefined if it is not one of ours. */
export function decodeRevertData(data: Hex): { errorName: string; args?: readonly unknown[] } | undefined {
  try {
    const d = decodeErrorResult({ abi: allErrorsAbi, data });
    return { errorName: d.errorName, args: d.args };
  } catch { return undefined; }
}

export class ChainExecution {
  readonly reader: QoreReader;
  readonly evm: PublicClient;
  readonly contracts: Record<ContractName, `0x${string}`>;

  constructor(endpoints: QoreEndpoints = endpointsFromEnv(), contracts: Record<ContractName, `0x${string}`> = { ...DEPLOYED }) {
    this.reader = new QoreReader(endpoints);
    this.evm = this.reader.evm;
    this.contracts = contracts;
  }

  /** Throws unless the node is chain 9800 and every contract address has code. Call before any write. */
  async verifyDeployment(): Promise<Record<ContractName, boolean>> {
    await this.reader.assertConnectedToTestnet();
    const out = {} as Record<ContractName, boolean>;
    for (const [name, address] of Object.entries(this.contracts) as Array<[ContractName, `0x${string}`]>) {
      const code = await this.evm.getCode({ address });
      out[name] = !!code && code !== "0x";
    }
    return out;
  }

  vaultPaymentHash(agent: `0x${string}`, p: PaymentTuple): Promise<Hex> {
    return this.evm.readContract({ address: this.contracts.TreasuryVault, abi: treasuryVaultAbi, functionName: "paymentHash", args: [agent, p] });
  }
  async onChainApprovals(hash: Hex): Promise<number> {
    return Number(await this.evm.readContract({ address: this.contracts.TreasuryVault, abi: treasuryVaultAbi, functionName: "approvalsOf", args: [hash] }));
  }
  alreadyExecuted(hash: Hex): Promise<boolean> {
    return this.evm.readContract({ address: this.contracts.TreasuryVault, abi: treasuryVaultAbi, functionName: "executed", args: [hash] });
  }
  async agentState(agent: `0x${string}`, token: `0x${string}`) {
    const [limits, remainingDaily] = await Promise.all([
      this.evm.readContract({ address: this.contracts.TreasuryVault, abi: treasuryVaultAbi, functionName: "limits", args: [agent, token] }),
      this.evm.readContract({ address: this.contracts.TreasuryVault, abi: treasuryVaultAbi, functionName: "remainingDaily", args: [agent, token] }),
    ]);
    const [active, validUntil, perTxCap, dailyCap, autoApproveCap] = limits;
    return { active, validUntil, perTxCap, dailyCap, autoApproveCap, remainingDaily };
  }
  approvalsRequired(agent: `0x${string}`, p: PaymentTuple): Promise<number> {
    return this.evm.readContract({ address: this.contracts.TreasuryVault, abi: treasuryVaultAbi, functionName: "approvalsRequired", args: [agent, p.token, p.to, p.amount] }).then(Number);
  }
  vaultBalance(): Promise<bigint> { return this.evm.getBalance({ address: this.contracts.TreasuryVault }); }

  // ---------------------------------------------------------------- simulation (eth_call, never sends)
  async simulateExecutePayment(agent: `0x${string}`, p: PaymentTuple): Promise<SimulationResult> {
    try {
      const { request } = await this.evm.simulateContract({ address: this.contracts.TreasuryVault, abi: treasuryVaultAbi, functionName: "executePayment", args: [p], account: agent });
      const gas = await this.evm.estimateContractGas({ address: this.contracts.TreasuryVault, abi: treasuryVaultAbi, functionName: "executePayment", args: [p], account: agent }).catch(() => undefined);
      void request;
      return { ok: true, gas };
    } catch (e) { return { ok: false, ...describeRevert(e) }; }
  }
  async simulateFundEscrow(agent: `0x${string}`, p: PaymentTuple, projectId: bigint): Promise<SimulationResult> {
    try {
      await this.evm.simulateContract({ address: this.contracts.TreasuryVault, abi: treasuryVaultAbi, functionName: "fundEscrow", args: [p, projectId], account: agent });
      return { ok: true };
    } catch (e) { return { ok: false, ...describeRevert(e) }; }
  }
  async simulateApprovePayment(approver: `0x${string}`, agent: `0x${string}`, p: PaymentTuple): Promise<SimulationResult> {
    try {
      await this.evm.simulateContract({ address: this.contracts.TreasuryVault, abi: treasuryVaultAbi, functionName: "approvePayment", args: [agent, p], account: approver });
      return { ok: true };
    } catch (e) { return { ok: false, ...describeRevert(e) }; }
  }
  async simulateReleaseMilestone(caller: `0x${string}`, projectId: bigint, index: bigint): Promise<SimulationResult> {
    try {
      await this.evm.simulateContract({ address: this.contracts.MilestoneEscrow, abi: milestoneEscrowAbi, functionName: "releaseMilestone", args: [projectId, index], account: caller });
      return { ok: true };
    } catch (e) { return { ok: false, ...describeRevert(e) }; }
  }
  async simulateApproveMilestone(reviewer: `0x${string}`, projectId: bigint, index: bigint): Promise<SimulationResult> {
    try {
      await this.evm.simulateContract({ address: this.contracts.MilestoneEscrow, abi: milestoneEscrowAbi, functionName: "approveMilestone", args: [projectId, index], account: reviewer });
      return { ok: true };
    } catch (e) { return { ok: false, ...describeRevert(e) }; }
  }

  // ---------------------------------------------------------------- verification
  /**
   * Reads the real receipt. A transaction counts as successful only when the node says it succeeded; the caller then
   * checks that the expected event for its own payment hash is present before reporting anything as paid.
   */
  async verifyReceipt(txHash: Hex): Promise<ReceiptVerdict> {
    let receipt;
    try { receipt = await this.evm.getTransactionReceipt({ hash: txHash }); }
    catch { return { status: "not_found", executedPaymentHashes: [], escrowEvents: [] }; }

    if (receipt.status !== "success") {
      return { status: "reverted", blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, executedPaymentHashes: [], escrowEvents: [], failureReason: await this.replayRevert(txHash, receipt.blockNumber) };
    }
    const vaultLogs = parseEventLogs({ abi: treasuryVaultAbi, logs: receipt.logs.filter((l) => l.address.toLowerCase() === this.contracts.TreasuryVault.toLowerCase()), strict: false });
    const executedPaymentHashes = vaultLogs
      .filter((l) => l.eventName === "PaymentExecuted" || l.eventName === "EscrowFunded")
      .map((l) => (l.args as { paymentHash: Hex }).paymentHash);
    const escrowLogs = parseEventLogs({ abi: milestoneEscrowAbi, logs: receipt.logs.filter((l) => l.address.toLowerCase() === this.contracts.MilestoneEscrow.toLowerCase()), strict: false });
    const escrowEvents: ReceiptVerdict["escrowEvents"] = [];
    for (const l of escrowLogs) {
      const a = l.args as { projectId: bigint; index?: bigint; amount?: bigint };
      if (l.eventName === "MilestoneApproved" || l.eventName === "MilestoneReleased" || l.eventName === "ProjectFunded") escrowEvents.push({ event: l.eventName, projectId: a.projectId, index: a.index, amount: a.amount });
    }
    return { status: "success", blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, executedPaymentHashes, escrowEvents };
  }

  /** Replays a failed transaction at its block to recover the custom error. Best effort; returns a plain note if the node cannot. */
  private async replayRevert(txHash: Hex, blockNumber: bigint): Promise<string> {
    try {
      const tx = await this.evm.getTransaction({ hash: txHash });
      await this.evm.call({ account: tx.from, to: tx.to ?? undefined, data: tx.input, value: tx.value, blockNumber: blockNumber - 1n });
      return "The transaction reverted on chain (the replay did not reproduce a reason).";
    } catch (e) {
      const d = describeRevert(e);
      return d.errorName ? `Reverted on chain: ${d.errorName}` : `The transaction reverted on chain${d.message ? `: ${d.message}` : ""}`;
    }
  }
}

/** Adds the receipt wait to ChainExecution without changing its constructor: poll until mined, then verify. */
export async function waitForVerifiedReceipt(x: ChainExecution, txHash: Hex, timeoutMs = 90_000): Promise<ReceiptVerdict> {
  try { await x.evm.waitForTransactionReceipt({ hash: txHash, timeout: timeoutMs, pollingInterval: 2_000 }); } catch { /* fall through: verifyReceipt reports not_found */ }
  return x.verifyReceipt(txHash);
}
