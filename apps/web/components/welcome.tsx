"use client";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { useEffect, useState } from "react";

const KEY = "verac-welcome-dismissed";

/** First visit only: where to go first. Dismissed once, it stays dismissed in this browser. */
export function Welcome() {
  const [show, setShow] = useState(false);
  useEffect(() => { try { setShow(localStorage.getItem(KEY) !== "1"); } catch { setShow(true); } }, []);
  if (!show) return null;
  const close = () => { setShow(false); try { localStorage.setItem(KEY, "1"); } catch { /* private mode: just hide */ } };
  return (
    <aside aria-label="Welcome" className="mb-10 rounded-[4px] bg-[var(--tint-mint)] p-5 text-[var(--tint-ink)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label-mono">New to Verac</p>
          <p className="mt-3 text-[22px] font-medium leading-[1.2] tracking-[-0.015em]">See it work in three one-minute tours. No account needed.</p>
          <ul className="mt-4 grid gap-2 text-[14px] leading-[1.35] tracking-[-0.01em] sm:grid-cols-3" style={{ color: "var(--tint-sub)" }}>
            <li><span className="font-medium text-[var(--tint-ink)]">Agents</span> review three invoices and pay one</li>
            <li><span className="font-medium text-[var(--tint-ink)]">Attackers</span> try 13 ways to empty the vault</li>
            <li><span className="font-medium text-[var(--tint-ink)]">A grant</span> application gets investigated</li>
          </ul>
          <Link href="/start" className="label-mono mt-5 inline-flex items-center gap-2 rounded-[4px] bg-black px-4 py-2 text-[13px] text-white">Start here<ArrowRight size={14} aria-hidden /></Link>
        </div>
        <button type="button" onClick={close} aria-label="Dismiss the welcome" className="grid size-9 shrink-0 place-items-center rounded-[4px] hover:bg-black/10"><X size={16} aria-hidden /></button>
      </div>
    </aside>
  );
}
