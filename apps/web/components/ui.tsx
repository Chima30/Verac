import type { ReactNode } from "react";
import { Check, ChevronRight, Circle, CircleAlert, CircleDot, Info, OctagonX, TriangleAlert, type LucideIcon } from "lucide-react";
import { CountUp } from "./ui-client";
import { locateByLabel, type Tile } from "@/lib/nav";

/** A quiet square with the section's icon: a marker, not decoration. */
export function IconTile({ icon: Icon, tile = "slate", size = "md" }: { icon: LucideIcon; tile?: Tile; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "size-11 rounded-xl" : size === "sm" ? "size-7 rounded-md" : "size-9 rounded-lg";
  const glyph = size === "lg" ? 20 : size === "sm" ? 14 : 17;
  return <span aria-hidden className={`grid shrink-0 place-items-center border border-line text-ink ${box}`} style={{ background: `var(--tile-${tile})` }}><Icon size={glyph} strokeWidth={1.75} /></span>;
}

/* ------------------------------------------------------------------------------------------------
 * Verac design system primitives. Server-safe (no client hooks). Client pieces live in ./ui-client.
 * ---------------------------------------------------------------------------------------------- */

export type Tone = "live" | "sim" | "pending" | "approval" | "failed" | "unavailable" | "neutral" | "info";
const TONES: Record<Tone, string> = {
  live: "bg-[var(--live-bg)] text-[var(--live)]",
  sim: "bg-[var(--sim-bg)] text-[var(--sim)]",
  pending: "bg-[var(--neutral-bg)] text-[var(--muted)]",
  approval: "bg-[var(--warn-bg)] text-[var(--warn)]",
  failed: "bg-[var(--bad-bg)] text-[var(--bad)]",
  unavailable: "bg-[var(--neutral-bg)] text-[var(--muted)]",
  neutral: "bg-[var(--neutral-bg)] text-[var(--text)]",
  info: "bg-[var(--info-bg)] text-[var(--info)]",
};
// The wording of these labels is a product rule: a reader must always be able to tell live testnet from simulation.
const LABELS: Record<Tone, string> = { live: "LIVE TESTNET", sim: "SIMULATION", pending: "PENDING", approval: "REQUIRES APPROVAL", failed: "FAILED", unavailable: "UNAVAILABLE", neutral: "", info: "" };

/** Compact status label. Tone carries meaning: live, simulation, approval needed, failed, unavailable. */
export function Badge({ tone, children, className = "" }: { tone: Tone; children?: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-[4px] px-2 font-mono text-[11px] font-medium uppercase leading-none tracking-[0.007em] ${TONES[tone]} ${className}`}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-80" />
      {children ?? LABELS[tone]}
    </span>
  );
}

/** A dot with a word, for dense tables where a filled badge would be too loud. */
export function StatusDot({ tone, children }: { tone: Tone; children: ReactNode }) {
  const c: Record<Tone, string> = { live: "var(--live)", sim: "var(--sim)", pending: "var(--subtle)", approval: "var(--warn)", failed: "var(--bad)", unavailable: "var(--subtle)", neutral: "var(--muted)", info: "var(--info)" };
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]"><span aria-hidden className="size-2 rounded-full" style={{ background: c[tone] }} />{children}</span>;
}

export function PageHeader({ title, description, badge, actions, meta }: {
  title: string; description?: ReactNode; badge?: ReactNode; actions?: ReactNode; meta?: ReactNode;
  /** Accepted for compatibility; the console style shows no label above the title and no icon tile. */
  eyebrow?: ReactNode; icon?: LucideIcon; tile?: Tile;
}) {
  return (
    <header className="mb-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2"><h1 className="text-[28px] font-medium leading-[1.15] tracking-[-0.015em] sm:text-[40px] sm:tracking-[-0.02em]">{title}</h1>{badge}</div>
        {description && <p className="mt-3 max-w-3xl text-[16px] leading-[1.35] tracking-[-0.01em] text-muted sm:text-[18px]">{description}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled surface. `flush` drops the body padding for tables and lists that run edge to edge. */
export function Card({ title, description, children, right, footer, className = "", flush = false, id, icon, tile }: {
  title?: ReactNode; description?: ReactNode; children: ReactNode; right?: ReactNode; footer?: ReactNode; className?: string; flush?: boolean; id?: string; icon?: LucideIcon; tile?: Tile;
}) {
  return (
    <section id={id} className={`min-w-0 scroll-mt-24 rounded-lg border border-line bg-surface ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-5 pb-1 pt-4">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <IconTile icon={icon} tile={tile} />}
            <div className="min-w-0">
              {title && <h2 className="text-[18px] font-medium leading-snug tracking-[-0.01em]">{title}</h2>}
              {description && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p>}
            </div>
          </div>
          {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
        </div>
      )}
      <div className={flush ? "px-5 pb-2 pt-1" : title || right ? "px-5 pb-5 pt-3" : "p-5"}>{children}</div>
      {footer && <div className="border-t border-line px-5 py-3 text-[12.5px] text-muted">{footer}</div>}
    </section>
  );
}

