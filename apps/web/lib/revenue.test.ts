import { describe, expect, it } from "vitest";
import { daysOverdue, effectiveStatus, matchTransfer, summarise, type RevenueRow } from "./revenue";

const Q = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const row = (o: Partial<RevenueRow>): RevenueRow => ({ id: "x", customer: "c", reference: "r", amount: Q(10), due_date: "2026-11-10", status: "issued", matched_tx_hash: null, ...o });
const VAULT = "0xA343930CE94b1d1629791823A75fb14a1D7C7Ab8";

describe("effectiveStatus", () => {
  it("is overdue only when unpaid, not void and past due", () => {
    expect(effectiveStatus(row({}), "2026-11-14")).toBe("overdue");
    expect(effectiveStatus(row({}), "2026-11-10")).toBe("issued"); // due today is not late
    expect(effectiveStatus(row({ status: "paid" }), "2026-11-14")).toBe("paid");
    expect(effectiveStatus(row({ status: "void" }), "2026-11-14")).toBe("void");
  });
  it("counts days late", () => {
    expect(daysOverdue("2026-11-10", "2026-11-14")).toBe(4);
    expect(daysOverdue("2026-11-20", "2026-11-14")).toBe(0);
  });
});

describe("summarise", () => {
  it("separates outstanding, overdue and paid, ignoring void", () => {
    const s = summarise([row({ amount: Q(10) }), row({ amount: Q(5), due_date: "2026-12-31" }), row({ amount: Q(7), status: "paid" }), row({ amount: Q(99), status: "void" })], "2026-11-14");
    expect(s).toEqual({ outstanding: BigInt(Q(15)), overdue: BigInt(Q(10)), paid: BigInt(Q(7)), overdueCount: 1 });
  });
});

describe("matchTransfer", () => {
  const want = { to: VAULT, amount: BigInt(Q(10)) };
  it("verifies a successful transfer of enough to the treasury (address case ignored)", () => {
    expect(matchTransfer({ to: VAULT.toLowerCase(), value: BigInt(Q(10)), success: true }, want).state).toBe("VERIFIED");
    expect(matchTransfer({ to: VAULT, value: BigInt(Q(12)), success: true }, want).state).toBe("VERIFIED");
  });
  it("does not verify a missing, failed, misdirected or short payment", () => {
    expect(matchTransfer(null, want).state).toBe("NOT_FOUND");
    expect(matchTransfer({ to: VAULT, value: BigInt(Q(10)), success: false }, want).state).toBe("NOT_VERIFIED");
    expect(matchTransfer({ to: "0x" + "1".repeat(40), value: BigInt(Q(10)), success: true }, want).state).toBe("NOT_VERIFIED");
    expect(matchTransfer({ to: null, value: BigInt(Q(10)), success: true }, want).state).toBe("NOT_VERIFIED");
    expect(matchTransfer({ to: VAULT, value: BigInt(Q(9)), success: true }, want).state).toBe("NOT_VERIFIED");
  });
});
