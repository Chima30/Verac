import type { ReactNode } from "react";
import { Check, Circle, CircleAlert, CircleDot, Info, OctagonX, TriangleAlert } from "lucide-react";

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
    <span className={`inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[10.5px] font-medium leading-none tracking-[0.03em] ${TONES[tone]} ${className}`}>
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

export function PageHeader({ title, description, badge, actions, eyebrow, meta }: {
  title: string; description?: ReactNode; badge?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; meta?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-[12.5px] text-muted">{eyebrow}</div>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2"><h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[28px]">{title}</h1>{badge}</div>
        {description && <p className="mt-2 max-w-3xl text-[14.5px] leading-relaxed text-muted">{description}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled surface. `flush` drops the body padding for tables and lists that run edge to edge. */
export function Card({ title, description, children, right, footer, className = "", flush = false, id }: {
  title?: ReactNode; description?: ReactNode; children: ReactNode; right?: ReactNode; footer?: ReactNode; className?: string; flush?: boolean; id?: string;
}) {
  return (
    <section id={id} className={`min-w-0 scroll-mt-24 rounded-lg border border-line bg-surface shadow-card ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-5 pb-1 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-[14px] font-semibold leading-snug">{title}</h2>}
            {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{description}</p>}
          </div>
          {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
        </div>
      )}
      <div className={flush ? "px-5 pb-2 pt-1" : title || right ? "px-5 pb-5 pt-3" : "p-5"}>{children}</div>
      {footer && <div className="border-t border-line px-5 py-3 text-[12.5px] text-muted">{footer}</div>}
    </section>
  );
}

export function Stat({ label, value, sub, badge, large = false, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; badge?: ReactNode; large?: boolean; tone?: "bad" | "warn" | "live" }) {
  const color = tone === "bad" ? "text-[var(--bad)]" : tone === "warn" ? "text-[var(--warn)]" : tone === "live" ? "text-[var(--live)]" : "";
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[12.5px] text-muted">{label}</span>{badge}</div>
      <div className={`mt-2 break-words font-semibold tabular-nums tracking-tight ${large ? "text-[34px] leading-none sm:text-[40px]" : "text-[22px] leading-tight"} ${color}`}>{value}</div>
      {sub && <div className="mt-2 text-[12.5px] leading-relaxed text-muted">{sub}</div>}
    </div>
  );
}

/** A figure inside a larger panel: no border of its own. */
export function Metric({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "bad" | "warn" | "live" | "muted" }) {
  const color = tone === "bad" ? "text-[var(--bad)]" : tone === "warn" ? "text-[var(--warn)]" : tone === "live" ? "text-[var(--live)]" : tone === "muted" ? "text-muted" : "";
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className={`mt-1 text-[20px] font-semibold leading-tight tracking-tight tabular-nums ${color}`}>{value}</dd>
      {sub && <dd className="mt-1 text-[12px] leading-relaxed text-muted">{sub}</dd>}
    </div>
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
      {icon && <div className="mx-auto mb-3 grid size-10 place-items-center rounded-lg bg-surface-2 text-muted">{icon}</div>}
      <p className="text-[14px] font-medium">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
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
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
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
    <div className={`rounded-lg border border-line bg-surface p-5 shadow-card ${className}`} role="status" aria-label={label}>
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
    <ol aria-label={label} className="grid grid-cols-2 gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(7rem,1fr))]">
      {stages.map((s, i) => {
        const state = current ? (i < at ? "past" : i === at ? "now" : "next") : (counts?.[s.key] ? "now" : "next");
        return (
          <li key={s.key} aria-current={current && i === at ? "step" : undefined}
            className={`relative min-w-0 rounded-md border px-3 py-2.5 ${state === "now" ? "border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-accent-soft" : state === "past" ? "border-line bg-surface-2" : "border-line bg-surface"}`}>
            {counts && <p className={`text-[20px] font-semibold leading-none tabular-nums ${counts[s.key] ? "" : "text-subtle"}`}>{counts[s.key] ?? 0}</p>}
            <p className={`truncate text-[12px] ${counts ? "mt-1.5" : ""} ${state === "now" ? "font-medium text-accent-text" : state === "past" ? "text-muted" : "text-subtle"}`} title={s.label}>
              {!counts && <span className="mr-1 tabular-nums">{i + 1}.</span>}{s.label}{current && i === at && <span className="sr-only"> (current stage)</span>}
            </p>
          </li>
        );
      })}
    </ol>
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

export const labelCls = "mb-1.5 block text-[12.5px] font-medium text-muted";
export const inputCls = "w-full rounded-md border border-line bg-surface px-3 py-2 text-[14px] shadow-[inset_0_1px_0_rgb(0_0_0/0.02)] transition-colors placeholder:text-subtle hover:border-line-strong focus:border-[var(--ring)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--ring)_25%,transparent)] disabled:opacity-60";
const btnBase = "inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3.5 text-[13.5px] font-medium transition-[background-color,border-color,color,opacity,transform] active:translate-y-px disabled:pointer-events-none disabled:opacity-50";
export const btnCls = `${btnBase} bg-accent text-accent-ink shadow-sm hover:bg-accent-hover`;
export const btnSecondaryCls = `${btnBase} border border-line bg-surface text-ink shadow-sm hover:border-line-strong hover:bg-surface-2`;
export const btnGhostCls = `${btnBase} text-muted hover:bg-surface-2 hover:text-ink`;
export const btnDangerCls = `${btnBase} border border-[color-mix(in_srgb,var(--bad)_35%,transparent)] bg-surface text-[var(--bad)] hover:bg-[var(--bad-bg)]`;
export const chipCls = (active: boolean) => `inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12.5px] transition-colors ${active ? "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-accent-soft font-medium text-accent-text" : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink"}`;

export const fmtUtc = (iso: string | number | Date) => `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC`;
export function relTime(iso: string | number | Date, now = Date.now()): string {
  const d = (now - new Date(iso).getTime()) / 1000;
  const fut = d < 0; const a = Math.abs(d);
  const s = a < 60 ? "just now" : a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} d`;
  if (s === "just now") return s;
  return fut ? `in ${s}` : `${s} ago`;
}
