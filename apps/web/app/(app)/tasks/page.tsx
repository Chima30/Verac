import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks" };

const TONE: Record<string, "approval" | "live" | "failed" | "pending" | "neutral"> = {
  QUEUED: "pending", RUNNING: "neutral", AWAITING_HUMAN: "approval", COMPLETED: "live", FAILED: "failed", PAUSED_AI_UNAVAILABLE: "pending",
};

export default async function Tasks() {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Tasks" description="Agent work items." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Tasks live in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/tasks");
  if (!s.org) redirect("/onboarding");
  const sb = await supabaseServer();
  const { data, error } = await sb!.from("agent_tasks").select("id, agent_id, intent, state, error, result, created_at, updated_at").eq("organization_id", s.org.id).order("created_at", { ascending: false }).limit(100);
  const tasks = data ?? [];
  const waiting = tasks.filter((t) => t.state === "AWAITING_HUMAN").length;
  return (
    <>
      <PageHeader title="Tasks" description="Work items created by agents and the payment pipeline, with where each one is. A task waiting for a human links to the Approvals queue." />
      {error && <p role="alert" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-bg)] px-4 py-3 text-[13.5px] text-[var(--bad)]">{error.message}</p>}
      {tasks.length === 0 ? (
        <EmptyState title="No tasks yet">Tasks appear when something creates them. Right now the only source is a payment approval request: create one on <Link className="underline" href="/approvals">Approvals</Link>. There is no free-form task creation because no agent worker is running to pick tasks up.</EmptyState>
      ) : (
        <Card title={`${tasks.length} task${tasks.length === 1 ? "" : "s"}${waiting ? `, ${waiting} waiting for a human` : ""}`}>
          <ul className="divide-y divide-line text-[13.5px]">{tasks.map((t) => {
            const txId = (t.result as { transaction_id?: string } | null)?.transaction_id;
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span><span className="font-mono text-[12.5px]">{t.agent_id}</span> {t.intent}{t.error ? <span className="text-[12.5px] text-[var(--bad)]"> · {t.error}</span> : null}
                  {txId && <> · <Link className="text-[12.5px] underline" href="/approvals">view approval</Link></>}</span>
                <span className="flex items-center gap-2"><Badge tone={TONE[t.state] ?? "neutral"}>{t.state.replaceAll("_", " ")}</Badge><span className="text-[12.5px] text-muted">{new Date(t.updated_at).toISOString().replace("T", " ").slice(0, 16)} UTC</span></span>
              </li>
            );
          })}</ul>
        </Card>
      )}
    </>
  );
}
