"use client";
import { ArrowRight, Bot, CornerDownLeft, Lock, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, StatusDot, Steps, btnCls, btnSecondaryCls, inputCls, relTime, type StepState } from "@/components/ui";
import { AGENT_HOME, AUTHORITY, GROUPS, ROUTING, TOOL_TEXT, type Authority } from "@/lib/agents-view";

export interface AgentView { id: string; module: string; responsibilities: string; tools: string[]; usesAi: boolean; canMoveFunds: boolean; mayMessage: string[]; authority: Authority }
export interface AgentTask { id: string; agent: string; intent: string; state: string; error: string | null; updatedAt: string }

const AUTH_TONE: Record<Authority, "approval" | "info" | "neutral" | "pending"> = { submit: "approval", propose: "info", draft: "neutral", read: "pending" };
const TASK_TONE: Record<string, "approval" | "failed" | "pending" | "info" | "neutral"> = { AWAITING_HUMAN: "approval", COMPLETED: "info", FAILED: "failed", QUEUED: "pending", RUNNING: "neutral", PAUSED_AI_UNAVAILABLE: "pending" };

function route(text: string, agents: AgentView[]): AgentView | null {
  const t = ` ${text.toLowerCase()} `;
  let best: { a: AgentView; s: number } | null = null;
  for (const a of agents) {
    const s = (ROUTING[a.id] ?? []).reduce((n, w) => n + (t.includes(w) ? (w.length > 5 ? 2 : 1) : 0), 0);
    if (s > 0 && (!best || s > best.s)) best = { a, s };
  }
  return best?.a ?? null;
}

/** How a task for this agent runs through Verac, step by step, derived from the agent's real tool list. */
function plan(a: AgentView, aiOn: boolean): Array<{ label: string; detail: string; state: StepState }> {
  const has = (t: string) => a.tools.includes(t);
  const reads = [has("db.read") && "your records", has("chain.read") && "the chain", has("docs.read.ciphertext") && "document metadata", has("market.read") && "market quotes"].filter(Boolean).join(", ");
  return [
    { label: "Task received", detail: "Recorded as a work item for your organisation.", state: "step" },
    { label: `Assigned to ${a.id}`, detail: a.module, state: "step" },
    { label: "Information retrieved", detail: `Reads ${reads || "nothing outside the request"}.`, state: "step" },
    { label: "Analysis", detail: a.usesAi ? (aiOn ? "Gemini drafts an analysis. It is advice and never changes a decision." : "Needs Gemini, which is not configured here. The task would pause.") : "Fixed, deterministic rules. No AI involved.", state: a.usesAi && !aiOn ? "blocked" : "step" },
    { label: "Policy evaluation", detail: has("policy.evaluate") ? "Checked against your active policy before anything is proposed." : "This agent does not run policy checks; it only drafts.", state: "step" },
    { label: "Human approval", detail: has("payments.propose") || has("payments.submit") ? "Any payment waits for a person. You cannot approve your own request." : "Not needed: nothing this agent produces moves money.", state: "step" },
    { label: "Execution", detail: a.canMoveFunds ? "PaymentAgent submits through the pipeline; the vault contract enforces limits on chain." : "None. This agent cannot submit transactions.", state: "step" },
    { label: "Result", detail: a.canMoveFunds ? "A transaction hash and receipt, or the reason it failed." : "A recommendation or draft for you to act on.", state: "step" },
  ];
}

