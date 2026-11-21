import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

const ORDER = [
  { href: "/start/invoices", title: "Six agents review three invoices" },
  { href: "/start/attacks", title: "Try to steal from the vault" },
  { href: "/start/grants", title: "A grant application investigated" },
];

/** Back to Start here, and on to the next guided proof, so a first-time visitor always knows where to go next. */
export function StartNav({ current }: { current: string }) {
  const i = ORDER.findIndex((o) => o.href === current);
  const next = ORDER[i + 1];
  return (
    <nav aria-label="Guided proofs" className="mt-16 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
      <Link href="/start" className="label-mono inline-flex items-center gap-2 text-muted hover:text-ink"><ArrowLeft size={14} aria-hidden />Start here</Link>
      {next ? (
        <Link href={next.href} className="group inline-flex items-center gap-3 text-[18px] font-medium tracking-[-0.01em]"><span className="label-mono text-muted">Next</span>{next.title}<ArrowRight size={16} aria-hidden className="transition-transform group-hover:translate-x-1" /></Link>
      ) : (
        <Link href="/proof" className="group inline-flex items-center gap-3 text-[18px] font-medium tracking-[-0.01em]"><span className="label-mono text-muted">Finally</span>Every transaction, re-read from the chain<ArrowRight size={16} aria-hidden className="transition-transform group-hover:translate-x-1" /></Link>
      )}
    </nav>
  );
}

export const recordedLabel = (what: string) => <p className="label-mono mb-4 text-muted">Recorded run · {what}</p>;
