"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { arbitrageCheck, dcaPlan, rebalancePlan } from "@qoreops/policy-engine";
import { saveStrategy } from "@/app/(app)/strategies/actions";
import { Badge, Notice, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });
const fmt2 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

function SaveBar({ kind, input, canSave }: { kind: "dca" | "rebalance" | "arbitrage"; input: unknown; canSave: boolean }) {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  if (!canSave) return null;
  async function save() {
    setMsg(null);
    const r = await saveStrategy({ kind, name, input });
    if (r.error) setMsg({ ok: false, text: r.error }); else { setMsg({ ok: true, text: "Saved as a paused simulation. It never runs." }); setName(""); router.refresh(); }
  }
  return (
    <div className="mt-4 border-t border-line pt-4">
      <label htmlFor={`save-${kind}`} className={labelCls}>Save these inputs</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={`save-${kind}`} className={`${inputCls} max-w-xs`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <button type="button" className={btnSecondaryCls} onClick={save}>Save</button>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-[13px] ${msg.ok ? "text-muted" : "text-[var(--bad)]"}`}>{msg.text}</p>}
    </div>
  );
}
const Sim = ({ text }: { text: string }) => <div className="mb-4 flex flex-wrap items-center gap-2"><Badge tone="sim" /><span className="text-[12.5px] text-muted">{text}</span></div>;
const Figure = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "live" | "bad" }) => (
  <div className="min-w-0 rounded-md bg-surface-2/60 px-3 py-2.5">
    <p className="text-[12px] text-muted">{label}</p>
    <p className={`mt-0.5 text-[16px] font-semibold tabular-nums ${tone === "live" ? "text-[var(--live)]" : tone === "bad" ? "text-[var(--bad)]" : ""}`}>{value}</p>
    {sub && <p className="text-[11.5px] text-muted">{sub}</p>}
  </div>
);

export function DcaCalc({ canSave }: { canSave: boolean }) {
  const [budget, setBudget] = useState("1000");
  const [prices, setPrices] = useState("10, 12, 9, 11, 14");
  const list = prices.split(/[\s,;]+/).filter(Boolean).map(Number);
  let out: ReturnType<typeof dcaPlan> | null = null; let err: string | null = null;
  try { out = dcaPlan({ totalBudget: num(budget), prices: list }); } catch { err = "Enter a budget above 0 and at least two prices above 0."; }
  const max = out ? Math.max(...list, out.averageCost) : 1;
  return (
    <div className="text-[13.5px]">
      <Sim text="Uses the prices you type. No market data, nothing is bought." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
        <div><label htmlFor="dca-b" className={labelCls}>Total budget</label><input id="dca-b" className={inputCls} value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" /></div>
        <div><label htmlFor="dca-p" className={labelCls}>Price at each buy, comma separated</label><input id="dca-p" className={inputCls} value={prices} onChange={(e) => setPrices(e.target.value)} /></div>
      </div>
      {err ? <Notice tone="neutral" className="mt-4">{err}</Notice> : out && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 2xl:grid-cols-4">
            <Figure label="Buys" value={`${out.buys.length} × ${fmt2(out.buys[0]!.spend)}`} />
            <Figure label="Average cost" value={out.averageCost.toLocaleString(undefined, { maximumFractionDigits: 4 })} />
            <Figure label="Value at last price" value={fmt2(out.valueAtLastPrice)} />
            <Figure label="vs buying all at once" value={`${out.differenceVsLumpSum >= 0 ? "+" : "−"}${fmt2(Math.abs(out.differenceVsLumpSum))}`} sub={out.differenceVsLumpSum >= 0 ? "spreading was ahead" : "spreading was behind"} />
          </div>
          <figure>
            <div className="relative mt-6 flex h-32 items-end gap-1.5 border-b border-line" role="img" aria-label={`Buy prices ${list.join(", ")}; average cost ${fmt(out.averageCost)}`}>
              {list.map((p, i) => (
                <div key={i} className="flex h-full flex-1 flex-col justify-end">
                  <div className="rounded-t-[3px] bg-[var(--chart-1)]/80" style={{ height: `${(p / max) * 100}%` }} title={`Buy ${i + 1}: ${p}`} />
                </div>
              ))}
              <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--warn)]" style={{ bottom: `${(out.averageCost / max) * 100}%` }}><span className="absolute -top-[18px] left-0 rounded bg-surface px-1 text-[11px] text-[var(--warn)]">average cost {fmt2(out.averageCost)}</span></div>
            </div>
            <figcaption className="mt-1.5 text-[12px] text-muted">Price at each buy, with the average cost you would have paid.</figcaption>
          </figure>
          <p className="text-[12.5px] text-muted">{fmt(out.totalUnits)} units in total. This shows what would have happened on these exact prices. It predicts nothing.</p>
        </div>
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
    <div className="text-[13.5px]">
      <Sim text="A proposal on numbers you type. Nothing is traded." />
      <label htmlFor="rb-rows" className={labelCls}>One line per asset: name, current value, target percent</label>
      <textarea id="rb-rows" className={`${inputCls} font-mono text-[12.5px]`} rows={4} value={rows} onChange={(e) => setRows(e.target.value)} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div><label htmlFor="rb-t" className={labelCls}>Tolerance (points)</label><input id="rb-t" className={inputCls} value={tol} onChange={(e) => setTol(e.target.value)} inputMode="decimal" /></div>
        <div><label htmlFor="rb-m" className={labelCls}>Minimum trade</label><input id="rb-m" className={inputCls} value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" /></div>
      </div>
      {!res.ok ? <Notice tone="neutral" className="mt-4">{res.error}</Notice> : (
        <div className="mt-5 space-y-4">
          <ul className="space-y-3" aria-label="Current against target allocation">
            {res.lines.map((l) => (
              <li key={l.asset}>
                <div className="flex items-baseline justify-between text-[12.5px]"><span className="font-medium">{l.asset}</span><span className="tabular-nums text-muted">{fmt2(l.currentPct)}% now · target {fmt2(l.targetPct)}%</span></div>
                <div className="relative mt-1 h-2.5 rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${Math.min(l.currentPct, 100)}%` }} />
                  <span aria-hidden className="absolute -top-1 h-[18px] w-0.5 rounded bg-ink" style={{ left: `calc(${Math.min(l.targetPct, 100)}% - 1px)` }} title={`target ${l.targetPct}%`} />
                </div>
              </li>
            ))}
          </ul>
          <div className="overflow-x-auto">
            <table className="data-table min-w-[26rem]">
              <thead><tr><th>Asset</th><th className="num">Drift</th><th>Would do</th></tr></thead>
              <tbody>{res.lines.map((l) => <tr key={l.asset}><td>{l.asset}</td><td className="num">{fmt2(l.driftPct)}</td><td>{l.action === "hold" ? <span className="text-muted">hold ({l.reason})</span> : <span className="font-medium">{l.action} {fmt(l.amount)}</span>}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="text-[12.5px] text-muted">Portfolio value {fmt(res.total)}. The bar is the current share; the mark is the target.</p>
        </div>
      )}
      <SaveBar kind="rebalance" input={input} canSave={canSave && res.ok} />
    </div>
  );
}

