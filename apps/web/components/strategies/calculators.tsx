"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { arbitrageCheck, dcaPlan, rebalancePlan } from "@qoreops/policy-engine";
import { saveStrategy } from "@/app/(app)/strategies/actions";
import { Badge, btnCls, inputCls } from "@/components/ui";

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });

function SaveBar({ kind, input, canSave }: { kind: "dca" | "rebalance" | "arbitrage"; input: unknown; canSave: boolean }) {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  if (!canSave) return null;
  async function save() {
    setMsg(null);
    const r = await saveStrategy({ kind, name, input });
    if (r.error) setMsg(r.error); else { setMsg("Saved as a paused SIMULATION."); setName(""); router.refresh(); }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input className={`${inputCls} max-w-xs`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Name to save these inputs" />
      <button className="rounded-md border border-line px-3 py-2 text-sm" onClick={save}>Save inputs</button>
      {msg && <span role="status" className="text-sm text-text-2">{msg}</span>}
    </div>
  );
}
const Sim = () => <Badge tone="sim" />;

export function DcaCalc({ canSave }: { canSave: boolean }) {
  const [budget, setBudget] = useState("1000");
  const [prices, setPrices] = useState("10, 12, 9, 11, 14");
  const list = prices.split(/[\s,;]+/).filter(Boolean).map(Number);
  let out: ReturnType<typeof dcaPlan> | null = null; let err: string | null = null;
  try { out = dcaPlan({ totalBudget: num(budget), prices: list }); } catch { err = "Enter a budget above 0 and at least two prices above 0."; }
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2"><Sim /><span className="text-text-2">Uses the prices you type. No market data.</span></div>
      <div className="flex flex-wrap gap-2">
        <input className={`${inputCls} w-40`} value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="Total budget" aria-label="Total budget" />
        <input className={`${inputCls} min-w-[16rem] flex-1`} value={prices} onChange={(e) => setPrices(e.target.value)} placeholder="Hypothetical price at each buy, separated by commas" aria-label="Prices" />
      </div>
      {err ? <p className="text-text-2">{err}</p> : out && (
        <>
          <ul className="list-disc pl-5">
            <li>{out.buys.length} equal buys of {fmt(out.buys[0]!.spend)} each, {fmt(out.totalUnits)} units in total, average cost {fmt(out.averageCost)}.</li>
            <li>Value at the last price: {fmt(out.valueAtLastPrice)}. Buying everything at the first price instead: {fmt(out.lumpSumValueAtLastPrice)} ({out.differenceVsLumpSum >= 0 ? "spreading was ahead by" : "spreading was behind by"} {fmt(Math.abs(out.differenceVsLumpSum))}).</li>
          </ul>
          <p className="text-xs text-text-2">This shows what would have happened on these exact prices. It does not predict anything, and nothing is bought.</p>
        </>
      )}
      <SaveBar kind="dca" input={{ totalBudget: num(budget), prices: list }} canSave={canSave && !err} />
    </div>
  );
}

