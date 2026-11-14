import { AGENTS } from "@qoreops/agent-coordinator";
import { Badge, Card, PageHeader } from "@/components/ui";
import { aiStatus } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI Command Center" };

type Agent = (typeof AGENTS)[keyof typeof AGENTS];

function AgentCard({ a, wide = false }: { a: Agent; wide?: boolean }) {
  return (
    <Card title={a.id} className={wide ? "md:col-span-2" : ""} right={<div className="flex gap-2">{a.usesAi && <Badge tone="neutral">Gemini</Badge>}{a.canMoveFunds && <Badge tone="approval">Executes via pipeline</Badge>}</div>}>
      <p className="text-xs text-text-2">{a.module}</p>
      <p className="mt-2 text-sm">{a.responsibilities}</p>
      <p className="mt-4 text-xs leading-5 text-text-2">Tools: <span className="font-mono">{a.tools.join(", ")}</span></p>
    </Card>
  );
}

export default function CommandCenter() {
  const ai = aiStatus();
  const all = Object.values(AGENTS);
  const movers = all.filter((a) => a.canMoveFunds);
  const others = all.filter((a) => !a.canMoveFunds);
  return (
    <>
      <PageHeader title="AI Command Center" description="The agent registry. All Gemini-backed agents share one rate-limited provider service; only PaymentAgent can submit transactions, and only through the policy and approval pipeline."
        badge={<Badge tone={ai.status === "configured" ? "live" : "unavailable"}>{ai.status === "configured" ? "AI CONFIGURED" : "AI UNAVAILABLE"}</Badge>} />
      {ai.status !== "configured" && <p className="mb-8 rounded-lg border border-line bg-panel px-5 py-3 text-sm text-text-2">{ai.message}</p>}

      <p className="mb-2 text-xs text-text-2">Can move funds, through the pipeline only</p>
      <div className="mb-8 grid gap-4 md:grid-cols-2">{movers.map((a) => <AgentCard key={a.id} a={a} wide />)}</div>

      <p className="mb-2 text-xs text-text-2">Cannot move funds</p>
      <div className="grid gap-4 md:grid-cols-2">{others.map((a) => <AgentCard key={a.id} a={a} />)}</div>
    </>
  );
}
