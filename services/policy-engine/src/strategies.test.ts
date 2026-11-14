import { describe, expect, it } from "vitest";
import { SavedStrategySchema, arbitrageCheck, dcaPlan, rebalancePlan } from "./strategies";

describe("dcaPlan", () => {
  it("splits the budget evenly and works out average cost", () => {
    const r = dcaPlan({ totalBudget: 400, prices: [10, 20, 10, 20] });
    expect(r.buys.map((b) => b.spend)).toEqual([100, 100, 100, 100]);
    expect(r.totalUnits).toBeCloseTo(30, 5);
    expect(r.averageCost).toBeCloseTo(13.333333, 5);
  });
  it("compares with buying everything at the first price, on those prices only", () => {
    const up = dcaPlan({ totalBudget: 200, prices: [10, 20] });
    expect(up.differenceVsLumpSum).toBeLessThan(0); // price rose: buying early would have been better
    const down = dcaPlan({ totalBudget: 200, prices: [20, 10] });
    expect(down.differenceVsLumpSum).toBeGreaterThan(0);
  });
  it("rejects nonsense", () => {
    expect(() => dcaPlan({ totalBudget: 0, prices: [1, 2] })).toThrow();
    expect(() => dcaPlan({ totalBudget: 10, prices: [1] })).toThrow();
    expect(() => dcaPlan({ totalBudget: 10, prices: [1, -2] })).toThrow();
  });
});

describe("rebalancePlan", () => {
  const holdings = [{ asset: "qor", value: 700 }, { asset: "usd", value: 300 }];
  it("sells the overweight asset and buys the underweight one by the same amount", () => {
    const r = rebalancePlan({ holdings, targets: [{ asset: "QOR", pct: 50 }, { asset: "USD", pct: 50 }] });
    if (!r.ok) throw new Error(r.error);
    expect(r.lines.find((l) => l.asset === "QOR")).toMatchObject({ action: "sell", amount: 200 });
    expect(r.lines.find((l) => l.asset === "USD")).toMatchObject({ action: "buy", amount: 200 });
    expect(r.needsTrades).toBe(true);
  });
  it("leaves assets inside the tolerance band or below the minimum trade alone", () => {
    const a = rebalancePlan({ holdings, targets: [{ asset: "QOR", pct: 69 }, { asset: "USD", pct: 31 }], tolerancePct: 2 });
    if (!a.ok) throw new Error(a.error);
    expect(a.needsTrades).toBe(false);
    const b = rebalancePlan({ holdings, targets: [{ asset: "QOR", pct: 50 }, { asset: "USD", pct: 50 }], minTrade: 500 });
    if (!b.ok) throw new Error(b.error);
    expect(b.needsTrades).toBe(false);
  });
  it("explains bad input instead of guessing", () => {
    const bad = (i: Parameters<typeof rebalancePlan>[0]) => { const r = rebalancePlan(i); return r.ok ? "ok" : r.error; };
    expect(bad({ holdings, targets: [{ asset: "QOR", pct: 50 }, { asset: "USD", pct: 40 }] })).toMatch(/not 100/);
    expect(bad({ holdings, targets: [{ asset: "QOR", pct: 50 }, { asset: "ETH", pct: 50 }] })).toMatch(/same assets/);
    expect(bad({ holdings: [{ asset: "A", value: 1 }, { asset: "a", value: 1 }], targets: [{ asset: "A", pct: 50 }, { asset: "B", pct: 50 }] })).toMatch(/only once/);
    expect(bad({ holdings: [{ asset: "A", value: 0 }, { asset: "B", value: 0 }], targets: [{ asset: "A", pct: 50 }, { asset: "B", pct: 50 }] })).toMatch(/no value/);
  });
});

describe("arbitrageCheck", () => {
  const base = { buyPrice: 100, sellPrice: 102, size: 10, buyFeeBps: 30, sellFeeBps: 30, fixedCost: 1, slippageBps: 10 };
  it("subtracts fees, slippage and fixed costs from the gross spread", () => {
    const r = arbitrageCheck(base);
    expect(r.grossProfit).toBe(20);
    expect(r.fees).toBeCloseTo(6.06, 5);
    expect(r.slippage).toBeCloseTo(2.02, 5);
    expect(r.netProfit).toBeCloseTo(20 - 6.06 - 2.02 - 1, 5);
    expect(r.verdict).toBe("PROFITABLE_AFTER_COSTS");
  });
  it("says not profitable when costs eat the spread, and says so", () => {
    const r = arbitrageCheck({ ...base, buyFeeBps: 100, sellFeeBps: 100 });
    expect(r.verdict).toBe("NOT_PROFITABLE");
    expect(r.notes.join(" ")).toMatch(/costs consume/);
  });
  it("warns about an implausibly large spread", () => {
    expect(arbitrageCheck({ ...base, sellPrice: 150 }).notes.join(" ")).toMatch(/stale or wrong/);
  });
});

describe("SavedStrategySchema", () => {
  it("stores validated inputs only", () => {
    const ok = SavedStrategySchema.safeParse({ kind: "dca", name: "Monthly", input: { totalBudget: 100, prices: [1, 2, 3] } });
    expect(ok.success).toBe(true);
    expect(SavedStrategySchema.safeParse({ kind: "dca", name: "x", input: { totalBudget: -1, prices: [1, 2] } }).success).toBe(false);
    expect(SavedStrategySchema.safeParse({ kind: "trade_now", name: "x", input: {} }).success).toBe(false);
  });
});
