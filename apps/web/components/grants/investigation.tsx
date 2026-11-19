"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Notice, btnCls, inputCls, labelCls } from "@/components/ui";

/** Questions answered from stored results rather than by starting a new investigation. Mirrors lib/grants/queries.ts. */
export const QUERY = /\b(incomplete budget|budget breakdown|missing budget|qorechain deployment|on-?chain|deployed contract|verifiable deployment|shortlist|within (our |the )?(remaining )?budget|allocat|compare|milestone|funded project)/i;

export function InvestigationControls({ grantId, activeTaskId, activeState }: { grantId: string; activeTaskId: string | null; activeState: string | null }) {
  const router = useRouter();
  const [text, setText] = useState("Review all applications submitted for this round. Check their GitHub repositories, project progress, technical feasibility, funding requests and milestones. Identify duplicate or suspicious applications, draft questions for missing information, and recommend the strongest candidates within our available budget.");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const stop = useRef(false);

  async function advanceUntilDone(taskId: string) {
    stop.current = false;
    for (let i = 0; i < 80 && !stop.current; i++) {
      const r = await fetch("/api/grants/investigate/advance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId }) });
      const j = (await r.json().catch(() => ({}))) as { state?: string; ran?: string | null; error?: string };
      if (!r.ok) { setErr(j.error ?? "The investigation could not continue."); break; }
      if (j.ran) setProgress(`Last step: ${j.ran.replace(/^research:/, "evidence for ").replace(/^assess:/, "assessment of ")}`);
      router.refresh();
      if (!j.state || !["QUEUED", "RUNNING"].includes(j.state)) break;
      if (!j.ran) await new Promise((res) => setTimeout(res, 2500)); // another worker holds the lease, or a retry wait
    }
    setBusy(false);
    setProgress(null);
  }

  useEffect(() => {
    if (activeTaskId && activeState && ["QUEUED", "RUNNING"].includes(activeState) && !busy) { setBusy(true); void advanceUntilDone(activeTaskId); }
    return () => { stop.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTaskId]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (QUERY.test(text) && !/\b(review|investigate|check)\b.*\bapplications?\b/i.test(text)) { router.push(`?q=${encodeURIComponent(text)}`); return; }
    setBusy(true);
    const r = await fetch("/api/grants/investigate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grantId, instruction: text, idempotencyKey: `grant-${crypto.randomUUID()}` }) });
    const j = (await r.json().catch(() => ({}))) as { taskId?: string; error?: string };
    if (!r.ok || !j.taskId) { setErr(j.error ?? "Could not start."); setBusy(false); return; }
    router.push(`?task=${j.taskId}`);
    await advanceUntilDone(j.taskId);
  }

  return (
    <form onSubmit={run} className="space-y-3">
      <label htmlFor="gi-text" className={labelCls}>Instruction</label>
      <textarea id="gi-text" rows={4} maxLength={2000} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <button className={btnCls} disabled={busy || text.trim().length < 3}>{busy ? "Agents are working…" : "Run"}</button>
        <span className="text-[12.5px] text-muted">{progress ?? "Investigations run step by step and survive a refresh. Questions such as \"which projects have verifiable QoreChain deployments?\" are answered from the stored evidence."}</span>
      </div>
      {err && <Notice tone="bad" role="alert">{err}</Notice>}
    </form>
  );
}