function Detail({ a, tasks, rules, onClose, aiOn }: { a: AgentView; tasks: AgentTask[]; rules: string[]; onClose?: () => void; aiOn: boolean }) {
  const mine = tasks.filter((t) => t.agent === a.id);
  const errors = mine.filter((t) => t.state === "FAILED");
  const home = AGENT_HOME[a.id];
  return (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-lg ${a.canMoveFunds ? "bg-[var(--warn-bg)] text-[var(--warn)]" : "bg-surface-2 text-muted"}`}><Bot size={18} /></span>
          <div className="min-w-0"><h2 className="truncate text-[17px] font-semibold tracking-tight">{a.id}</h2><p className="text-[12.5px] text-muted">{a.module}</p></div>
        </div>
        {onClose && <button type="button" onClick={onClose} aria-label="Close agent details" className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-surface-2"><X size={18} aria-hidden /></button>}
      </div>
      <p className="mt-4 text-[14px] leading-relaxed">{a.responsibilities}</p>

      <div className={`mt-4 rounded-lg border px-4 py-3 ${a.canMoveFunds ? "border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-[var(--warn-bg)]" : "border-line bg-surface-2"}`}>
        <p className="flex items-center gap-2 text-[13px] font-medium">{a.canMoveFunds ? null : <Lock size={13} aria-hidden className="text-subtle" />}{AUTHORITY[a.authority].label}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{AUTHORITY[a.authority].detail}</p>
      </div>

      {a.canMoveFunds && (
        <section className="mt-5">
          <h3 className="text-[12.5px] font-medium text-muted">Spending limits on chain</h3>
          {rules.length ? <ul className="mt-2 space-y-1.5 text-[13px]">{rules.map((r) => <li key={r} className="rounded-md bg-surface-2 px-3 py-2 font-mono text-[12px]">{r}</li>)}</ul>
            : <p className="mt-1 text-[13px] text-muted">No active rule could be read from the vault.</p>}
        </section>
      )}

      <section className="mt-5">
        <h3 className="text-[12.5px] font-medium text-muted">What it is allowed to do</h3>
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {a.tools.map((t) => {
            const x = TOOL_TEXT[t];
            return (
              <li key={t} className="flex items-start gap-3 px-3 py-2.5">
                <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${x?.risk === 3 ? "bg-[var(--warn)]" : x?.risk === 2 ? "bg-[var(--info)]" : "bg-[var(--subtle)]"}`} />
                <div className="min-w-0"><p className="text-[13px] font-medium">{x?.label ?? t}</p><p className="text-[12px] leading-relaxed text-muted">{x?.detail}</p><p className="mt-0.5 font-mono text-[11.5px] text-subtle">{t}</p></div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-5">
        <h3 className="text-[12.5px] font-medium text-muted">May message</h3>
        <p className="mt-1.5 flex flex-wrap gap-1.5">{a.mayMessage.map((m) => <span key={m} className="rounded-md border border-line px-2 py-0.5 font-mono text-[11.5px] text-muted">{m}</span>)}</p>
        <p className="mt-1.5 text-[12px] text-subtle">Messages are signed and checked by the message bus; anything else is rejected.</p>
      </section>

      <section className="mt-5">
        <h3 className="text-[12.5px] font-medium text-muted">Recent tasks</h3>
        {mine.length === 0 ? <p className="mt-1.5 text-[13px] text-muted">No recorded tasks for this agent in your organisation.</p> : (
          <ul className="mt-2 space-y-2">{mine.slice(0, 6).map((t) => (
            <li key={t.id} className="rounded-md border border-line px-3 py-2">
              <p className="text-[13px]">{t.intent}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-muted"><StatusDot tone={TASK_TONE[t.state] ?? "neutral"}>{t.state.replaceAll("_", " ").toLowerCase()}</StatusDot><span>{relTime(t.updatedAt)}</span></p>
              {t.error && <p className="mt-1 text-[12px] text-[var(--bad)]">{t.error}</p>}
            </li>
          ))}</ul>
        )}
        {errors.length > 0 && <p className="mt-2 text-[12.5px] text-[var(--bad)]">{errors.length} failed task{errors.length === 1 ? "" : "s"} in the recent history.</p>}
      </section>

      <details className="group mt-5 rounded-lg border border-line">
        <summary className="flex items-center justify-between px-3 py-2.5 text-[13px] font-medium">How a task for this agent runs<ArrowRight size={14} aria-hidden className="chevron text-subtle" /></summary>
        <div className="border-t border-line px-3 py-3"><Steps compact steps={plan(a, aiOn)} /></div>
      </details>

      {home && <Link href={home.href} className={`${btnSecondaryCls} mt-5 w-full`}>Open {home.label}<ArrowRight size={14} aria-hidden /></Link>}
    </div>
  );
}

