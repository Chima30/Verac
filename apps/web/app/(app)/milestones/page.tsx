import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, FlashMessages, Notice, PageHeader, Pipeline, Source, Steps, btnCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { EvidenceForm } from "@/components/milestones/evidence-form";
import { EvidenceReview } from "@/components/milestones/evidence-review";
import { formatQor } from "@/lib/approvals";
import { REVIEWER_ROLES } from "@/lib/seal-server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { requestMilestonePayment, setPayoutAddress } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Milestones" };

const TONE: Record<string, "approval" | "live" | "failed" | "pending" | "neutral" | "info"> = { pending: "pending", evidence_submitted: "approval", approved: "info", released: "live", disputed: "failed" };
const LABEL: Record<string, string> = { pending: "WAITING FOR EVIDENCE", evidence_submitted: "EVIDENCE SUBMITTED", approved: "ACCEPTED", released: "RELEASED", disputed: "DISPUTED" };
const FINANCE = ["owner", "administrator", "finance_manager"];
const STAGES = [{ key: "pending", label: "Waiting for evidence" }, { key: "evidence_submitted", label: "Evidence submitted" }, { key: "approved", label: "Accepted" }, { key: "released", label: "Released" }, { key: "disputed", label: "Disputed" }];

interface Reviewer { user_id: string; mlkem_public: string; x25519_public: string }
interface M { id: string; parent_id: string; idx: number; title: string; amount: string; status: string; review: { decision?: string; note?: string; at?: string } | null }

