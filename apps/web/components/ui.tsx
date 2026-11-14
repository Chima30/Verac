import type { ReactNode } from "react";

export type Tone = "live" | "sim" | "pending" | "approval" | "failed" | "unavailable" | "neutral";
const TONES: Record<Tone, string> = {
  live: "bg-[var(--live-bg)] text-[var(--live)]",
  sim: "bg-[var(--sim-bg)] text-[var(--sim)]",
  pending: "bg-[var(--neutral-bg)] text-[var(--muted)]",
  approval: "bg-[var(--warn-bg)] text-[var(--warn)]",
  failed: "bg-[var(--bad-bg)] text-[var(--bad)]",
  unavailable: "bg-[var(--neutral-bg)] text-[var(--muted)]",
  neutral: "bg-[var(--neutral-bg)] text-[var(--text)]",
};
const LABELS: Record<Tone, string> = { live: "LIVE TESTNET", sim: "SIMULATION", pending: "PENDING", approval: "REQUIRES APPROVAL", failed: "FAILED", unavailable: "UNAVAILABLE", neutral: "" };

export function Badge({ tone, children }: { tone: Tone; children?: ReactNode }) {
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide ${TONES[tone]}`}>{children ?? LABELS[tone]}</span>;
}

export function PageHeader({ title, description, badge }: { title: string; description: string; badge?: ReactNode }) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{badge}</div>
      <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>
    </header>
  );
}

export function Card({ title, children, right, className = "" }: { title?: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${className}`}>
      {title && <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2>{right}</div>}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, badge }: { label: string; value: ReactNode; sub?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted">{label}</span>{badge}</div>
      <div className="mt-1 break-words font-mono text-xl tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <div className="mx-auto mt-2 max-w-xl text-sm text-muted">{children}</div>
    </div>
  );
}

export function KV({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(6rem,11rem)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words font-mono text-[13px]">{v}</dd></div>))}
    </dl>
  );
}

export const inputCls = "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent";
export const btnCls = "inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50";