export function Workforce({ agents, tasks, rules, aiOn, signedIn }: { agents: AgentView[]; tasks: AgentTask[]; rules: string[]; aiOn: boolean; signedIn: boolean }) {
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const [sel, setSel] = useState<string>("PaymentAgent");
  const [sheet, setSheet] = useState(false);
  const [text, setText] = useState("");
  const [routed, setRouted] = useState<{ q: string; a: AgentView | null } | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const a = byId.get(sel)!;

  useEffect(() => {
    if (!sheet) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(false); };
    document.addEventListener("keydown", k); document.body.style.overflow = "hidden";
    detailRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [sheet]);

  const pick = (id: string) => { setSel(id); if (window.innerWidth < 1024) setSheet(true); };
  const counts = (id: string) => tasks.filter((t) => t.agent === id);
  const examples = ["Review our unpaid invoices and flag suspicious ones", "Prepare this month's contributor payroll", "Compare the bids on the website redesign tender", "Is any agent key exposed to a quantum attack?"];

  return (
    <div className="space-y-6">
      {/* Instruction routing */}
      <section aria-labelledby="ask-h" className="rounded-lg border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="ask-h" className="flex items-center gap-2 text-[14px] font-semibold"><Sparkles size={15} aria-hidden className="text-accent-text" />Give Verac an instruction</h2>
            <p className="mt-0.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">Describe the work. Verac finds the agent responsible and shows exactly how the task would run and where a person must decide. Routing uses fixed keywords, not AI, and nothing runs until you continue in that module.</p></div>
          {!aiOn && <Badge tone="unavailable">GEMINI NOT CONFIGURED</Badge>}
        </div>
        <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { const r = route(text, agents); setRouted({ q: text.trim(), a: r }); if (r) setSel(r.id); } }}>
          <label htmlFor="instr" className="sr-only">Instruction</label>
          <input id="instr" value={text} onChange={(e) => setText(e.target.value)} className={inputCls} placeholder="e.g. Review our unpaid invoices and identify suspicious ones" maxLength={280} />
          <button type="submit" className={`${btnCls} shrink-0`} disabled={!text.trim()}>Find the agent<CornerDownLeft size={14} aria-hidden /></button>
        </form>
        {!routed && <div className="mt-3 flex flex-wrap gap-1.5">{examples.map((x) => <button key={x} type="button" onClick={() => setText(x)} className="rounded-md border border-line px-2.5 py-1 text-[12px] text-muted hover:border-line-strong hover:text-ink">{x}</button>)}</div>}
        {routed && (
          <div role="status" className="mt-4 rounded-lg border border-line bg-bg/60 p-4">
            {!routed.a ? <p className="text-[13.5px]">No agent handles “{routed.q}” by name. Try naming the area (invoices, payroll, tender, grant, policy, security), or open the command palette with <kbd className="rounded border border-line px-1 font-mono text-[11.5px]">Ctrl K</kbd>.</p> : (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_1.2fr]">
                <div>
                  <p className="text-[12px] text-muted">Handled by</p>
                  <p className="mt-0.5 text-[16px] font-semibold">{routed.a.id}</p>
                  <p className="text-[12.5px] text-muted">{routed.a.module}</p>
                  <div className="mt-3"><Badge tone={AUTH_TONE[routed.a.authority]}>{AUTHORITY[routed.a.authority].label.toUpperCase()}</Badge></div>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-muted">This is a plan, not a run. No task has been created and nothing has been sent to Gemini or the chain.</p>
                  {AGENT_HOME[routed.a.id] && <Link href={AGENT_HOME[routed.a.id]!.href} className={`${btnCls} mt-4`}>Continue in {AGENT_HOME[routed.a.id]!.label}<ArrowRight size={14} aria-hidden /></Link>}
                </div>
                <Steps compact steps={plan(routed.a, aiOn)} />
              </div>
            )}
          </div>
        )}
      </section>

      {/* Directory + detail */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_27rem]">
        <div className="min-w-0 space-y-6">
          {GROUPS.map((g) => (
            <section key={g.id} aria-labelledby={`g-${g.id}`}>
              <div className="mb-2 flex items-baseline justify-between gap-2"><h2 id={`g-${g.id}`} className="text-[14px] font-semibold">{g.title}</h2><p className="text-[12.5px] text-muted">{g.description}</p></div>
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
                {g.agents.map((id) => {
                  const x = byId.get(id); if (!x) return null;
                  const t = counts(id); const waiting = t.filter((y) => y.state === "AWAITING_HUMAN").length; const failed = t.filter((y) => y.state === "FAILED").length;
                  const on = sel === id;
                  return (
                    <li key={id}>
                      <button type="button" onClick={() => pick(id)} aria-pressed={on}
                        className={`relative flex w-full items-center gap-3 px-4 py-3 text-left ${on ? "bg-surface-2" : "hover:bg-surface-2/60"}`}>
                        {on && <span aria-hidden className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-accent" />}
                        <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-md ${x.canMoveFunds ? "bg-[var(--warn-bg)] text-[var(--warn)]" : "bg-surface-2 text-muted"}`}><Bot size={15} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2"><span className="text-[13.5px] font-medium">{x.id}</span>{x.usesAi && <span className="text-[11.5px] text-subtle">Gemini</span>}</span>
                          <span className="block truncate text-[12.5px] text-muted">{x.responsibilities}</span>
                        </span>
                        <span className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                          <Badge tone={AUTH_TONE[x.authority]}>{x.authority === "submit" ? "SUBMITS" : x.authority === "propose" ? "PROPOSES" : x.authority === "draft" ? "DRAFTS" : "READS"}</Badge>
                          {signedIn && (waiting || failed || t.length) ? <span className="text-[11.5px] text-muted">{waiting ? `${waiting} waiting · ` : ""}{failed ? <span className="text-[var(--bad)]">{failed} failed · </span> : ""}{t.length} recent</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <aside aria-label="Agent details" className="hidden lg:block">
          <div className="scroll-quiet sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-card"><Detail a={a} tasks={tasks} rules={rules} aiOn={aiOn} /></div>
        </aside>
      </div>

      {sheet && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={`${a.id} details`}>
          <button type="button" tabIndex={-1} aria-label="Close" onClick={() => setSheet(false)} className="motion-scrim absolute inset-0 bg-black/45" />
          <div ref={detailRef} className="motion-pop scroll-quiet absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[4px] border-t border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <Detail a={a} tasks={tasks} rules={rules} aiOn={aiOn} onClose={() => setSheet(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
