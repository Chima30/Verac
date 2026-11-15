"use client";
import { RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { btnCls, btnSecondaryCls } from "@/components/ui";

/** A page failed while rendering. Says so plainly and offers a safe retry; nothing financial is retried automatically. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const network = /fetch|network|timed? ?out|ECONN|socket/i.test(error.message);
  return (
    <div role="alert" className="mx-auto max-w-xl py-16 text-center">
      <p className="text-[12.5px] font-medium text-[var(--bad)]">This page could not load</p>
      <h1 className="mt-2 text-[22px] font-semibold tracking-tight">{network ? "A service did not answer in time" : "Something on this page failed"}</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        {network ? "Verac could not reach the chain or the database. No action was taken and nothing was sent. Retrying only reads the page again."
          : "The page stopped while reading its data. No action was taken and nothing was sent. Retrying only reads the page again."}
      </p>
      {error.digest && <p className="mt-3 font-mono text-[12px] text-subtle">Reference {error.digest}</p>}
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" onClick={reset} className={btnCls}><RotateCw size={14} aria-hidden />Try again</button>
        <Link href="/dashboard" className={btnSecondaryCls}>Go to dashboard</Link>
      </div>
    </div>
  );
}
