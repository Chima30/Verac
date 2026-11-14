import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader, btnCls, inputCls } from "@/components/ui";
import { SummariseButton } from "@/components/disputes/summarise-button";
import { formatQor } from "@/lib/approvals";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { addNote, openDispute, resolveDispute } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disputes" };

const OPENABLE = ["pending", "evidence_submitted", "approved"];
const REVIEW = ["owner", "administrator", "procurement_manager"];

interface D {
  id: string; milestone_id: string; opened_by: string; status: string; reason: string | null; created_at: string;
  summary: { label?: string; summary?: string; agreed_facts?: string[]; points_of_disagreement?: string[]; questions_for_resolver?: string[] } | null;
  resolution: { outcome?: string; note?: string } | null;
}
interface N { dispute_id: string; author_role: string; body: string; created_at: string }

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <div><p className="text-xs font-medium text-text-2">{title}</p><ul className="list-disc pl-5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
}

export default async function Disputes({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Disputes" description="Disagreements over milestones." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Disputes live in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/disputes");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = (await supabaseServer())!;
  const admin = ["owner", "administrator"].includes(s.org.role);
  const canOpen = s.org.role === "vendor" || REVIEW.includes(s.org.role);

  const { data, error } = await sb.from("disputes").select("id,milestone_id,opened_by,status,reason,created_at,summary,resolution").eq("organization_id", s.org.id).order("created_at", { ascending: false });
  const list = (data ?? []) as unknown as D[];
  const ids = list.map((d) => d.id);
  const { data: nd } = ids.length ? await sb.from("dispute_notes").select("dispute_id,author_role,body,created_at").in("dispute_id", ids).order("created_at") : { data: [] };
  const notes = (nd ?? []) as unknown as N[];

  const { data: ms } = await sb.from("milestones").select("id,idx,title,amount,status,parent_id").eq("organization_id", s.org.id).eq("parent_type", "procurement");
  const msById = new Map((ms ?? []).map((m) => [m.id as string, m]));
  const openable = (ms ?? []).filter((m) => OPENABLE.includes(m.status as string));

  return (
    <>
      <PageHeader title="Disputes" description="The awarded vendor or a procurement reviewer can dispute a milestone. That freezes it. An owner or administrator who did not open the dispute then decides whether the work is accepted or sent back for new evidence." badge={<Badge tone="sim" />} />
      {sp.msg && <p role="status" className="mb-4 rounded-md border border-line bg-panel px-3 py-2 text-sm">{sp.msg}</p>}
      {(sp.error || error) && <p role="alert" className="mb-4 text-sm text-[var(--fail-text)]">{sp.error ?? error?.message}</p>}

      {canOpen && (
        <Card title="Open a dispute" className="mb-4">
          {openable.length === 0 ? <p className="text-sm text-text-2">There is no milestone you can dispute right now.</p> : (
            <form action={openDispute} className="space-y-2">
              <select name="milestone" required className={inputCls} defaultValue="">
                <option value="" disabled>Choose a milestone</option>
                {openable.map((m) => <option key={m.id as string} value={m.id as string}>Milestone {m.idx as number}: {m.title as string} ({formatQor(String(m.amount))} QOR, {String(m.status).replace("_", " ")})</option>)}
              </select>
              <textarea name="reason" required minLength={10} maxLength={2000} rows={3} className={inputCls} placeholder="What is the disagreement?" />
              <button className={btnCls}>Open dispute</button>
              <p className="text-xs text-text-2">Statements here are plain text, not encrypted. Do not paste secrets.</p>
            </form>
          )}
        </Card>
      )}

      {list.length === 0 ? <EmptyState title="No disputes">Nothing is in dispute.</EmptyState> : (
        <div className="space-y-3">{list.map((d) => {
          const m = msById.get(d.milestone_id);
          const mine = notes.filter((n) => n.dispute_id === d.id);
          const open = d.status !== "resolved";
          return (
            <Card key={d.id} title={m ? `Milestone ${m.idx as number}: ${m.title as string}` : "Milestone"} right={<Badge tone={open ? "approval" : "live"}>{open ? "OPEN" : "RESOLVED"}</Badge>}>
              <ul className="space-y-2">{mine.map((n, i) => (
                <li key={i} className="rounded-md border border-line p-2 text-sm"><span className="text-xs text-text-2">{n.author_role} · {new Date(n.created_at).toUTCString()}</span><p className="whitespace-pre-wrap break-words">{n.body}</p></li>
              ))}</ul>

              {d.summary?.summary && (
                <div className="mt-3 space-y-2 rounded-md border border-line p-3">
                  <Badge tone="neutral">{d.summary.label ?? "AI SUMMARY"}</Badge>
                  <p className="text-sm">{d.summary.summary}</p>
                  <List title="Agreed facts" items={d.summary.agreed_facts} />
                  <List title="Points of disagreement" items={d.summary.points_of_disagreement} />
                  <List title="Questions for the resolver" items={d.summary.questions_for_resolver} />
                </div>
              )}
              {admin && open && <div className="mt-3"><SummariseButton id={d.id} again={!!d.summary} /></div>}

              {open && (
                <form action={addNote} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={d.id} />
                  <input name="body" required maxLength={2000} className={`${inputCls} max-w-xl`} placeholder="Add a statement" />
                  <button className={btnCls}>Add</button>
                </form>
              )}
              {open && admin && (
                d.opened_by === s.user!.id ? <p className="mt-3 text-sm text-text-2">You opened this dispute, so someone else must resolve it.</p> : (
                  <form action={resolveDispute} className="mt-3 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={d.id} />
                    <input name="note" required minLength={5} maxLength={1000} className={`${inputCls} max-w-sm`} placeholder="Reason for the decision" />
                    <button name="outcome" value="accept_work" className={btnCls}>Accept the work</button>
                    <button name="outcome" value="reject_work" className="inline-flex items-center rounded-md border border-line px-3.5 py-2 text-sm hover:bg-[var(--well)]">Send back for new evidence</button>
                  </form>
                )
              )}
              {d.resolution && <p className="mt-3 text-sm">Resolved: <strong>{d.resolution.outcome === "accept_work" ? "work accepted" : "sent back for new evidence"}</strong>. {d.resolution.note}</p>}
            </Card>
          );
        })}</div>
      )}
      <p className="mt-4 text-xs text-text-2">Resolving a dispute changes the milestone in this app only. No QOR moves and the on-chain MilestoneEscrow is not called. Accepted work still needs a payment request approved on the Approvals page.</p>
    </>
  );
}
