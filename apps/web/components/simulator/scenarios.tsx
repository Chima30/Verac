"use client";
import { ExternalLink, FlaskConical, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge, Steps, type StepState } from "@/components/ui";
import { CopyButton } from "@/components/ui-client";

export interface Scenario {
  id: string; title: string; summary: string;
  /** Present only when a real transaction on Diana testnet shows this defence working. */
  evidence: { hash: string; reason: string; block: string | null; url: string } | null;
  steps: Array<{ label: string; detail: string; state: StepState }>;
  next: string;
}

export function Scenarios({ items }: { items: Scenario[] }) {
  const [sel, setSel] = useState(items[0]!.id);
  const s = items.find((x) => x.id === sel)!;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div role="tablist" aria-label="Attack scenarios" aria-orientation="vertical" className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
        onKeyDown={(e) => {
          const i = items.findIndex((x) => x.id === sel);
          const n = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : null;
          if (n === null) return; e.preventDefault();
          const next = items[(n + items.length) % items.length]!; setSel(next.id);
          (e.currentTarget.querySelector(`[data-id="${next.id}"]`) as HTMLElement | null)?.focus();
        }}>
        {items.map((x) => {
          const on = x.id === sel;
          return (
            <button key={x.id} data-id={x.id} type="button" role="tab" aria-selected={on} aria-controls="scenario-panel" tabIndex={on ? 0 : -1} onClick={() => setSel(x.id)}
              className={`flex min-w-[13rem] shrink-0 items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left lg:min-w-0 ${on ? "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-accent-soft" : "border-line bg-surface hover:border-line-strong"}`}>
              <span aria-hidden className={`mt-0.5 shrink-0 ${x.evidence ? "text-[var(--live)]" : "text-[var(--sim)]"}`}>{x.evidence ? <ShieldCheck size={15} /> : <FlaskConical size={15} />}</span>
              <span className="min-w-0"><span className={`block text-[13px] ${on ? "font-semibold text-ink" : "font-medium"}`}>{x.title}</span>
                <span className="block text-[11.5px] text-muted">{x.evidence ? "Refused on chain, with proof" : "Walkthrough, not executed"}</span></span>
            </button>
          );
        })}
      </div>

      <section id="scenario-panel" role="tabpanel" aria-label={s.title} className="min-w-0 rounded-lg border border-line bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="text-[17px] font-semibold tracking-tight">{s.title}</h3><p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-muted">{s.summary}</p></div>
          {s.evidence ? <Badge tone="live">REFUSED ON-CHAIN</Badge> : <Badge tone="sim">SCENARIO WALKTHROUGH</Badge>}
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
          <Steps steps={s.steps} />
          <div className="space-y-4">
            {s.evidence ? (
              <div className="rounded-lg border border-[color-mix(in_srgb,var(--live)_30%,transparent)] bg-[var(--live-bg)] p-4">
                <p className="text-[12.5px] font-medium text-[var(--live)]">Evidence on Diana testnet</p>
                <p className="mt-2 font-mono text-[12.5px]">{s.evidence.reason}</p>
                <p className="mt-2 flex items-center gap-1"><span className="break-all font-mono text-[11.5px] text-muted">{s.evidence.hash.slice(0, 18)}…</span><CopyButton value={s.evidence.hash} label="Copy transaction hash" /></p>
                {s.evidence.block && <p className="text-[12px] text-muted">block {Number(s.evidence.block).toLocaleString("en-US")}</p>}
                <a href={s.evidence.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent-text hover:underline">Open in explorer<ExternalLink size={12} aria-hidden /></a>
              </div>
            ) : (
              <div className="rounded-lg border border-[color-mix(in_srgb,var(--sim)_30%,transparent)] bg-[var(--sim-bg)] p-4">
                <p className="text-[12.5px] font-medium text-[var(--sim)]">Not demonstrated</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">These steps follow the chain&apos;s and the contracts&apos; documented rules. No attack has been staged, so nothing here claims the defence was observed.</p>
              </div>
            )}
            <div className="rounded-lg border border-line p-4"><p className="text-[12.5px] font-medium">What to do if it happens</p><p className="mt-1 text-[12.5px] leading-relaxed text-muted">{s.next}</p></div>
          </div>
        </div>
      </section>
    </div>
  );
}
