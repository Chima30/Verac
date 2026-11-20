import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, FlashMessages, Notice, PageHeader, btnCls, btnSecondaryCls, fmtUtc, inputCls, labelCls, relTime } from "@/components/ui";
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
  return <div><p className="text-[12.5px] font-medium text-muted">{title}</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13.5px]">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
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

  const { data: ms } = await sb.from("milestones").select("id,idx,title,amount::text,status,parent_id").eq("organization_id", s.org.id).eq("parent_type", "procurement");
  const msById = new Map((ms ?? []).map((m) => [m.id as string, m]));
  const openable = (ms ?? []).filter((m) => OPENABLE.includes(m.status as string));

  const openCount = list.filter((d) => d.status !== "resolved").length;
  const sorted = [...list].sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved"));

  return (
    <>
      <PageHeader title="Disputes" eyebrow="Operations"
        description="The awarded vendor or a procurement reviewer can dispute a milestone, which freezes it. An owner or administrator who did not open the dispute then decides: accept the work, or send it back for new evidence."
        badge={<Badge tone="sim" />}
        meta={<><span><strong className="font-semibold text-ink">{openCount}</strong> open</span><span><strong className="font-semibold text-ink">{list.length - openCount}</strong> resolved</span></>}
        actions={canOpen && openable.length > 0 ? <a href="#open" className={btnCls}>Open a dispute</a> : undefined} />
      <FlashMessages msg={sp.msg} error={sp.error ?? error?.message} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {list.length === 0 ? <EmptyState title="Nothing is in dispute">When a vendor and a reviewer disagree about a milestone, either can open a case here. The milestone is frozen until it is resolved.</EmptyState> : sorted.map((d) => {
            const m = msById.get(d.milestone_id);
            const mine = notes.filter((n) => n.dispute_id === d.id);
            const open = d.status !== "resolved";
            return (
              <Card key={d.id} title={m ? `Milestone ${m.idx as number}: ${m.title as string}` : "Milestone"}
                description={<>Opened {relTime(d.created_at)}{m ? <> · {formatQor(String(m.amount))} QOR · milestone is <span className="font-medium">{String(m.status).replace("_", " ")}</span></> : null}</>}
                right={<Badge tone={open ? "approval" : "neutral"}>{open ? (d.status === "under_review" ? "UNDER REVIEW" : "OPEN") : "RESOLVED"}</Badge>}>
                {d.reason && <p className="rounded-md bg-surface-2/60 p-3 text-[13.5px] leading-relaxed"><span className="font-medium">Why it was opened: </span>{d.reason}</p>}

                <h3 className="mt-5 text-[12.5px] font-medium text-muted">Statements, oldest first</h3>
                {mine.length === 0 ? <p className="mt-1 text-[13px] text-muted">No statements yet.</p> : (
                  <ol className="relative mt-3 space-y-4 border-l border-line pl-5">
                    {mine.map((n, i) => (
                      <li key={i} className="relative">
                        <span aria-hidden className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-[var(--subtle)]" />
                        <p className="text-[12px] text-muted"><span className="font-medium capitalize text-ink">{n.author_role.replaceAll("_", " ")}</span> · {fmtUtc(n.created_at)}</p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">{n.body}</p>
                      </li>
                    ))}
                  </ol>
                )}

                {d.summary?.summary && (
                  <div className="mt-5 space-y-3 rounded-lg border border-[color-mix(in_srgb,var(--sim)_25%,transparent)] bg-[var(--sim-bg)]/50 p-4">
                    <div className="flex flex-wrap items-center gap-2"><Badge tone="sim">{d.summary.label ?? "AI SUMMARY"}</Badge><span className="text-[12.5px] text-muted">Advice only. A person decides.</span></div>
                    <p className="text-[13.5px]">{d.summary.summary}</p>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2"><List title="Agreed facts" items={d.summary.agreed_facts} /><List title="Points of disagreement" items={d.summary.points_of_disagreement} /></div>
                    <List title="Questions for the resolver" items={d.summary.questions_for_resolver} />
                  </div>
                )}

                {d.resolution && <Notice tone="neutral" className="mt-5" title={d.resolution.outcome === "accept_work" ? "Resolved: work accepted" : "Resolved: sent back for new evidence"}>{d.resolution.note}</Notice>}

                {open && (
                  <div className="mt-5 space-y-4 border-t border-line pt-4">
                    {admin && <SummariseButton id={d.id} again={!!d.summary} />}
                    <form action={addNote} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={d.id} />
                      <div className="min-w-[14rem] flex-1"><label htmlFor={`st-${d.id}`} className={labelCls}>Add a statement</label><input id={`st-${d.id}`} name="body" required maxLength={2000} className={inputCls} /></div>
                      <button className={btnSecondaryCls}>Add</button>
                    </form>
                    {admin && (
                      d.opened_by === s.user!.id ? <Notice tone="neutral">You opened this dispute, so someone else must resolve it.</Notice> : (
                        <form action={resolveDispute} className="space-y-2 rounded-lg border border-line bg-surface-2/50 p-3">
                          <input type="hidden" name="id" value={d.id} />
                          <label htmlFor={`res-${d.id}`} className={labelCls}>Decision and reason</label>
                          <input id={`res-${d.id}`} name="note" required minLength={5} maxLength={1000} className={inputCls} placeholder="Why you decided this way" />
                          <div className="flex flex-wrap gap-2">
                            <button name="outcome" value="accept_work" className={btnCls}>Accept the work</button>
                            <button name="outcome" value="reject_work" className={btnSecondaryCls}>Send back for new evidence</button>
                          </div>
                        </form>
                      )
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <div className="space-y-6">
          {canOpen && (
            <Card id="open" title="Open a dispute" description="Freezes the milestone until it is resolved.">
              {openable.length === 0 ? <p className="text-[13.5px] text-muted">There is no milestone you can dispute right now.</p> : (
                <form action={openDispute} className="space-y-3">
                  <div><label htmlFor="dp-m" className={labelCls}>Milestone</label>
                    <select id="dp-m" name="milestone" required className={inputCls} defaultValue="">
                      <option value="" disabled>Choose a milestone</option>
                      {openable.map((m) => <option key={m.id as string} value={m.id as string}>Milestone {m.idx as number}: {m.title as string} ({formatQor(String(m.amount))} QOR, {String(m.status).replace("_", " ")})</option>)}
                    </select></div>
                  <div><label htmlFor="dp-r" className={labelCls}>What is the disagreement?</label><textarea id="dp-r" name="reason" required minLength={10} maxLength={2000} rows={4} className={inputCls} /></div>
                  <button className={btnCls}>Open dispute</button>
                  <p className="text-[12.5px] text-muted">Statements are plain text, not encrypted. Do not paste secrets.</p>
                </form>
              )}
            </Card>
          )}
          <Card title="Escrow and money">
            <p className="text-[13px] leading-relaxed text-muted">Resolving a dispute changes the milestone in Verac only. No QOR moves and the on-chain MilestoneEscrow is not called. Accepted work still needs a payment request approved on Approvals.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