export function RebalanceCalc({ canSave }: { canSave: boolean }) {
  const [rows, setRows] = useState("QOR 700 50\nUSD 300 50");
  const [tol, setTol] = useState("2");
  const [min, setMin] = useState("0");
  const parsed = rows.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s+/));
  const input = {
    holdings: parsed.map((p) => ({ asset: p[0] ?? "", value: Number(p[1]) })),
    targets: parsed.map((p) => ({ asset: p[0] ?? "", pct: Number(p[2]) })),
    tolerancePct: num(tol), minTrade: num(min),
  };
  const res = rebalancePlan(input);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2"><Sim /><span className="text-text-2">One line per asset: name, current value, target percent.</span></div>
      <textarea className={`${inputCls} font-mono text-xs`} rows={4} value={rows} onChange={(e) => setRows(e.target.value)} aria-label="Holdings and targets" />
      <div className="flex flex-wrap gap-2">
        <label className="text-xs text-text-2">Tolerance (points)<input className={`${inputCls} ml-2 w-20`} value={tol} onChange={(e) => setTol(e.target.value)} inputMode="decimal" /></label>
        <label className="text-xs text-text-2">Minimum trade<input className={`${inputCls} ml-2 w-24`} value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" /></label>
      </div>
      {!res.ok ? <p className="text-text-2">{res.error}</p> : (
        <>
          <table className="w-full text-left"><thead className="text-xs text-text-2"><tr><th>Asset</th><th>Now</th><th>Target</th><th>Drift</th><th>Would do</th></tr></thead>
            <tbody>{res.lines.map((l) => <tr key={l.asset} className="border-t border-line"><td>{l.asset}</td><td>{fmt(l.currentPct)}%</td><td>{fmt(l.targetPct)}%</td><td>{fmt(l.driftPct)}</td><td>{l.action === "hold" ? `hold (${l.reason})` : `${l.action} ${fmt(l.amount)}`}</td></tr>)}</tbody></table>
          <p className="text-xs text-text-2">Portfolio value {fmt(res.total)}. This is a proposal only. Nothing is traded.</p>
        </>
      )}
      <SaveBar kind="rebalance" input={input} canSave={canSave && res.ok} />
    </div>
  );
}

export function ArbitrageCalc({ canSave }: { canSave: boolean }) {
  const [v, setV] = useState({ buyPrice: "100", sellPrice: "102", size: "10", buyFeeBps: "30", sellFeeBps: "30", fixedCost: "1", slippageBps: "10" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const input = { buyPrice: num(v.buyPrice), sellPrice: num(v.sellPrice), size: num(v.size), buyFeeBps: num(v.buyFeeBps), sellFeeBps: num(v.sellFeeBps), fixedCost: num(v.fixedCost), slippageBps: num(v.slippageBps) };
  let out: ReturnType<typeof arbitrageCheck> | null = null; let err: string | null = null;
  try { out = arbitrageCheck(input); } catch { err = "Fill every field with a number (prices and size above 0, costs 0 or more)."; }
  const F = ({ k, label }: { k: keyof typeof v; label: string }) => <label className="text-xs text-text-2">{label}<input className={`${inputCls} mt-1`} value={v[k]} onChange={set(k)} inputMode="decimal" /></label>;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2"><Sim /><span className="text-text-2">Prices are typed in by you. They are not live quotes.</span></div>
      <div className="grid gap-2 sm:grid-cols-4">
        <F k="buyPrice" label="Buy price" /><F k="sellPrice" label="Sell price" /><F k="size" label="Size (units)" /><F k="fixedCost" label="Fixed cost (network)" />
        <F k="buyFeeBps" label="Buy fee (bps)" /><F k="sellFeeBps" label="Sell fee (bps)" /><F k="slippageBps" label="Slippage (bps)" />
      </div>
      {err ? <p className="text-text-2">{err}</p> : out && (
        <>
          <p><Badge tone={out.verdict === "PROFITABLE_AFTER_COSTS" ? "live" : "failed"}>{out.verdict === "PROFITABLE_AFTER_COSTS" ? "PROFITABLE AFTER COSTS (ON THESE INPUTS)" : "NOT PROFITABLE"}</Badge></p>
          <ul className="list-disc pl-5">
            <li>Gross {fmt(out.grossProfit)} (spread {fmt(out.spreadPct)}%), fees {fmt(out.fees)}, slippage {fmt(out.slippage)}, fixed cost {fmt(out.fixedCost)}.</li>
            <li>Net {fmt(out.netProfit)} ({fmt(out.netReturnPct)}% of the buy cost).</li>
          </ul>
          {out.notes.map((n) => <p key={n} className="text-xs text-text-2">{n}</p>)}
        </>
      )}
      <SaveBar kind="arbitrage" input={input} canSave={canSave && !err} />
    </div>
  );
}
