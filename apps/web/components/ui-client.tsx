"use client";
import { Check, Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Copies a value and says so, in words, for screen readers too. */
export function CopyButton({ value, label = "Copy", className = "" }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(value); setDone(true); if (t.current) clearTimeout(t.current); t.current = setTimeout(() => setDone(false), 1400); } catch { /* clipboard blocked: do nothing */ }
      }}
      aria-label={done ? "Copied" : `${label}: ${value}`}
      title={done ? "Copied" : label}
      className={`relative inline-grid size-7 shrink-0 place-items-center rounded-md text-subtle hover:bg-surface-2 hover:text-ink ${className}`}
    >
      {done ? <Check size={14} className="text-[var(--live)]" aria-hidden /> : <Copy size={14} aria-hidden />}
      <span className="sr-only" aria-live="polite">{done ? "Copied" : ""}</span>
    </button>
  );
}

/** A hash or address with copy. `short` shows start…end; the full value is always copied. */
export function Hash({ value, short = true, href, className = "" }: { value: string; short?: boolean; href?: string; className?: string }) {
  const shown = short && value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
  const text = <span className={`font-mono text-[12.5px] ${short ? "" : "break-all"}`} title={value}>{shown}</span>;
  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-0.5 ${className}`}>
      {href ? <a href={href} target="_blank" rel="noreferrer" className="min-w-0 underline decoration-[color-mix(in_srgb,currentColor_35%,transparent)] underline-offset-[3px] hover:decoration-current">{text}</a> : text}
      <CopyButton value={value} label="Copy" />
    </span>
  );
}

/**
 * A figure that counts up to its value once, when it first appears. The real value is rendered on the server and is what
 * screen readers get; people who ask for reduced motion see it without animation. Non-numeric text is shown as is.
 */
export function CountUp({ value }: { value: string }) {
  const m = /^(\D*?)(-?[\d,]*\.?\d+)(.*)$/.exec(value);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!m || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const raw = m[2]!, target = Number(raw.replaceAll(",", ""));
    if (!Number.isFinite(target) || target === 0) return;
    const dp = raw.includes(".") ? raw.split(".")[1]!.length : 0, commas = raw.includes(",");
    const fmt = (n: number) => `${m[1]}${commas ? n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }) : n.toFixed(dp)}${m[3]}`;
    let raf = 0; const t0 = performance.now(), d = 900;
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / d); setShown(fmt(target * (1 - Math.pow(1 - p, 4)))); if (p < 1) raf = requestAnimationFrame(tick); };
    setShown(fmt(0)); raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <><span aria-hidden>{shown}</span><span className="sr-only">{value}</span></>;
}

/**
 * A slide-in panel for a form or a detail. Any link to `#<id>` opens it (so server-rendered buttons need no client code);
 * Escape, the close button or the backdrop close it. Native <dialog>: focus moves in, is kept inside, and returns.
 */
export function Panel({ id, title, description, children }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    const sync = () => { if (window.location.hash === `#${id}` && !d.open) d.showModal(); };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.(`a[href="#${id}"]`);
      if (a) { e.preventDefault(); history.replaceState(null, "", `#${id}`); if (!d.open) d.showModal(); }
    };
    const onClose = () => { if (window.location.hash === `#${id}`) history.replaceState(null, "", window.location.pathname + window.location.search); };
    sync();
    window.addEventListener("hashchange", sync); document.addEventListener("click", onClick); d.addEventListener("close", onClose);
    return () => { window.removeEventListener("hashchange", sync); document.removeEventListener("click", onClick); d.removeEventListener("close", onClose); };
  }, [id]);
  return (
    <dialog ref={ref} id={id} aria-labelledby={`${id}-title`} className="panel" onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <div className="flex max-h-[inherit] min-h-full flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-[22px] font-semibold tracking-[-0.03em]">{title}</h2>
            {description && <p className="mt-1 text-[14px] leading-relaxed text-muted">{description}</p>}
          </div>
          <form method="dialog"><button aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-md border border-line text-muted hover:border-ink hover:text-ink"><X size={16} aria-hidden /></button></form>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </dialog>
  );
}
