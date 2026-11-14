import { z } from "zod";

/**
 * Strategy calculators. Everything here is a SIMULATION on numbers the user types in. No market data is fetched, no venue is
 * contacted, nothing is ordered. They answer "what would happen if the prices were these", never "what will happen".
 */

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const pos = z.number().finite().positive();

// ---------------------------------------------------------------- DCA
export const DcaSchema = z.object({
  totalBudget: pos.max(1e12),
  /** Hypothetical price for each purchase, in order. One price per buy. */
  prices: z.array(pos.max(1e12)).min(2).max(120),
});
export type DcaInput = z.infer<typeof DcaSchema>;

export function dcaPlan(input: DcaInput) {
  const { totalBudget, prices } = DcaSchema.parse(input);
  const per = totalBudget / prices.length;
  const buys = prices.map((price, i) => ({ n: i + 1, price, spend: r6(per), units: r6(per / price) }));
  const units = buys.reduce((s, b) => s + per / b.price, 0);
  const lumpUnits = totalBudget / prices[0]!;
  const last = prices[prices.length - 1]!;
  return {
    buys,
    totalUnits: r6(units),
    averageCost: r6(totalBudget / units),
    lumpSumUnits: r6(lumpUnits),
    valueAtLastPrice: r6(units * last),
    lumpSumValueAtLastPrice: r6(lumpUnits * last),
    /** Positive means spreading the buys ended up ahead of buying everything at the first price, on these prices only. */
    differenceVsLumpSum: r6(units * last - lumpUnits * last),
  };
}

// ---------------------------------------------------------------- rebalancing
export const RebalanceSchema = z.object({
  holdings: z.array(z.object({ asset: z.string().trim().min(1).max(20), value: z.number().finite().min(0).max(1e12) })).min(2).max(20),
  targets: z.array(z.object({ asset: z.string().trim().min(1).max(20), pct: z.number().finite().min(0).max(100) })).min(2).max(20),
  /** An asset within this many percentage points of its target is left alone. */
  tolerancePct: z.number().finite().min(0).max(50).default(2),
  /** Trades smaller than this value are skipped. */
  minTrade: z.number().finite().min(0).max(1e12).default(0),
});
export type RebalanceInput = z.input<typeof RebalanceSchema>;
export interface RebalanceLine { asset: string; currentPct: number; targetPct: number; driftPct: number; action: "buy" | "sell" | "hold"; amount: number; reason?: string }

export function rebalancePlan(input: RebalanceInput): { ok: true; total: number; lines: RebalanceLine[]; needsTrades: boolean } | { ok: false; error: string } {
  const p = RebalanceSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid input." };
  const { holdings, targets, tolerancePct, minTrade } = p.data;
  const sum = targets.reduce((s, t) => s + t.pct, 0);
  if (Math.abs(sum - 100) > 0.01) return { ok: false, error: `Target percentages add up to ${r6(sum)}, not 100.` };
  const names = (xs: Array<{ asset: string }>) => xs.map((x) => x.asset.toUpperCase());
  const hn = names(holdings), tn = names(targets);
  if (new Set(hn).size !== hn.length || new Set(tn).size !== tn.length) return { ok: false, error: "Each asset can appear only once." };
  if (hn.length !== tn.length || hn.some((a) => !tn.includes(a))) return { ok: false, error: "Holdings and targets must list the same assets." };
  const total = holdings.reduce((s, h) => s + h.value, 0);
  if (total <= 0) return { ok: false, error: "The portfolio has no value to rebalance." };

  const lines: RebalanceLine[] = holdings.map((h) => {
    const t = targets.find((x) => x.asset.toUpperCase() === h.asset.toUpperCase())!;
    const currentPct = (h.value / total) * 100;
    const driftPct = currentPct - t.pct;
    const delta = (t.pct / 100) * total - h.value; // positive = buy
    const base = { asset: h.asset.toUpperCase(), currentPct: r6(currentPct), targetPct: t.pct, driftPct: r6(driftPct) };
    if (Math.abs(driftPct) <= tolerancePct) return { ...base, action: "hold" as const, amount: 0, reason: "within tolerance" };
    if (Math.abs(delta) < minTrade) return { ...base, action: "hold" as const, amount: 0, reason: "below the minimum trade size" };
    return { ...base, action: delta > 0 ? ("buy" as const) : ("sell" as const), amount: r6(Math.abs(delta)) };
  });
  return { ok: true, total: r6(total), lines, needsTrades: lines.some((l) => l.action !== "hold") };
}

// ---------------------------------------------------------------- arbitrage
export const ArbitrageSchema = z.object({
  buyPrice: pos.max(1e12),
  sellPrice: pos.max(1e12),
  size: pos.max(1e12),
  buyFeeBps: z.number().finite().min(0).max(10_000),
  sellFeeBps: z.number().finite().min(0).max(10_000),
  /** Fixed network cost for the whole round trip, in the quote currency. */
  fixedCost: z.number().finite().min(0).max(1e12),
  slippageBps: z.number().finite().min(0).max(10_000),
});
export type ArbitrageInput = z.infer<typeof ArbitrageSchema>;

export function arbitrageCheck(input: ArbitrageInput) {
  const a = ArbitrageSchema.parse(input);
  const buyCost = a.buyPrice * a.size;
  const sellRevenue = a.sellPrice * a.size;
  const gross = sellRevenue - buyCost;
  const fees = (buyCost * a.buyFeeBps + sellRevenue * a.sellFeeBps) / 10_000;
  const slippage = ((buyCost + sellRevenue) * a.slippageBps) / 10_000;
  const net = gross - fees - slippage - a.fixedCost;
  const spreadPct = ((a.sellPrice - a.buyPrice) / a.buyPrice) * 100;
  const notes: string[] = [];
  if (Math.abs(spreadPct) > 20) notes.push("A spread this large is more likely a stale or wrong quote than a real opportunity. Check the inputs.");
  if (gross > 0 && net <= 0) notes.push("The gross spread is positive but costs consume all of it.");
  notes.push("Prices you type in are not live quotes, and a real trade could fill at different prices or fail.");
  return {
    grossProfit: r6(gross), fees: r6(fees), slippage: r6(slippage), fixedCost: r6(a.fixedCost), netProfit: r6(net),
    netReturnPct: r6((net / buyCost) * 100), spreadPct: r6(spreadPct),
    verdict: net > 0 ? ("PROFITABLE_AFTER_COSTS" as const) : ("NOT_PROFITABLE" as const),
    notes,
  };
}

/** What may be stored for a saved strategy: the validated inputs, never results or any instruction to trade. */
export const SavedStrategySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dca"), name: z.string().trim().min(1).max(80), input: DcaSchema }),
  z.object({ kind: z.literal("rebalance"), name: z.string().trim().min(1).max(80), input: RebalanceSchema }),
  z.object({ kind: z.literal("arbitrage"), name: z.string().trim().min(1).max(80), input: ArbitrageSchema }),
]);
export type SavedStrategy = z.infer<typeof SavedStrategySchema>;
