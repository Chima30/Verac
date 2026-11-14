import { describe, expect, it } from "vitest";
import { describeEvents, formatWei, tokenLabel } from "./vault";

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