export default async function Milestones({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Milestones" description="Evidence and acceptance for awarded work." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Milestones live in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/milestones");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = (await supabaseServer())!;
  const reviewer = REVIEWER_ROLES.includes(s.org.role);
  const finance = FINANCE.includes(s.org.role);
  const isVendor = s.org.role === "vendor";

  const { data: ms, error } = await sb.from("milestones").select("id,parent_id,idx,title,amount,status,review").eq("organization_id", s.org.id).eq("parent_type", "procurement").order("parent_id").order("idx");
  const list = (ms ?? []) as unknown as M[];
  const parents = [...new Set(list.map((m) => m.parent_id))];
  const { data: procs } = parents.length ? await sb.from("procurements").select("id,title").in("id", parents) : { data: [] };
  const title = new Map((procs ?? []).map((p) => [p.id, p.title]));
  const { data: me } = isVendor ? await sb.from("vendors").select("payout_address").eq("organization_id", s.org.id).eq("user_id", s.user.id).limit(1).maybeSingle() : { data: null };

  const keysBy = new Map<string, Reviewer[]>();
  if (isVendor) for (const p of parents) { const { data } = await sb.rpc("procurement_reviewer_keys", { p_proc: p }); keysBy.set(p, (data ?? []) as Reviewer[]); }
  const byParent = new Map<string, M[]>();
  for (const m of list) byParent.set(m.parent_id, [...(byParent.get(m.parent_id) ?? []), m]);
  const unlocked = (m: M) => m.idx === 1 || ["approved", "released"].includes(byParent.get(m.parent_id)?.find((x) => x.idx === m.idx - 1)?.status ?? "");

  const counts = list.reduce<Record<string, number>>((c, m) => ({ ...c, [m.status]: (c[m.status] ?? 0) + 1 }), {});
  const next = (m: M): string => {
    if (m.status === "pending") return m.review?.decision === "reject" ? "Evidence was rejected. The vendor submits new evidence." : unlocked(m) ? "Waiting for the vendor's sealed evidence." : "Locked until the previous milestone is accepted.";
    if (m.status === "evidence_submitted") return reviewer ? "Next: open the evidence in your browser and accept or reject it." : "Evidence is with the reviewers.";
    if (m.status === "approved") return finance ? "Next: open a payment request. A different finance member must approve it." : "Accepted. Finance can now request payment.";
    if (m.status === "released") return "Released.";
    return "Disputed. See Disputes.";
  };
  const amt = (v: string) => BigInt(String(v).split(".")[0]!);

  return (
    <>
      <PageHeader title="Milestones" eyebrow="Operations"
        description="After a tender is awarded, the vendor submits sealed evidence for each milestone, in order. Reviewers open it in their own browser and accept or reject it. An accepted milestone can open a payment request that a different finance member must approve."
        badge={<Badge tone="sim" />} />
      <FlashMessages msg={sp.msg} error={sp.error ?? error?.message} />

      {list.length > 0 && <div className="mb-6"><Pipeline label="Milestones by stage" stages={STAGES} counts={counts} /></div>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {list.length === 0 ? <EmptyState title="No milestones yet" action={<Link href="/procurement" className={btnSecondaryCls}>Go to Procurement</Link>}>Milestones appear when a tender is awarded with a milestone plan.</EmptyState> : parents.map((pid) => {
            const items = byParent.get(pid) ?? [];
            const accepted = items.filter((m) => ["approved", "released"].includes(m.status));
            const total = items.reduce((t, m) => t + amt(m.amount), 0n);
            const doneAmt = accepted.reduce((t, m) => t + amt(m.amount), 0n);
            return (
              <Card key={pid} title={<Link href={`/procurement/${pid}`} className="hover:underline">{title.get(pid) ?? "Tender"}</Link>} description={`${accepted.length} of ${items.length} milestones accepted · ${formatQor(doneAmt.toString())} of ${formatQor(total.toString())} QOR`}>
                <div className="flex gap-1" role="img" aria-label={`${accepted.length} of ${items.length} milestones accepted`}>
                  {items.map((m) => <span key={m.id} className={`h-1.5 flex-1 rounded-full ${["approved", "released"].includes(m.status) ? "bg-[var(--live)]" : m.status === "evidence_submitted" ? "bg-[var(--warn)]" : m.status === "disputed" ? "bg-[var(--bad)]" : "bg-surface-3"}`} />)}
                </div>
                <ol className="-mx-5 mt-4 divide-y divide-line border-t border-line">
                  {items.map((m) => (
                    <li key={m.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 gap-3">
                          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold tabular-nums text-muted">{m.idx}</span>
                          <div className="min-w-0"><p className="text-[14px] font-medium">{m.title}</p><p className="mt-0.5 text-[12.5px] text-muted">{next(m)}</p></div>
                        </div>
                        <div className="flex items-center gap-3"><span className="text-[14px] font-semibold tabular-nums">{formatQor(m.amount)} <span className="text-[12px] font-medium text-muted">QOR</span></span><Badge tone={TONE[m.status] ?? "neutral"}>{LABEL[m.status] ?? m.status}</Badge></div>
                      </div>
                      {m.review?.decision === "reject" && m.status === "pending" && <Notice tone="bad" className="mt-3">Last evidence was rejected{m.review.note ? `: ${m.review.note}` : ""}.</Notice>}
                      {m.review?.decision === "approve" && m.review.note && <p className="mt-2 text-[13px] text-muted sm:pl-10">Reviewer note: {m.review.note}</p>}
                      {((isVendor && m.status === "pending" && unlocked(m)) || (reviewer && m.status === "evidence_submitted") || (finance && m.status === "approved")) && (
                        <div className="mt-3 sm:pl-10">
                          {isVendor && m.status === "pending" && unlocked(m) && <EvidenceForm milestoneId={m.id} reviewers={keysBy.get(m.parent_id) ?? []} />}
                          {reviewer && m.status === "evidence_submitted" && <EvidenceReview milestoneId={m.id} orgId={s.org!.id} userId={s.user!.id} />}
                          {finance && m.status === "approved" && (
                            <form action={requestMilestonePayment} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface-2/50 p-3">
                              <input type="hidden" name="id" value={m.id} />
                              <div><label htmlFor={`r-${m.id}`} className={labelCls}>Approvals needed</label><input id={`r-${m.id}`} name="required" type="number" min={1} max={10} defaultValue={1} className={`${inputCls} w-24`} /></div>
                              <div><label htmlFor={`h-${m.id}`} className={labelCls}>Valid for (hours)</label><input id={`h-${m.id}`} name="hours" type="number" min={1} max={168} defaultValue={48} className={`${inputCls} w-24`} /></div>
                              <button className={btnCls}>Request payment</button>
                            </form>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </Card>
            );
          })}
        </div>

        <div className="space-y-6">
          {isVendor && (
            <Card title="Where you are paid" description="Payment requests can only go to this address. Every change is recorded for the organisation.">
              <p className="mb-3 break-all rounded-md bg-surface-2 px-3 py-2 font-mono text-[12.5px]">{me?.payout_address ?? "Not set yet"}</p>
              <form action={setPayoutAddress} className="space-y-2">
                <label htmlFor="payout" className={labelCls}>New payout address</label>
                <input id="payout" name="address" required className={`${inputCls} font-mono text-[12.5px]`} placeholder="0x…" spellCheck={false} autoComplete="off" />
                <button className={btnCls}>Save address</button>
              </form>
            </Card>
          )}
          <Card title="How a milestone is paid">
            <Steps compact steps={[
              { label: "Vendor submits sealed evidence", detail: "Encrypted to the reviewers' reading keys, in order.", state: "step" },
              { label: "A reviewer accepts or rejects", detail: "Opened in the reviewer's own browser.", state: "step" },
              { label: "Finance requests payment", detail: "To the vendor's recorded payout address.", state: "step" },
              { label: "A different finance member approves", detail: "On the Approvals page.", state: "step" },
            ]} />
            <Source>Accepting a milestone and approving its payment are recorded in Verac only. Nothing is released from the on-chain MilestoneEscrow from here; that needs a signing step the web app does not have. A real escrow release is on Live Proof.</Source>
          </Card>
        </div>
      </div>
    </>
  );
}
