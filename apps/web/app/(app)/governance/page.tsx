import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, FlashMessages, PageHeader, SectionHeading, StatusDot, btnCls, btnSecondaryCls, fmtUtc, inputCls, labelCls, relTime } from "@/components/ui";
import { AnalyseButton } from "@/components/governance/analyse-button";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { castVote, createProposal, finalizeProposal, openVoting } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Governance" };

const TONE: Record<string, "approval" | "live" | "failed" | "pending" | "neutral" | "info"> = { discussion: "pending", voting: "approval", passed: "info", failed: "failed", executed: "info" };
const ADMIN = ["owner", "administrator"];
const VOTER = ["dao_member", "owner", "administrator"];

interface P {
  id: string; title: string; body: string; status: string; quorum: number; pass_pct: number; voting_ends_at: string | null;
  analysis: { label?: string; model?: string; summary?: string; what_changes?: string[]; risks?: string[]; unclear_points?: string[] } | null;
  result: { for: number; against: number; abstain: number; quorum_met: boolean } | null;
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <div><p className="text-[12.5px] font-medium text-muted">{title}</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13.5px]">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
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

  const groups: Array<{ title: string; description: string; items: P[] }> = [
    { title: "Voting now", description: "One vote per member. You can vote once.", items: list.filter((p) => p.status === "voting") },
    { title: "In discussion", description: "Not yet open for votes.", items: list.filter((p) => p.status === "discussion") },
    { title: "Decided", description: "Counted by the database when voting closed.", items: list.filter((p) => ["passed", "failed", "executed"].includes(p.status)) },
  ];

  const proposal = (p: P) => {
    const ended = p.voting_ends_at ? new Date(p.voting_ends_at).getTime() <= now : false;
    const voted = myVote.get(p.id);
    const r = p.result; const cast = r ? r.for + r.against + r.abstain : 0;
    const pct = (n: number) => (cast ? (n / cast) * 100 : 0);
    return (
      <Card key={p.id} title={p.title} right={<Badge tone={TONE[p.status] ?? "neutral"}>{p.status.toUpperCase()}</Badge>}>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
          <span>Quorum {p.quorum} vote{p.quorum === 1 ? "" : "s"}</span><span>Passes above {p.pass_pct}% for</span>
          {p.voting_ends_at && <span className={!ended && p.status === "voting" ? "font-medium text-ink" : ""}>Voting {ended ? "ended" : "ends"} {relTime(p.voting_ends_at)} ({fmtUtc(p.voting_ends_at)})</span>}
        </div>
        <details className="group mt-3" open={p.status !== "passed" && p.status !== "failed" && p.status !== "executed"}>
          <summary className="text-[13px] font-medium text-accent-text">Proposal text<span className="group-open:hidden"> (show)</span></summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">{p.body}</p>
        </details>

        {p.analysis?.summary && (
          <div className="mt-4 space-y-3 rounded-lg border border-[color-mix(in_srgb,var(--sim)_25%,transparent)] bg-[var(--sim-bg)]/50 p-4">
            <div className="flex flex-wrap items-center gap-2"><Badge tone="sim">{p.analysis.label ?? "AI SUMMARY"}</Badge><span className="text-[12.5px] text-muted">Advice only. Gemini does not vote.</span></div>
            <p className="text-[13.5px]">{p.analysis.summary}</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3"><List title="What would change" items={p.analysis.what_changes} /><List title="Risks" items={p.analysis.risks} /><List title="Unclear points" items={p.analysis.unclear_points} /></div>
          </div>
        )}

        {r && (
          <div className="mt-4">
            <div className="flex h-2 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${r.for} for, ${r.against} against, ${r.abstain} abstained`}>
              <span style={{ width: `${pct(r.for)}%`, background: "var(--live)" }} /><span style={{ width: `${pct(r.against)}%`, background: "var(--bad)" }} /><span style={{ width: `${pct(r.abstain)}%`, background: "var(--subtle)" }} />
            </div>
            <p className="mt-2 flex flex-wrap gap-x-5 text-[13px]"><StatusDot tone="live">{r.for} for</StatusDot><StatusDot tone="failed">{r.against} against</StatusDot><StatusDot tone="pending">{r.abstain} abstained</StatusDot><span className={r.quorum_met ? "text-muted" : "text-[var(--warn)]"}>Quorum {r.quorum_met ? "met" : "not met"}</span></p>
          </div>
        )}

        {(admin && ["discussion", "voting"].includes(p.status)) || (p.status === "discussion" && admin) || (p.status === "voting" && !ended && canVote) || (p.status === "voting" && ended) ? (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
            {admin && ["discussion", "voting"].includes(p.status) && <AnalyseButton id={p.id} again={!!p.analysis} />}
            {p.status === "discussion" && admin && (
              <form action={openVoting} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={p.id} />
                <div><label htmlFor={`hrs-${p.id}`} className={labelCls}>Voting lasts (hours)</label><input id={`hrs-${p.id}`} name="hours" type="number" min={1} max={720} defaultValue={72} className={`${inputCls} w-24`} /></div>
                <button className={btnCls}>Open voting</button>
              </form>
            )}
            {p.status === "voting" && !ended && canVote && (voted ? <p className="text-[13.5px]">You voted <strong>{voted}</strong>.</p> : (
              <form action={castVote} className="flex flex-wrap gap-2">
                <input type="hidden" name="id" value={p.id} />
                <button name="choice" value="for" className={btnCls}>Vote for</button>
                <button name="choice" value="against" className={btnSecondaryCls}>Vote against</button>
                <button name="choice" value="abstain" className={btnSecondaryCls}>Abstain</button>
              </form>
            ))}
            {p.status === "voting" && ended && (
              <form action={finalizeProposal}><input type="hidden" name="id" value={p.id} /><button className={btnCls}>Close voting and count</button></form>
            )}
          </div>
        ) : null}
      </Card>
    );
  };

  return (
    <>
      <PageHeader title="Governance" eyebrow="Operations"
        description="Members discuss and vote on proposals: one vote per member, with a quorum and pass threshold fixed when the proposal is created. The database counts the result, not AI. These are application votes, not on-chain governance."
        badge={<Badge tone="sim" />}
        actions={admin ? <a href="#new" className={btnCls}>New proposal</a> : undefined} />
      <FlashMessages msg={sp.msg} error={sp.error ?? error?.message} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          {list.length === 0 ? <EmptyState title="No proposals yet" action={admin ? <a href="#new" className={btnCls}>Write the first proposal</a> : undefined}>{admin ? "A proposal has a title, a text, a quorum and a pass threshold." : "An owner or administrator creates proposals."}</EmptyState>
            : groups.filter((g) => g.items.length).map((g) => (
              <section key={g.title} className="mb-8 last:mb-0">
                <SectionHeading title={<>{g.title} <span className="font-normal text-muted tabular-nums">{g.items.length}</span></>} description={g.description} />
                <div className="space-y-4">{g.items.map(proposal)}</div>
              </section>
            ))}
        </div>
        <div className="space-y-6">
          {admin && (
            <Card id="new" title="New proposal" description="Starts in discussion. You open voting when it is ready.">
              <form action={createProposal} className="space-y-3">
                <div><label htmlFor="gp-title" className={labelCls}>Title</label><input id="gp-title" name="title" required minLength={3} maxLength={160} className={inputCls} /></div>
                <div><label htmlFor="gp-body" className={labelCls}>What is proposed, and why</label><textarea id="gp-body" name="body" required minLength={10} maxLength={8000} rows={6} className={inputCls} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label htmlFor="gp-q" className={labelCls}>Quorum (votes)</label><input id="gp-q" name="quorum" type="number" min={1} defaultValue={1} className={inputCls} /></div>
                  <div><label htmlFor="gp-p" className={labelCls}>Pass above (% for)</label><input id="gp-p" name="pass_pct" type="number" min={50} max={99} defaultValue={50} className={inputCls} /></div>
                </div>
                <p className="text-[12px] text-muted">The pass threshold is a share of for plus against votes; abstentions count only towards quorum.</p>
                <button className={btnCls}>Create proposal</button>
              </form>
            </Card>
          )}
          <Card title="What a vote does">
            <p className="text-[13px] leading-relaxed text-muted">A passed proposal executes nothing by itself. Any spending that follows still goes through Approvals, with its own limits and a second person.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
