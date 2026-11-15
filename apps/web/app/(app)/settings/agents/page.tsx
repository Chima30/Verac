import { AGENTS, TOOLS } from "@qoreops/agent-coordinator";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Agent Permissions" };

export default function AgentPermissions() {
  const agents = Object.values(AGENTS);
  return (
    <>
      <PageHeader title="Agent Permissions" description="Tool allow-list per agent, enforced in code by the coordinator. Read-only view of the compiled configuration." badge={<Badge tone="neutral">READ ONLY</Badge>} />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-left text-[12.5px]">
          <thead><tr className="border-b border-line"><th className="py-2 pr-3 font-medium">Agent</th>{TOOLS.map((t) => <th key={t} className="px-2 py-2 font-mono font-normal text-muted">{t}</th>)}</tr></thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0">
                <td className="py-2 pr-3 font-medium">{a.id}</td>
                {TOOLS.map((t) => <td key={t} className="px-2 py-2 text-center">{(a.tools as readonly string[]).includes(t) ? <span aria-label="allowed">●</span> : <span className="text-muted" aria-label="denied">–</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
