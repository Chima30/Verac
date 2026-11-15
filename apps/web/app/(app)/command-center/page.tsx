import { Workforce, type AgentTask, type AgentView } from "@/components/agents/workforce";
import { Badge, Notice, PageHeader } from "@/components/ui";
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

export default async function CommandCenter() {
  const ai = aiStatus();
  const [{ tasks, signedIn }, v] = await Promise.all([recentTasks(), vaultSnapshot()]);
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
      <Workforce agents={agents} tasks={tasks} rules={rules} aiOn={ai.status === "configured"} signedIn={signedIn} />
    </>
  );
}
