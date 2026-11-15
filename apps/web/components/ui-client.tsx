"use client";
import { Check, Copy } from "lucide-react";
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
