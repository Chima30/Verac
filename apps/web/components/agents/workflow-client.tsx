"use client";
import { ArrowRight, Loader2, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Notice, btnCls, btnSecondaryCls, inputCls } from "@/components/ui";

const EXAMPLE = "Review our three outstanding contractor invoices, check whether their milestones were approved, flag anything suspicious, and prepare eligible payments.";

/** Starts a workflow. The idempotency key is created once per typed instruction, so a double click cannot start two. */
export function WorkflowLauncher({ initial, canStart }: { initial?: string; canStart: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(initial ?? EXAMPLE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = useRef<{ text: string; key: string } | null>(null);
  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!key.current || key.current.text !== text) key.current = { text, key: `wf-${crypto.randomUUID()}` };
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/agent/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instruction: text, idempotencyKey: key.current.key }) });
      const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!r.ok || !j.id) { setErr(j.error ?? "Could not start the workflow."); setBusy(false); return; }
      router.push(`/command-center/tasks/${j.id}`);
    } catch { setErr("Network error. Nothing was started."); setBusy(false); }
  }
  return (
    <form onSubmit={start} className="space-y-3">
      <label htmlFor="wf-text" className="sr-only">Instruction</label>
      <textarea id="wf-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} disabled={!canStart || busy} className={`${inputCls} text-[15px] leading-relaxed`} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={btnCls} disabled={!canStart || busy || text.trim().length < 3}>{busy ? <><Loader2 size={15} className="animate-spin" aria-hidden />Starting…</> : <>Run with agents<ArrowRight size={15} aria-hidden /></>}</button>
        <span className="text-[12.5px] text-muted">{canStart ? "Agents read your organisation's records. Nothing is paid without a second administrator." : "Only finance roles can start a workflow."}</span>
      </div>
      {err && <Notice tone="bad" role="alert">{err}</Notice>}
    </form>
  );
}

/**
 * Drives a workflow while someone is watching: asks the server to run the next step, then refreshes the page to show what
 * really happened. It never invents progress; if no step runs, it stops and says why.
 */
export function WorkflowRunner({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(active);
  const stop = useRef(false);

  useEffect(() => {
    if (!active) return;
    stop.current = false;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 14 && !cancelled && !stop.current; i++) {
        try {
          const r = await fetch(`/api/agent/workflows/${id}/advance`, { method: "POST" });
          const j = (await r.json().catch(() => ({}))) as { state?: string; ran?: string | null; next?: string | null; waiting?: string | null; error?: string | null };
          if (r.status === 429) { await new Promise((res) => setTimeout(res, 1000 * (Number(r.headers.get("retry-after")) || 5))); continue; }
          if (!r.ok) { setErr(j.error ?? "The step failed."); break; }
          router.refresh();
          if (j.waiting) { setWaiting(j.waiting); break; }
          if (j.error && j.state !== "FAILED") setErr(`Last attempt failed and will be retried: ${j.error}`); else setErr(null);
          if (!j.ran || !["QUEUED", "RUNNING"].includes(j.state ?? "")) break;
          setStatus(j.next ? `Running: ${j.next}` : null);
        } catch { setErr("Network error. The workflow is saved; reload to continue."); break; }
      }
      if (!cancelled) { setRunning(false); setStatus(null); }
    })();
    return () => { cancelled = true; };
  }, [id, active, router]);

  if (!running && !waiting && !err) return null;
  return (
    <div className="mb-6 space-y-2" aria-live="polite">
      {running && status && <Notice tone="info"><span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden />{status}</span></Notice>}
      {waiting && <Notice tone="warn">{waiting}</Notice>}
      {err && <Notice tone="bad" role="alert">{err}</Notice>}
    </div>
  );
}

export function CancelWorkflow({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" disabled={busy} className={btnSecondaryCls} onClick={async () => {
        if (!confirm("Cancel this workflow? Analysis stops. Payment requests already prepared stay in the approvals queue until someone rejects them.")) return;
        setBusy(true); setErr(null);
        const r = await fetch(`/api/agent/workflows/${id}/cancel`, { method: "POST" });
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) setErr(j.error ?? "Could not cancel."); else router.refresh();
        setBusy(false);
      }}><Square size={13} aria-hidden />Cancel</button>
      {err && <span role="alert" className="text-[12px] text-[var(--bad)]">{err}</span>}
    </span>
  );
}
