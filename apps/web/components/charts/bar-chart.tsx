import { Legend } from "./chart-card";

export interface BarSeries { key: string; label: string; color: string }
export interface BarDatum { key: string; label: string; values: Record<string, number> }

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Grouped bars drawn with plain elements: no chart library, no client JavaScript. Each group shows its exact values on
 * hover or focus, and a visually hidden table carries the same numbers for screen readers.
 */
export function BarChart({ data, series, unit, height = 200, caption }: { data: BarDatum[]; series: BarSeries[]; unit: string; height?: number; caption: string }) {
  const max = Math.max(1e-9, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0)));
  const ticks = [1, 0.5, 0].map((f) => max * f);
  return (
    <figure>
      <div className="flex gap-3">
        <div aria-hidden className="flex shrink-0 flex-col justify-between pb-6 text-right text-[11px] tabular-nums text-subtle" style={{ height }}>
          {ticks.map((t, i) => <span key={i}>{compact.format(t)}</span>)}
        </div>
        <div className="relative min-w-0 flex-1">
          <div aria-hidden className="absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: height - 24 }}>
            {ticks.map((_, i) => <span key={i} className="block border-t border-dashed border-white/[0.08]" />)}
          </div>
          <div className="scroll-quiet relative flex items-end gap-2 overflow-x-auto" style={{ height }}>
            {data.map((d) => (
              <div key={d.key} tabIndex={0} className="group relative flex h-full min-w-[2.75rem] flex-1 flex-col justify-end outline-none" aria-label={`${d.label}: ${series.map((s) => `${s.label} ${fmt(d.values[s.key] ?? 0)} ${unit}`).join(", ")}`}>
                <div className="flex flex-1 items-end justify-center gap-1 pb-6">
                  {series.map((s) => {
                    const v = d.values[s.key] ?? 0;
                    return <span key={s.key} className="w-full max-w-[18px] rounded-t-[4px] transition-[filter] group-hover:brightness-125 group-focus-visible:brightness-125" style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 3 : 0, background: `linear-gradient(180deg, ${s.color}, color-mix(in srgb, ${s.color} 55%, transparent))`, boxShadow: v > 0 ? `0 0 18px -6px ${s.color}` : undefined }} />;
                  })}
                </div>
                <span className="absolute inset-x-0 bottom-0 truncate text-center text-[11px] text-subtle">{d.label}</span>
                <div role="presentation" className="pointer-events-none absolute bottom-[calc(100%-1.5rem)] left-1/2 z-10 hidden w-max -translate-x-1/2 -translate-y-2 rounded-xl border border-white/10 bg-[#141416]/95 px-3 py-2 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.8)] group-hover:block group-focus-visible:block">
                  <p className="text-[11px] text-subtle">{d.label}</p>
                  {series.map((s) => <p key={s.key} className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold tabular-nums"><span className="size-1.5 rounded-full" style={{ background: s.color }} />{fmt(d.values[s.key] ?? 0)} {unit} <span className="font-normal text-subtle">{s.label.toLowerCase()}</span></p>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2"><Legend items={series.map((s) => ({ label: s.label, color: s.color }))} /><span className="text-[12px] text-subtle">{caption}</span></figcaption>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th>Period</th>{series.map((s) => <th key={s.key}>{s.label} ({unit})</th>)}</tr></thead>
        <tbody>{data.map((d) => <tr key={d.key}><td>{d.label}</td>{series.map((s) => <td key={s.key}>{fmt(d.values[s.key] ?? 0)}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  );
}