/** Category tints: what a figure is about, the same on every page. */
export type Tint = "sky" | "peach" | "blush" | "mint";
const animated = (v: ReactNode) => (typeof v === "string" || typeof v === "number" ? <CountUp value={String(v)} /> : v);

/** A figure. With `tint` it becomes a filled tile: sky = treasury money, peach = waiting for a person, blush = grants, mint = proven on chain. */
export function Stat({ label, value, sub, badge, large = false, tone, tint }: { label: ReactNode; value: ReactNode; sub?: ReactNode; badge?: ReactNode; large?: boolean; tone?: "bad" | "warn" | "live"; tint?: Tint }) {
  const color = tone === "bad" ? "text-[var(--bad)]" : tone === "warn" ? "text-[var(--warn)]" : tone === "live" ? "text-[var(--live)]" : "";
  return (
    <div className={`min-w-0 rounded-[4px] p-5 sm:p-6 ${tint ? "text-[var(--tint-ink)]" : "border border-line bg-surface"}`} style={tint ? { background: `var(--tint-${tint})` } : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="label-mono">{label}</span>{badge}</div>
      <div className={`mt-4 break-words font-medium tabular-nums leading-[1.1] tracking-[-0.03em] ${large ? "text-[48px] sm:text-[64px]" : "text-[40px] lg:text-[48px]"} ${color}`}>{animated(value)}</div>
      {sub && <div className="mt-2 text-[14px] leading-[1.25] tracking-[-0.01em]" style={{ color: tint ? "var(--tint-sub)" : "var(--muted)" }}>{sub}</div>}
    </div>
  );
}

/** A row of figures that arrive one after another. */
export function StatRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`stagger mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] ${className}`}>{children}</div>;
}

/** A figure inside a larger panel: no border of its own. */
export function Metric({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "bad" | "warn" | "live" | "muted" }) {
  const color = tone === "bad" ? "text-[var(--bad)]" : tone === "warn" ? "text-[var(--warn)]" : tone === "live" ? "text-[var(--live)]" : tone === "muted" ? "text-muted" : "";
  return (
    <div className="min-w-0">
      <dt className="label-mono text-muted">{label}</dt>
      <dd className={`mt-1.5 text-[22px] font-medium leading-tight tracking-[-0.01em] tabular-nums ${color}`}>{animated(value)}</dd>
      {sub && <dd className="mt-1 text-[12px] leading-relaxed text-muted">{sub}</dd>}
    </div>
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-6 py-12 sm:px-10">
      {icon && <div className="mb-4 grid size-10 place-items-center rounded-md border border-line text-ink">{icon}</div>}
      <p className="text-[22px] font-medium tracking-[-0.01em]">{title}</p>
      {children && <div className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-6 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function KV({ rows, mono = true }: { rows: Array<[string, ReactNode]>; mono?: boolean }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13.5px] sm:grid-cols-[minmax(7rem,12rem)_1fr]">
      {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className={`-mt-2 min-w-0 break-words sm:mt-0 ${mono ? "font-mono text-[12.5px]" : ""}`}>{v}</dd></div>))}
    </dl>
  );
}