const ARB_FIELDS: Array<[keyof ArbInputs, string]> = [["buyPrice", "Buy price"], ["sellPrice", "Sell price"], ["size", "Size (units)"], ["fixedCost", "Fixed cost (network)"], ["buyFeeBps", "Buy fee (bps)"], ["sellFeeBps", "Sell fee (bps)"], ["slippageBps", "Slippage (bps)"]];
type ArbInputs = { buyPrice: string; sellPrice: string; size: string; buyFeeBps: string; sellFeeBps: string; fixedCost: string; slippageBps: string };

export function ArbitrageCalc({ canSave }: { canSave: boolean }) {
  const [v, setV] = useState<ArbInputs>({ buyPrice: "100", sellPrice: "102", size: "10", buyFeeBps: "30", sellFeeBps: "30", fixedCost: "1", slippageBps: "10" });
  const input = { buyPrice: num(v.buyPrice), sellPrice: num(v.sellPrice), size: num(v.size), buyFeeBps: num(v.buyFeeBps), sellFeeBps: num(v.sellFeeBps), fixedCost: num(v.fixedCost), slippageBps: num(v.slippageBps) };
  let out: ReturnType<typeof arbitrageCheck> | null = null; let err: string | null = null;
  try { out = arbitrageCheck(input); } catch { err = "Fill every field with a number (prices and size above 0, costs 0 or more)."; }
  const profitable = out?.verdict === "PROFITABLE_AFTER_COSTS";
  const steps = out ? [
    { label: "Gross spread", value: out.grossProfit, tone: "var(--chart-1)" },
    { label: "Fees", value: -out.fees, tone: "var(--warn)" },
    { label: "Slippage", value: -out.slippage, tone: "var(--warn)" },
    { label: "Fixed cost", value: -out.fixedCost, tone: "var(--warn)" },
  ] : [];
  const scale = out ? Math.max(Math.abs(out.grossProfit), Math.abs(out.netProfit), out.fees + out.slippage + out.fixedCost, 1e-9) : 1;
  return (
    <div className="text-[13.5px]">
      <Sim text="Prices are typed in by you. They are not live quotes, and nothing is traded." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {ARB_FIELDS.map(([k, label]) => (
          <div key={k}><label htmlFor={`arb-${k}`} className={labelCls}>{label}</label><input id={`arb-${k}`} className={inputCls} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} inputMode="decimal" /></div>
        ))}
      </div>
      {err ? <Notice tone="neutral" className="mt-4">{err}</Notice> : out && (
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <Badge tone={profitable ? "info" : "failed"}>{profitable ? "PROFITABLE AFTER COSTS, ON THESE INPUTS" : "NOT PROFITABLE AFTER COSTS"}</Badge>
            <p className={`mt-3 text-[30px] font-semibold leading-none tabular-nums ${out.netProfit >= 0 ? "" : "text-[var(--bad)]"}`}>{out.netProfit >= 0 ? "+" : "−"}{fmt2(Math.abs(out.netProfit))}</p>
            <p className="mt-1 text-[12.5px] text-muted">net, {fmt2(out.netReturnPct)}% of the buy cost · spread {fmt2(out.spreadPct)}%</p>
            {out.notes.map((n) => <p key={n} className="mt-2 text-[12.5px] text-muted">{n}</p>)}
          </div>
          <ul className="space-y-2" aria-label="From gross spread to net result">
            {[...steps, { label: "Net", value: out.netProfit, tone: out.netProfit >= 0 ? "var(--live)" : "var(--bad)" }].map((s) => (
              <li key={s.label} className="grid grid-cols-[6.5rem_1fr_5rem] items-center gap-2 text-[12.5px]">
                <span className={s.label === "Net" ? "font-medium" : "text-muted"}>{s.label}</span>
                <span className="h-2 rounded-full bg-surface-3"><span className="block h-full rounded-full" style={{ width: `${(Math.abs(s.value) / scale) * 100}%`, background: s.tone }} /></span>
                <span className="text-right tabular-nums">{s.value >= 0 ? "" : "−"}{fmt2(Math.abs(s.value))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <SaveBar kind="arbitrage" input={input} canSave={canSave && !err} />
    </div>
  );
}
