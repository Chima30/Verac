import type { BalancePoint } from "./vault";

export interface FlowBucket { key: string; label: string; inflow: number; outflow: number }

/**
 * Money in and out of the vault, per UTC day (or month when the span is long), from the balance history.
 * Each step in the history is one real event dated by its block timestamp, so the step size is that event's amount:
 * up is a deposit, down is a payment or escrow funding. The first point (the reconstructed start) and the final
 * "now" anchor carry no event and add nothing.
 */
export function flowsFrom(points: BalancePoint[]): FlowBucket[] {
  if (points.length < 2) return [];
  const span = points[points.length - 1]!.date - points[0]!.date;
  const monthly = span > 120 * 86_400_000;
  const keyOf = (d: number) => new Date(d).toISOString().slice(0, monthly ? 7 : 10);
  const label = (k: string) => new Date(`${k}${monthly ? "-01" : ""}T00:00:00Z`).toLocaleDateString("en-GB", monthly ? { month: "short", year: "2-digit", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" });
  const out = new Map<string, FlowBucket>();
  for (let i = 1; i < points.length; i++) {
    const d = points[i]!.value - points[i - 1]!.value;
    if (Math.abs(d) < 1e-12) continue;
    const k = keyOf(points[i]!.date);
    const b = out.get(k) ?? { key: k, label: label(k), inflow: 0, outflow: 0 };
    if (d > 0) b.inflow += d; else b.outflow += -d;
    out.set(k, b);
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export interface DueBucket { key: string; label: string; outstanding: number; paid: number }

/** Receivables grouped by due month: what was settled and what is still owed. Void records are left out. */
export function receivablesByMonth(rows: Array<{ due_date: string | null; amount: string | number; status: string }>, toQor: (wei: string) => number): DueBucket[] {
  const out = new Map<string, DueBucket>();
  for (const r of rows) {
    if (!r.due_date || r.status === "void") continue;
    const k = r.due_date.slice(0, 7);
    const b = out.get(k) ?? { key: k, label: new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }), outstanding: 0, paid: 0 };
    const v = toQor(String(r.amount).split(".")[0]!);
    if (r.status === "paid") b.paid += v; else b.outstanding += v;
    out.set(k, b);
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}
