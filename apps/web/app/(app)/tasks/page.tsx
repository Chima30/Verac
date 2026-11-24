import Link from "next/link";
import { stateOf, toneMap } from "@/lib/states";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, FlashMessages, Notice, PageHeader, fmtUtc, relTime } from "@/components/ui";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks" };

const TONE = toneMap("workflow");
const STATES: Array<[string, string]> = [["AWAITING_HUMAN", "Waiting for a person"], ["RUNNING", "Running"], ["QUEUED", "Queued"], ["COMPLETED", "Completed"], ["FAILED", "Failed"], ["PAUSED_AI_UNAVAILABLE", "Paused, AI unavailable"]];

export default async function Tasks() {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Tasks" description="Agent work items." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Tasks live in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/tasks");
  if (!s.org) redirect("/onboarding");
  const sb = await supabaseServer();
  const { data, error } = await sb!.from("agent_tasks").select("id, agent_id, intent, state, error, result, kind, parent_task_id, created_at, updated_at").eq("organization_id", s.org.id).order("created_at", { ascending: false }).limit(100);
  const tasks = data ?? [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const waiting = tasks.filter((t) => t.state === "AWAITING_HUMAN").length;
  return (
    <>
      <PageHeader title="Tasks" eyebrow="Overview" description="Work items created by agents and the payment pipeline, and where each one is. Open a task to see its workflow, step by step; a task waiting for a person links to the Approvals queue."
        meta={<>{STATES.map(([k, label]) => { const n = tasks.filter((t) => t.state === k).length; return n ? <span key={k}><strong className="font-semibold text-ink tabular-nums">{n}</strong> {label.toLowerCase()}</span> : null; })}</>} />
      <FlashMessages error={error?.message} />
      {waiting > 0 && <Notice tone="warn" className="mb-6" title={`${waiting} task${waiting === 1 ? " is" : "s are"} waiting for a person`}>Decide them on <Link href="/approvals">Approvals</Link>. Nothing moves until someone does.</Notice>}
      {tasks.length === 0 ? (
        <EmptyState title="No tasks yet">Tasks appear when something creates them. Right now the only source is a payment approval request: create one on <Link className="underline" href="/approvals">Approvals</Link>. There is no free-form task creation because no agent worker is running to pick tasks up.</EmptyState>
      ) : (
        <Card title={`${tasks.length} task${tasks.length === 1 ? "" : "s"}`} description="Newest first. The latest 100." flush>
          <div className="-mx-5 overflow-x-auto">
            <table className="data-table min-w-[40rem] [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5">
              <thead><tr><th>Agent</th><th>Work</th><th>State</th><th>Updated</th></tr></thead>
              <tbody>{tasks.map((t) => {
                const txId = (t.result as { transaction_id?: string } | null)?.transaction_id;
                // The workflow timeline lives on the coordinator's task; each agent's step links to its parent run.
                const run = t.kind === "invoice_review" ? t.id : t.parent_task_id && byId.get(t.parent_task_id)?.kind === "invoice_review" ? t.parent_task_id : null;
                return (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap font-mono text-[12.5px]">{t.agent_id}</td>
                    <td>{run ? <Link href={`/command-center/tasks/${run}`} className="text-[13.5px] hover:underline">{t.intent}</Link> : <p className="text-[13.5px]">{t.intent}</p>}{t.error && <p className="mt-0.5 text-[12.5px] text-[var(--bad)]">{t.error}</p>}{txId && <Link className="text-[12.5px] font-medium text-accent-text hover:underline" href="/approvals">View the payment request</Link>}</td>
                    <td><Badge tone={TONE[t.state] ?? "neutral"}>{stateOf("workflow", t.state).label}</Badge></td>
                    <td className="whitespace-nowrap text-[12.5px] text-muted" title={fmtUtc(t.updated_at)}>{relTime(t.updated_at)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