const NOTICE: Record<"info" | "warn" | "bad" | "live" | "sim" | "neutral", { cls: string; Icon: typeof Info }> = {
  info: { cls: "border-[color-mix(in_srgb,var(--info)_25%,transparent)] bg-[var(--info-bg)]", Icon: Info },
  warn: { cls: "border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-[var(--warn-bg)]", Icon: TriangleAlert },
  bad: { cls: "border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-bg)]", Icon: OctagonX },
  live: { cls: "border-[color-mix(in_srgb,var(--live)_25%,transparent)] bg-[var(--live-bg)]", Icon: Check },
  sim: { cls: "border-[color-mix(in_srgb,var(--sim)_25%,transparent)] bg-[var(--sim-bg)]", Icon: CircleDot },
  neutral: { cls: "border-line bg-surface-2", Icon: Info },
};
const NOTICE_INK: Record<keyof typeof NOTICE, string> = { info: "var(--info)", warn: "var(--warn)", bad: "var(--bad)", live: "var(--live)", sim: "var(--sim)", neutral: "var(--muted)" };

/** An inline message: what happened, or what a reader needs to know before acting. */
export function Notice({ tone = "neutral", title, children, className = "", role }: { tone?: keyof typeof NOTICE; title?: ReactNode; children?: ReactNode; className?: string; role?: "status" | "alert" }) {
  const { cls, Icon } = NOTICE[tone];
  return (
    <div role={role} className={`flex gap-3 rounded-lg border px-4 py-3 text-[13.5px] leading-relaxed ${cls} ${className}`}>
      <Icon size={16} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" style={{ color: NOTICE_INK[tone] }} />
      <div className="min-w-0">
        {title && <p className="font-medium text-ink">{title}</p>}
        {children && <div className={title ? "mt-0.5 text-muted" : "text-ink"}>{children}</div>}
      </div>
    </div>
  );
}

/** Messages that arrive via ?msg= / ?error= after a server action. */
export function FlashMessages({ msg, error }: { msg?: string | null; error?: string | null }) {
  if (!msg && !error) return null;
  return (
    <div className="mb-6 space-y-2">
      {msg && <Notice tone="live" role="status">{msg}</Notice>}
      {error && <Notice tone="bad" role="alert">{error}</Notice>}
    </div>
  );
}

