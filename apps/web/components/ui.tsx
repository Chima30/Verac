import type { ReactNode } from "react";

export type Tone = "live" | "sim" | "pending" | "approval" | "failed" | "unavailable" | "neutral";
// Sodium reserves yellow for the one action and the selection, so status uses the ok, warn and fail roles and the well.
const TONES: Record<Tone, string> = {
  live: "bg-ok-tint text-ok-text",
  sim: "bg-selected text-text-1",
  pending: "bg-well text-text-2",
  approval: "bg-warn-tint text-warn-text",
  failed: "bg-fail-tint text-fail-text",
  unavailable: "bg-well text-text-2",
  neutral: "bg-well text-text-1",
};
// The wording of these labels is a product rule: a reader must always be able to tell live testnet from simulation.
const LABELS: Record<Tone, string> = { live: "LIVE TESTNET", sim: "SIMULATION", pending: "PENDING", approval: "REQUIRES APPROVAL", failed: "FAILED", unavailable: "UNAVAILABLE", neutral: "" };

/** Status label: a small square tick in the tone's colour, then the word in a label role. */
export function Badge({ tone, children }: { tone: Tone; children?: ReactNode }) {
  return (
    <span className={`type-micro inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-1 ${TONES[tone]}`}>
      <span aria-hidden className="size-1.5 shrink-0 bg-current" />
      {children ?? LABELS[tone]}
    </span>
  );
}

export function PageHeader({ title, description, badge }: { title: string; description: string; badge?: ReactNode }) {
  return (
    <header className="mb-8">
      <div className="flex flex-wrap items-center gap-3"><h1 className="type-title">{title}</h1>{badge}</div>
      <p className="type-body-sm mt-2 max-w-3xl text-text-2">{description}</p>
    </header>
  );
}

export function Card({ title, children, right, className = "" }: { title?: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`frame ${className}`}>
      {title && <div className="panel-head justify-between"><h2 className="type-code">{title}</h2>{right}</div>}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, badge, large = false }: { label: string; value: ReactNode; sub?: ReactNode; badge?: ReactNode; large?: boolean }) {
  return (
    <div className="frame p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2"><span className="type-micro text-text-2">{label}</span>{badge}</div>
      <div className={`mt-2 break-words tabular-nums ${large ? "type-display" : "type-figure"}`}>{value}</div>
      {sub && <div className="type-caption mt-2 text-text-2">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="frame border-dashed px-6 py-12 text-center">
      <p className="type-heading-sm">{title}</p>
      <div className="type-body-sm mx-auto mt-2 max-w-xl text-text-2">{children}</div>
    </div>
  );
}

export function KV({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(6rem,11rem)_1fr] gap-x-4 gap-y-3 text-sm">
      {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="type-micro text-text-2">{k}</dt><dd className="type-code min-w-0 break-words">{v}</dd></div>))}
    </dl>
  );
}

export const inputCls = "field-surface w-full px-3 py-2 text-sm";
export const btnCls = "slab type-label inline-flex h-8 items-center justify-center gap-2 px-4";
