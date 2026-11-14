import { AGENTS } from "@qoreops/agent-coordinator";
import { Badge, Card, PageHeader } from "@/components/ui";
import { aiStatus } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI Command Center" };

export default function CommandCenter() {
  const ai = aiStatus();
  return (
    <>
      <PageHeader title="AI Command Center" description="The agent registry. All Gemini-backed agents share one rate-limited provider service; only PaymentAgent can submit transactions, and only through the policy and approval pipeline."
        badge={<Badge tone={ai.status === "configured" ? "live" : "unavailable"}>{ai.status === "configured" ? "AI CONFIGURED" : "AI UNAVAILABLE"}</Badge>} />
      {ai.status !== "configured" && <p className="mb-4 rounded-md border border-line bg-surface p-3 text-sm text-muted">{ai.message} Agent chat and intent routing stay off until a key is set; nothing is simulated in its place.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {Object.values(AGENTS).map((a) => (
          <Card key={a.id} title={a.id} right={<div className="flex gap-1.5">{a.usesAi && <Badge tone="neutral">Gemini</Badge>}{a.canMoveFunds && <Badge tone="approval">Executes via pipeline</Badge>}</div>}>
            <p className="text-xs text-muted">{a.module}</p>
            <p className="mt-2 text-sm">{a.responsibilities}</p>
            <p className="mt-3 text-xs text-muted">Tools: <span className="font-mono">{a.tools.join(", ")}</span></p>
          </Card>
        ))}
      </div>
    </>
  );
}
