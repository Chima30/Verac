import { describe, expect, it } from "vitest";
import { balanceHistory, describeEvents, evenSteps, formatWei, tokenLabel } from "./vault";

const E18 = 10n ** 18n;
const A = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const ZERO = A(0);

describe("vault formatting", () => {
  it("formats wei as QOR without float error", () => {
    expect(formatWei(5n * E18)).toBe("5");
    expect(formatWei(E18 / 2n)).toBe("0.5");
    expect(formatWei(123456789n)).toBe("0");
    expect(formatWei(10n * E18 + 1_500_000_000_000_000n)).toBe("10.0015");
  });
  it("labels native and token addresses", () => {
    expect(tokenLabel(ZERO)).toBe("QOR");
    expect(tokenLabel(A(7))).toContain("…");
  });
  it("rebuilds balance history anchored to the live balance", () => {
    const log = (eventName: string, amount: bigint, blockNumber: bigint, token = ZERO) => ({ eventName, args: { amount, token }, blockNumber });
    const pts = balanceHistory([log("PaymentExecuted", 4n * E18, 30n), log("Deposited", 10n * E18, 10n)], 6n * E18, 1000, 9000, (b) => Number(b) * 100);
    expect(pts.map((p) => p.value)).toEqual([0, 10, 6, 6]);
    expect(pts[0]!.date).toBe(1000);
    expect(pts.at(-1)!.date).toBe(9000);
  });
  it("ignores other tokens and refuses to chart when events do not explain the balance", () => {
    const log = (eventName: string, amount: bigint, blockNumber: bigint, token = ZERO) => ({ eventName, args: { amount, token }, blockNumber });
    expect(balanceHistory([log("Deposited", 5n * E18, 1n, A(9))], 0n, 0, 1, () => 0).map((p) => p.value)).toEqual([0, 0]);
    // A deposit of 5 with nothing left would mean the vault held -5 before it: the events do not explain the balance.
    expect(balanceHistory([log("Deposited", 5n * E18, 1n)], 0n, 0, 1, () => 0)).toEqual([]);
  });
  it("samples a balance at even times, flat between events, ending on the real balance", () => {
    const s = evenSteps([{ date: 0, value: 0 }, { date: 40, value: 10 }, { date: 100, value: 6 }], 11);
    expect(s.map((p) => p.date)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(s.map((p) => p.value)).toEqual([0, 0, 0, 0, 10, 10, 10, 10, 10, 10, 6]);
  });
  it("describes events a person can read", () => {
    const rows = describeEvents([
      { eventName: "PaymentExecuted", args: { agent: A(1), to: A(2), token: ZERO, amount: 5n * E18 }, blockNumber: 10n, transactionHash: "0xaa" },
      { eventName: "AgentLimitsSet", args: { agent: A(1), token: ZERO, perTxCap: 10n * E18, dailyCap: 20n * E18, autoApproveCap: 10n * E18 }, blockNumber: 9n, transactionHash: "0xbb" },
      { eventName: "Mystery", args: {}, blockNumber: 8n, transactionHash: "0xcc" },
    ]);
    expect(rows[0]!.detail).toContain("paid 5 QOR");
    expect(rows[1]!.detail).toContain("10 per payment, 20 per day");
    expect(rows[2]!.detail).toBe("");
  });
});
