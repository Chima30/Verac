import Link from "next/link";
import { Workflow } from "lucide-react";
import { Workforce, type AgentTask, type AgentView } from "@/components/agents/workforce";
import { WorkflowLauncher } from "@/components/agents/workflow-client";
import { Badge, Card, Notice, PageHeader, SectionHeading, relTime, type Tone } from "@/components/ui";
import { agentList, authorityOf } from "@/lib/agents-view";
import { aiStatus } from "@/lib/server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { formatWei, tokenLabel, vaultSnapshot } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI Command Center" };

async function recentTasks(): Promise<{ tasks: AgentTask[]; signedIn: boolean }> {
  const s = await getSession();
  if (!s.user || !s.org) return { tasks: [], signedIn: false };
  const sb = await supabaseServer();
  if (!sb) return { tasks: [], signedIn: false };
  const { data } = await sb.from("agent_tasks").select("id,agent_id,intent,state,error,updated_at").eq("organization_id", s.org.id).order("updated_at", { ascending: false }).limit(100);
  return { signedIn: true, tasks: (data ?? []).map((t) => ({ id: t.id, agent: t.agent_id, intent: t.intent, state: t.state, error: t.error, updatedAt: t.updated_at })) };
}

const WF_STATE: Record<string, { tone: Tone; text: string }> = {
  QUEUED: { tone: "pending", text: "QUEUED" }, RUNNING: { tone: "info", text: "RUNNING" }, AWAITING_HUMAN: { tone: "approval", text: "AWAITING APPROVAL" },
  COMPLETED: { tone: "live", text: "COMPLETED" }, FAILED: { tone: "failed", text: "FAILED" }, CANCELLED: { tone: "pending", text: "CANCELLED" },
};

async function recentWorkflows(): Promise<{ rows: Array<{ id: string; state: string; instruction: string | null; created_at: string; summary: string | null }>; role: string | null }> {
  const s = await getSession();
  if (!s.user || !s.org) return { rows: [], role: null };
  const sb = await supabaseServer();
  if (!sb) return { rows: [], role: s.org.role };
  const { data } = await sb.from("agent_tasks").select("id,state,instruction,created_at,result->summary").eq("organization_id", s.org.id).eq("kind", "invoice_review").order("created_at", { ascending: false }).limit(6);
  return { rows: (data ?? []) as never, role: s.org.role };
}

export default async function CommandCenter({ searchParams }: { searchParams: Promise<{ instruction?: string }> }) {
  const sp = await searchParams;
  const ai = aiStatus();
  const [{ tasks, signedIn }, v, wf] = await Promise.all([recentTasks(), vaultSnapshot(), recentWorkflows()]);
  const canStart = ["owner", "administrator", "finance_manager"].includes(wf.role ?? "");
  const all = agentList();
  const agents: AgentView[] = all.map((a) => ({ id: a.id, module: a.module, responsibilities: a.responsibilities, tools: [...a.tools], usesAi: a.usesAi, canMoveFunds: a.canMoveFunds, mayMessage: [...a.mayMessage], authority: authorityOf(a) }));
  // PaymentAgent's limits are whatever the vault contract enforces right now, read from the chain.
  const rules = v.ok ? v.rules.filter((r) => r.active).map((r) => `${r.agent.slice(0, 8)}…${r.agent.slice(-4)}: ${formatWei(r.perTxCap)} ${tokenLabel(r.token)} per payment, ${formatWei(r.dailyCap)} per day, ${formatWei(r.remainingToday)} left today`) : [];
  const usesAi = all.filter((a) => a.usesAi).length;
  const proposers = agents.filter((a) => a.authority === "propose").length;
  return (
    <>
      <PageHeader title="AI Command Center" eyebrow="AI workforce"
        description="Fifteen agents, each with a fixed list of tools enforced in code. Gemini-backed agents share one rate-limited service and only ever advise. PaymentAgent alone can submit a payment, and only after policy checks and human approval."
        badge={<Badge tone={ai.status === "configured" ? "live" : "unavailable"}>{ai.status === "configured" ? "GEMINI CONFIGURED" : "GEMINI UNAVAILABLE"}</Badge>}
        meta={<><span><strong className="font-semibold text-ink">{all.length}</strong> agents</span><span><strong className="font-semibold text-ink">{usesAi}</strong> use Gemini{ai.status === "configured" ? ` (${ai.model})` : ""}</span><span><strong className="font-semibold text-ink">{proposers}</strong> may propose payments</span><span><strong className="font-semibold text-ink">1</strong> may submit them</span></>} />
      {ai.status !== "configured" && <Notice tone="warn" className="mb-6" title="AI features are paused on this server">{ai.message} Deterministic agents (payments, payroll, revenue, documents, strategies, arbitrage) are unaffected.</Notice>}
      <div id="workflow" className="mb-8 grid scroll-mt-24 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card icon={Workflow} tile="violet" title="Give the agents a job" description="One instruction, six agents: Invoice, Milestone, Security, Treasury, Policy and Payment. They read your organisation's records, check every invoice and prepare only what passes.">
          {signedIn ? <WorkflowLauncher initial={sp.instruction} canStart={canStart} /> : <p className="text-[13.5px] text-muted">Sign in to run a workflow on your organisation's records.</p>}
        </Card>
        <Card title="Recent workflows" flush>
          {wf.rows.length === 0 ? <p className="py-6 text-center text-[13px] text-muted">{signedIn ? "None yet." : "Sign in to see your organisation's workflows."}</p> : (
            <ul className="-mx-5 divide-y divide-line">{wf.rows.map((r) => (
              <li key={r.id}><Link href={`/command-center/tasks/${r.id}`} className="block px-5 py-3 hover:bg-surface-2/60">
                <span className="flex items-center justify-between gap-2"><span className="truncate text-[13.5px] font-medium">{r.instruction}</span><Badge tone={WF_STATE[r.state]?.tone ?? "neutral"}>{WF_STATE[r.state]?.text ?? r.state}</Badge></span>
                <span className="mt-0.5 block truncate text-[12px] text-muted">{relTime(r.created_at)}{r.summary ? ` · ${r.summary}` : ""}</span>
              </Link></li>
            ))}</ul>
          )}
        </Card>
      </div>
      <SectionHeading title="The agents" description="Each agent's tools are fixed in code. Select one to see exactly what it may do." />
      <Workforce agents={agents} tasks={tasks} rules={rules} aiOn={ai.status === "configured"} signedIn={signedIn} />
    </>
  );
}