export function SectionHeading({ title, description, right, id }: { title: ReactNode; description?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div id={id} className="mb-3 mt-10 flex scroll-mt-24 flex-wrap items-end justify-between gap-2 first:mt-0">
      <div>
        <h2 className="text-[22px] font-medium tracking-[-0.01em]">{title}</h2>
        {description && <p className="mt-0.5 max-w-3xl text-[13px] text-muted">{description}</p>}
      </div>
      {right}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/** Placeholder for a streamed card while its data loads. Keeps the layout stable. */
export function CardSkeleton({ rows = 3, className = "", label = "Loading" }: { rows?: number; className?: string; label?: string }) {
  return (
    <div className={`rounded-lg border border-line bg-surface p-5 ${className}`} role="status" aria-label={label}>
      <Skeleton className="h-4 w-40" />
      <div className="mt-5 space-y-3">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={`h-3.5 ${i % 2 ? "w-3/4" : "w-full"}`} />)}</div>
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export type StepState = "done" | "current" | "todo" | "blocked" | "failed" | "step";
/** A vertical progression: payment flow, agent workflow, setup checklist, attack scenario. */
export function Steps({ steps, compact = false }: { steps: Array<{ label: ReactNode; detail?: ReactNode; state: StepState }>; compact?: boolean }) {
  const icon = (s: StepState, i: number) => {
    if (s === "step") return <span className="grid size-5 place-items-center rounded-full bg-surface-3 text-[10.5px] font-semibold tabular-nums text-muted">{i + 1}</span>;
    if (s === "done") return <span className="grid size-5 place-items-center rounded-full bg-[var(--live)] text-[var(--surface)]"><Check size={12} strokeWidth={3} /></span>;
    if (s === "current") return <span className="grid size-5 place-items-center rounded-full border-2 border-[var(--accent)] bg-surface"><span className="size-1.5 rounded-full bg-[var(--accent)]" /></span>;
    if (s === "blocked") return <span className="grid size-5 place-items-center rounded-full bg-[var(--warn-bg)] text-[var(--warn)]"><CircleAlert size={13} strokeWidth={2.25} /></span>;
    if (s === "failed") return <span className="grid size-5 place-items-center rounded-full bg-[var(--bad-bg)] text-[var(--bad)]"><OctagonX size={12} strokeWidth={2.25} /></span>;
    return <span className="grid size-5 place-items-center text-subtle"><Circle size={16} strokeWidth={1.5} /></span>;
  };
  const word: Record<StepState, string> = { done: "done", current: "in progress", todo: "not started", blocked: "blocked", failed: "failed", step: `step ${""}` };
  return (
    <ol className="relative">
      {steps.map((s, i) => (
        <li key={i} className={`relative flex gap-3 ${compact ? "pb-3" : "pb-5"} last:pb-0`}>
          {i < steps.length - 1 && <span aria-hidden className={`absolute left-[9.5px] top-6 bottom-0 w-px ${s.state === "done" ? "bg-[var(--live)]/50" : "bg-line"}`} />}
          <span className="relative z-[1] mt-px shrink-0">{icon(s.state, i)}</span>
          <div className="min-w-0">
            <p className={`text-[13.5px] leading-snug ${s.state === "todo" ? "text-muted" : "font-medium"}`}>{s.label}{s.state !== "step" && <span className="sr-only"> ({word[s.state]})</span>}</p>
            {s.detail && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{s.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Stages of a process, left to right. With `counts` it is a pipeline summary (how many items sit in each stage);
 * with `current` it shows where one item is. Stacks into two columns on narrow screens.
 */
export function Pipeline({ stages, counts, current, label }: { stages: Array<{ key: string; label: string }>; counts?: Record<string, number>; current?: string; label: string }) {
  const at = current ? stages.findIndex((s) => s.key === current) : -1;
  return (
    <ol aria-label={label} className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-[repeat(auto-fit,minmax(7rem,1fr))]">
      {stages.map((s, i) => {
        const state = current ? (i < at ? "past" : i === at ? "now" : "next") : (counts?.[s.key] ? "now" : "next");
        return (
          <li key={s.key} aria-current={current && i === at ? "step" : undefined}
            className={`relative min-w-0 border-b border-r border-line px-4 py-4 last:border-r-0 sm:border-b-0 ${state === "now" ? "bg-[var(--tint-mint)] text-[var(--tint-ink)]" : ""} ${state === "past" ? "bg-surface-2" : ""}`}>
            {counts && <p className={`text-[28px] font-medium leading-none tabular-nums tracking-[-0.015em] ${counts[s.key] ? "" : "text-muted"}`}>{counts[s.key] ?? 0}</p>}
            <p className={`label-mono truncate ${counts ? "mt-2" : ""} ${state === "now" ? "" : "text-muted"}`} title={s.label}>
              {!counts && <span className="mr-1 tabular-nums">{i + 1}</span>}{s.label}{current && i === at && <span className="sr-only"> (current stage)</span>}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** A transaction confirmed on chain: a mono hash with a tick that draws itself, linking to the explorer. */
export function ProofStamp({ hash, href, detail }: { hash: string; href?: string; detail?: ReactNode }) {
  const short = hash.length > 18 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
  const body = (
    <>
      <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path className="stamp-tick" d="M3.5 8.5l3 3 6-7" /></svg>
      <span title={hash}>{short}</span>{detail && <span className="opacity-80">· {detail}</span>}
      <span className="sr-only"> (confirmed on chain)</span>
    </>
  );
  const cls = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[4px] bg-[var(--tint-mint)] px-2 py-0.5 font-mono text-[11px] font-medium text-[var(--tint-ink)]";
  return href ? <a href={href} target="_blank" rel="noreferrer" className={`${cls} hover:underline`}>{body}</a> : <span className={cls}>{body}</span>;
}

/** A process explained in one line that opens: keeps "how it works" text out of the way of the work. */
export function HowItWorks({ title = "How it works", children }: { title?: string; children: ReactNode }) {
  return (
    <details className="how mt-16 border-t border-line pt-4">
      <summary className="flex items-center gap-2 text-ink"><ChevronRight size={15} aria-hidden className="chevron text-subtle" /><span className="label-mono">{title}</span></summary>
      <div className="mt-4 max-w-3xl space-y-3 pl-6 text-[14px] leading-relaxed text-muted">{children}</div>
    </details>
  );
}

/** A short address or hash for tables: start…end, full value in the title. */
export function ShortHash({ value, head = 8, tail = 6, className = "" }: { value: string; head?: number; tail?: number; className?: string }) {
  const s = value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
  return <span title={value} className={`font-mono text-[12.5px] ${className}`}>{s}</span>;
}

/** Where a figure comes from. Shown under numbers so nobody has to guess. */
export function Source({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[12px] leading-relaxed text-subtle">{children}</p>;
}

export const labelCls = "mb-1.5 block text-[14px] tracking-[-0.01em] text-muted";
export const inputCls = "w-full rounded-[4px] border border-line bg-surface px-3 py-2 text-[15px] tracking-[-0.01em] transition-colors placeholder:text-subtle hover:border-line-strong focus:border-[var(--ring)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--ring)_25%,transparent)] disabled:opacity-60";
// Buttons speak in the mono voice: 13px, weight 500, uppercase, 8px by 16px, 4px corners. No colour shift on hover.
const btnBase = "inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[4px] px-4 py-2 font-mono text-[13px] font-medium uppercase leading-none tracking-[0.007em] transition-[border-color,color,opacity,transform] active:translate-y-px disabled:pointer-events-none disabled:opacity-50";
export const btnCls = `${btnBase} bg-primary text-primary-ink`;
export const btnSecondaryCls = `${btnBase} border border-line bg-transparent text-muted hover:border-ink hover:text-ink`;
export const btnGhostCls = `${btnBase} text-muted hover:text-ink`;
export const btnDangerCls = `${btnBase} border border-[color-mix(in_srgb,var(--bad)_35%,transparent)] bg-surface text-[var(--bad)] hover:bg-[var(--bad-bg)]`;
export const chipCls = (active: boolean) => `inline-flex h-8 items-center gap-1.5 rounded-[4px] border px-3 text-[13px] tracking-[-0.01em] transition-colors ${active ? "border-transparent bg-[var(--tint-mint)] font-medium text-[var(--tint-ink)]" : "border-line bg-surface text-muted hover:text-ink"}`;

export const fmtUtc = (iso: string | number | Date) => `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC`;
export function relTime(iso: string | number | Date, now = Date.now()): string {
  const d = (now - new Date(iso).getTime()) / 1000;
  const fut = d < 0; const a = Math.abs(d);
  const s = a < 60 ? "just now" : a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} d`;
  if (s === "just now") return s;
  return fut ? `in ${s}` : `${s} ago`;
}
