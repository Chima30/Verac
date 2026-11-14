import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeErrorResult, encodeEventTopics, keccak256, toHex, type Hex } from "viem";
import { DEPLOYED, treasuryVaultAbi, milestoneEscrowAbi } from "./contracts";
import { ChainExecution, decodeRevertData, toPaymentTuple } from "./execution";

const deployments = JSON.parse(readFileSync(resolve(__dirname, "../../../deployments/diana-testnet.json"), "utf8")) as { contracts: Record<string, { address: string }> };

describe("contract addresses", () => {
  it("match deployments/diana-testnet.json exactly", () => {
    for (const [name, address] of Object.entries(DEPLOYED)) expect(deployments.contracts[name]!.address).toBe(address);
    expect(Object.keys(DEPLOYED).sort()).toEqual(Object.keys(deployments.contracts).sort());
  });
});

describe("revert decoding", () => {
  it("names the vault's custom errors", () => {
    const data = encodeErrorResult({ abi: treasuryVaultAbi, errorName: "ExceedsPerTxCap" });
    expect(decodeRevertData(data)?.errorName).toBe("ExceedsPerTxCap");
    const approvals = encodeErrorResult({ abi: treasuryVaultAbi, errorName: "InsufficientApprovals", args: [0, 1] });
    expect(decodeRevertData(approvals)).toMatchObject({ errorName: "InsufficientApprovals", args: [0, 1] });
  });
  it("names the escrow's custom errors", () => {
    expect(decodeRevertData(encodeErrorResult({ abi: milestoneEscrowAbi, errorName: "NotApproved" }))?.errorName).toBe("NotApproved");
  });
  it("returns undefined for data that is not one of ours", () => {
    expect(decodeRevertData("0xdeadbeef")).toBeUndefined();
  });
});

const payment = toPaymentTuple({ token: "0x0000000000000000000000000000000000000000", to: "0x200cad3c9de63d3613a33fc20b1ef31cb4dbf5af", amount: "5000000000000000000", purposeHash: keccak256(toHex("inv-1")), policyVersion: 1, expiry: 2_000_000_000, nonce: "7" });

/** A ChainExecution whose chain client is replaced by a stub that returns a canned receipt. */
function withReceipt(receipt: unknown, replayError?: unknown) {
  const x = new ChainExecution({ rest: "http://x", rpc: "http://x", evmRpc: "http://127.0.0.1:1", explorer: "http://x" });
  (x as unknown as { evm: unknown }).evm = {
    getTransactionReceipt: async () => { if (!receipt) throw new Error("not found"); return receipt; },
    getTransaction: async () => ({ from: "0x7615DAb4651b47f69F80305f89F39B211F829dd7", to: DEPLOYED.TreasuryVault, input: "0x", value: 0n }),
    call: async () => { if (replayError) throw replayError; return { data: "0x" }; },
  };
  return x;
}

function log(address: string, abi: typeof treasuryVaultAbi | typeof milestoneEscrowAbi, eventName: string, args: Record<string, unknown>, dataTypes: Array<{ type: string }>, dataValues: unknown[]) {
  const topics = encodeEventTopics({ abi, eventName: eventName as never, args: args as never });
  const data = dataTypes.length ? encodeAbiParameters(dataTypes as never, dataValues as never) : "0x";
  return { address, topics, data, blockNumber: 10n, transactionHash: "0x" + "ab".repeat(32), transactionIndex: 0, blockHash: "0x" + "cd".repeat(32), logIndex: 0, removed: false };
}

describe("verifyReceipt", () => {
  const hash = ("0x" + "11".repeat(32)) as Hex;

  it("reports not_found when the node has no receipt", async () => {
    expect((await withReceipt(null).verifyReceipt(hash)).status).toBe("not_found");
  });

  it("collects the payment hash from a PaymentExecuted event on the vault", async () => {
    const paid = log(DEPLOYED.TreasuryVault, treasuryVaultAbi, "PaymentExecuted",
      { paymentHash: hash, agent: "0x7615DAb4651b47f69F80305f89F39B211F829dd7", to: payment.to },
      [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint64" }], [payment.token, payment.amount, payment.purposeHash, 1n]);
    const v = await withReceipt({ status: "success", blockNumber: 10n, gasUsed: 90_000n, logs: [paid] }).verifyReceipt(hash);
    expect(v.status).toBe("success");
    expect(v.executedPaymentHashes).toEqual([hash]);
  });

  it("ignores a lookalike event emitted by some other contract", async () => {
    const fake = log("0x0000000000000000000000000000000000000bad", treasuryVaultAbi, "PaymentExecuted",
      { paymentHash: hash, agent: "0x7615DAb4651b47f69F80305f89F39B211F829dd7", to: payment.to },
      [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint64" }], [payment.token, payment.amount, payment.purposeHash, 1n]);
    const v = await withReceipt({ status: "success", blockNumber: 10n, gasUsed: 1n, logs: [fake] }).verifyReceipt(hash);
    expect(v.status).toBe("success");
    expect(v.executedPaymentHashes).toEqual([]);
  });

  it("collects escrow release events", async () => {
    const rel = log(DEPLOYED.MilestoneEscrow, milestoneEscrowAbi, "MilestoneReleased",
      { projectId: 1n, index: 0n, payee: payment.to }, [{ type: "uint256" }], [60n * 10n ** 18n]);
    const v = await withReceipt({ status: "success", blockNumber: 10n, gasUsed: 1n, logs: [rel] }).verifyReceipt(hash);
    expect(v.escrowEvents).toEqual([{ event: "MilestoneReleased", projectId: 1n, index: 0n, amount: 60n * 10n ** 18n }]);
  });

  it("reports a reverted receipt as reverted, never as success", async () => {
    const v = await withReceipt({ status: "reverted", blockNumber: 10n, gasUsed: 50_000n, logs: [] }).verifyReceipt(hash);
    expect(v.status).toBe("reverted");
    expect(v.executedPaymentHashes).toEqual([]);
    expect(v.failureReason).toMatch(/reverted/i);
  });
});
