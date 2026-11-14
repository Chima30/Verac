import { z } from "zod";
import { INJECTION } from "./invoice";

/**
 * Deterministic bid checks and scoring. Fixed rules decide who is eligible and compute price/delivery scores.
 * An AI model may add an advisory "fit" score and notes, but can never make a bid eligible or ineligible.
 * A human always chooses the award.
 */

export const BidSchema = z.object({
  vendorName: z.string().trim().max(120).optional(),
  amountQor: z.number().finite(),
  deliveryDays: z.number().int().min(1).max(3650),
  approach: z.string().trim().min(1).max(4000),
  references: z.string().trim().max(1000).optional(),
});
export type Bid = z.infer<typeof BidSchema>;

export type BidFlagCode = "OVER_BUDGET" | "INSTRUCTION_IN_BID" | "UNREADABLE" | "LOWBALL" | "THIN_APPROACH";
export interface BidFlag { code: BidFlagCode; blocking: boolean; message: string }
export interface BidResult {
  ref: string;
  eligible: boolean;
  flags: BidFlag[];
  amountQor?: number;
  deliveryDays?: number;
  priceScore?: number;
  deliveryScore?: number;
  /** Price and delivery only, 0 to 10. */
  baseScore?: number;
}

/** Weights stated in the open so a reviewer can see exactly how a ranking arises. */
export const WEIGHTS = { withoutAi: { price: 0.6, delivery: 0.4 }, withAi: { price: 0.35, delivery: 0.15, fit: 0.5 } } as const;

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const round = (n: number) => Math.round(n * 100) / 100;

/** `raw` is the decrypted bid text. Anything that is not a valid bid becomes an ineligible UNREADABLE entry. */
export function checkBids(budgetQor: number, raw: Array<{ ref: string; text: string }>): BidResult[] {
  const parsed = raw.map((r) => {
    let json: unknown;
    try { json = JSON.parse(r.text); } catch { json = undefined; }
    const p = BidSchema.safeParse(json);
    return { ref: r.ref, text: r.text, bid: p.success ? p.data : undefined, issue: p.success ? undefined : "The bid is not in the expected format (amount, delivery days, approach)." };
  });

  const out: BidResult[] = parsed.map((x) => {
    const flags: BidFlag[] = [];
    if (!x.bid) { flags.push({ code: "UNREADABLE", blocking: true, message: x.issue! }); return { ref: x.ref, eligible: false, flags }; }
    const b = x.bid;
    if (!(b.amountQor > 0)) flags.push({ code: "UNREADABLE", blocking: true, message: "The quoted amount must be above zero." });
    else if (b.amountQor > budgetQor) flags.push({ code: "OVER_BUDGET", blocking: true, message: `Quoted ${b.amountQor} QOR, above the ${budgetQor} QOR budget.` });
    if (INJECTION.test(`${b.approach}\n${b.references ?? ""}\n${b.vendorName ?? ""}`))
      flags.push({ code: "INSTRUCTION_IN_BID", blocking: true, message: "The bid contains instructions aimed at an automated reviewer (for example to ignore rules or rank it first). It is held out of the ranking for a human to look at." });
    if (b.approach.length < 80) flags.push({ code: "THIN_APPROACH", blocking: false, message: "The described approach is very short." });
    return { ref: x.ref, eligible: !flags.some((f) => f.blocking), flags, amountQor: b.amountQor, deliveryDays: b.deliveryDays };
  });

  // Lowball check against the other readable bids.
  const amounts = out.filter((o) => o.amountQor && o.amountQor > 0).map((o) => o.amountQor!);
  if (amounts.length >= 3) {
    const med = median(amounts);
    for (const o of out) if (o.amountQor && o.amountQor > 0 && o.amountQor < med * 0.5)
      o.flags.push({ code: "LOWBALL", blocking: false, message: `Less than half of the median quote (${round(med)} QOR). Check the scope is really covered.` });
  }

  const ok = out.filter((o) => o.eligible);
  if (ok.length) {
    const minP = Math.min(...ok.map((o) => o.amountQor!));
    const minD = Math.min(...ok.map((o) => o.deliveryDays!));
    for (const o of ok) {
      o.priceScore = round(10 * minP / o.amountQor!);
      o.deliveryScore = round(10 * minD / o.deliveryDays!);
      o.baseScore = round(WEIGHTS.withoutAi.price * o.priceScore + WEIGHTS.withoutAi.delivery * o.deliveryScore);
    }
  }
  return out;
}

/** AI-provided fit scores. It has no field that could include or exclude a bid. */
export const BidEvaluationSchema = z.object({
  summary: z.string().max(500),
  evaluations: z.array(z.object({
    ref: z.string().min(1).max(20),
    fit: z.number().int().min(0).max(10),
    strengths: z.array(z.string().max(200)).max(3),
    concerns: z.array(z.string().max(200)).max(3),
  }).strict()).max(20),
}).strict();
export type BidEvaluation = z.infer<typeof BidEvaluationSchema>;

export interface RankedBid extends BidResult { fit?: number; total?: number; rank?: number }

/** Combines the deterministic scores with advisory AI fit. Ineligible bids are never ranked. */
export function rankBids(results: BidResult[], ai?: BidEvaluation): RankedBid[] {
  const fits = new Map((ai?.evaluations ?? []).map((e) => [e.ref, e.fit]));
  const ranked: RankedBid[] = results.map((r) => {
    if (!r.eligible || r.priceScore === undefined) return { ...r };
    const fit = fits.get(r.ref);
    const total = fit === undefined ? r.baseScore! : round(WEIGHTS.withAi.price * r.priceScore + WEIGHTS.withAi.delivery * r.deliveryScore! + WEIGHTS.withAi.fit * fit);
    return { ...r, ...(fit === undefined ? {} : { fit }), total };
  });
  ranked.filter((r) => r.total !== undefined).sort((a, b) => b.total! - a.total!).forEach((r, i) => { r.rank = i + 1; });
  return ranked;
}
