import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader, btnCls, inputCls } from "@/components/ui";
import { AnalyseButton } from "@/components/governance/analyse-button";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { castVote, createProposal, finalizeProposal, openVoting } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Governance" };

const TONE: Record<string, "approval" | "live" | "failed" | "pending" | "neutral"> = { discussion: "pending", voting: "approval", passed: "live", failed: "failed", executed: "live" };
const ADMIN = ["owner", "administrator"];
const VOTER = ["dao_member", "owner", "administrator"];

interface P {
  id: string; title: string; body: string; status: string; quorum: number; pass_pct: number; voting_ends_at: string | null;
  analysis: { label?: string; model?: string; summary?: string; what_changes?: string[]; risks?: string[]; unclear_points?: string[] } | null;
  result: { for: number; against: number; abstain: number; quorum_met: boolean } | null;
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <div><p className="text-[12.5px] font-medium text-muted">{title}</p><ul className="list-disc pl-5 text-[13.5px]">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
}

export default async function Governance({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Governance" description="Proposals and member votes." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Proposals live in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/governance");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = (await supabaseServer())!;
  const admin = ADMIN.includes(s.org.role);
  const canVote = VOTER.includes(s.org.role);

  const { data, error } = await sb.from("governance_proposals").select("id,title,body,status,quorum,pass_pct,voting_ends_at,analysis,result").eq("organization_id", s.org.id).order("created_at", { ascending: false });
  const list = (data ?? []) as unknown as P[];
  const { data: mine } = await sb.from("votes").select("proposal_id,choice").eq("organization_id", s.org.id).eq("voter", s.user.id);
  const myVote = new Map((mine ?? []).map((v) => [v.proposal_id as string, v.choice as string]));
  const now = Date.now();

  return (
    <>
      <PageHeader title="Governance" description="Members discuss and vote on proposals. Voting is one vote per member, with a quorum and a pass threshold set when the proposal is created. The result is counted by the database, not by AI." badge={<Badge tone="sim" />} />
      {sp.msg && <p role="status" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--live)_25%,transparent)] bg-[var(--live-bg)] px-4 py-3 text-[13.5px]">{sp.msg}</p>}
      {(sp.error || error) && <p role="alert" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-bg)] px-4 py-3 text-[13.5px] text-[var(--bad)]">{sp.error ?? error?.message}</p>}

      {admin && (
        <Card title="New proposal" className="mb-4">
          <form action={createProposal} className="space-y-2">
            <input name="title" required minLength={3} maxLength={160} className={inputCls} placeholder="Title" />
            <textarea name="body" required minLength={10} maxLength={8000} rows={5} className={inputCls} placeholder="What is being proposed, and why?" />
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="mb-1.5 block text-[12.5px] font-medium text-muted">Quorum (votes needed)</label><input name="quorum" type="number" min={1} defaultValue={1} className={`${inputCls} w-28`} /></div>
              <div><label className="mb-1.5 block text-[12.5px] font-medium text-muted">Pass if “for” is above (% of for + against)</label><input name="pass_pct" type="number" min={50} max={99} defaultValue={50} className={`${inputCls} w-28`} /></div>
              <button className={btnCls}>Create proposal</button>
            </div>
          </form>
        </Card>
      )}

      {list.length === 0 ? <EmptyState title="No proposals yet">{admin ? "Create the first one above." : "An owner or administrator creates proposals."}</EmptyState> : (
        <div className="space-y-3">{list.map((p) => {
          const ended = p.voting_ends_at ? new Date(p.voting_ends_at).getTime() <= now : false;
          const voted = myVote.get(p.id);
          return (
            <Card key={p.id} title={p.title} right={<Badge tone={TONE[p.status] ?? "neutral"}>{p.status.toUpperCase()}</Badge>}>
              <p className="whitespace-pre-wrap break-words text-[13.5px]">{p.body}</p>
              <p className="mt-2 text-[12.5px] text-muted">Application vote, not an on-chain governance vote. Quorum {p.quorum}; passes above {p.pass_pct}% for.{p.voting_ends_at && ` Voting ${ended ? "ended" : "ends"} ${new Date(p.voting_ends_at).toUTCString()}.`}</p>

              {p.analysis?.summary && (
                <div className="mt-3 space-y-2 rounded-md border border-line p-3">
                  <Badge tone="neutral">{p.analysis.label ?? "AI SUMMARY"}</Badge>
                  <p className="text-[13.5px]">{p.analysis.summary}</p>
                  <List title="What would change" items={p.analysis.what_changes} />
                  <List title="Risks" items={p.analysis.risks} />
                  <List title="Unclear points" items={p.analysis.unclear_points} />
                </div>
              )}
              {admin && ["discussion", "voting"].includes(p.status) && <div className="mt-3"><AnalyseButton id={p.id} again={!!p.analysis} /></div>}

              {p.status === "discussion" && admin && (
                <form action={openVoting} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={p.id} />
                  <div><label className="mb-1.5 block text-[12.5px] font-medium text-muted">Voting lasts (hours)</label><input name="hours" type="number" min={1} max={720} defaultValue={72} className={`${inputCls} w-24`} /></div>
                  <button className={btnCls}>Open voting</button>
                </form>
              )}
              {p.status === "voting" && !ended && canVote && (voted ? <p className="mt-3 text-[13.5px]">You voted: <strong>{voted}</strong>.</p> : (
                <form action={castVote} className="mt-3 flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={p.id} />
                  <button name="choice" value="for" className={btnCls}>Vote for</button>
                  <button name="choice" value="against" className="inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-line bg-surface px-3.5 text-[13.5px] font-medium text-ink shadow-sm transition-[background-color,border-color] hover:border-line-strong hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50">Vote against</button>
                  <button name="choice" value="abstain" className="inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-line bg-surface px-3.5 text-[13.5px] font-medium text-ink shadow-sm transition-[background-color,border-color] hover:border-line-strong hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50">Abstain</button>
                </form>
              ))}
              {p.status === "voting" && ended && (
                <form action={finalizeProposal} className="mt-3"><input type="hidden" name="id" value={p.id} /><button className={btnCls}>Close voting and count</button></form>
              )}
              {p.result && <p className="mt-3 text-[13.5px]">Result: {p.result.for} for, {p.result.against} against, {p.result.abstain} abstained. Quorum {p.result.quorum_met ? "met" : "not met"}.</p>}
            </Card>
          );
        })}</div>
      )}
      <p className="mt-4 text-[12.5px] text-muted">A passed proposal executes nothing. Any spending that follows still goes through the Approvals page.</p>
    </>
  );
}
