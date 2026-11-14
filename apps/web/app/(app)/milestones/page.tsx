import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader, btnCls, inputCls } from "@/components/ui";
import { EvidenceForm } from "@/components/milestones/evidence-form";
import { EvidenceReview } from "@/components/milestones/evidence-review";
import { formatQor } from "@/lib/approvals";
import { REVIEWER_ROLES } from "@/lib/seal-server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { requestMilestonePayment, setPayoutAddress } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Milestones" };

const TONE: Record<string, "approval" | "live" | "failed" | "pending" | "neutral"> = { pending: "pending", evidence_submitted: "approval", approved: "live", released: "live", disputed: "failed" };
const LABEL: Record<string, string> = { pending: "WAITING FOR EVIDENCE", evidence_submitted: "EVIDENCE SUBMITTED", approved: "ACCEPTED", released: "RELEASED", disputed: "DISPUTED" };
const FINANCE = ["owner", "administrator", "finance_manager"];

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

  return (
    <>
      <PageHeader title="Milestones" description="After a tender is awarded, the vendor submits sealed evidence for each milestone, in order. Reviewers open it in their own browser and accept or reject it. An accepted milestone can open a payment request that a different finance member must approve." badge={<Badge tone="sim" />} />
      {sp.msg && <p role="status" className="mb-4 rounded-md border border-line bg-surface px-3 py-2 text-sm">{sp.msg}</p>}
      {(sp.error || error) && <p role="alert" className="mb-4 text-sm text-[var(--bad)]">{sp.error ?? error?.message}</p>}

      {isVendor && (
        <Card title="Where should you be paid?" className="mb-4">
          <p className="mb-2 text-sm text-muted">Current payout address: <span className="break-all font-mono text-xs">{me?.payout_address ?? "not set"}</span>. Payment requests can only go to this address, and every change is recorded for the organisation.</p>
          <form action={setPayoutAddress} className="flex flex-wrap items-end gap-2">
            <input name="address" required className={`${inputCls} max-w-md font-mono text-xs`} placeholder="0x…" />
            <button className={btnCls}>Save address</button>
          </form>
        </Card>
      )}

      {list.length === 0 ? <EmptyState title="No milestones yet">Milestones appear when a tender is awarded. See <Link className="underline" href="/procurement">Procurement</Link>.</EmptyState> : (
        <div className="space-y-3">{list.map((m) => (
          <Card key={m.id} title={`${title.get(m.parent_id) ?? "Tender"} · milestone ${m.idx}: ${m.title}`} right={<Badge tone={TONE[m.status] ?? "neutral"}>{LABEL[m.status] ?? m.status}</Badge>}>
            <p className="text-sm">{formatQor(m.amount)} QOR</p>
            {m.review?.decision === "reject" && m.status === "pending" && <p className="mt-2 text-sm text-[var(--bad)]">Last evidence was rejected{m.review.note ? `: ${m.review.note}` : ""}. Submit new evidence.</p>}
            {m.review?.decision === "approve" && m.review.note && <p className="mt-2 text-sm text-muted">Reviewer note: {m.review.note}</p>}
            <div className="mt-3">
              {isVendor && m.status === "pending" && (unlocked(m) ? <EvidenceForm milestoneId={m.id} reviewers={keysBy.get(m.parent_id) ?? []} /> : <p className="text-sm text-muted">Waiting for the previous milestone to be accepted.</p>)}
              {isVendor && m.status === "evidence_submitted" && <p className="text-sm text-muted">Your sealed evidence is with the reviewers.</p>}
              {reviewer && m.status === "evidence_submitted" && <EvidenceReview milestoneId={m.id} orgId={s.org!.id} userId={s.user!.id} />}
              {finance && m.status === "approved" && (
                <form action={requestMilestonePayment} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={m.id} />
                  <div><label className="mb-1 block text-xs text-muted">Approvals needed</label><input name="required" type="number" min={1} max={10} defaultValue={1} className={`${inputCls} w-24`} /></div>
                  <div><label className="mb-1 block text-xs text-muted">Valid for (hours)</label><input name="hours" type="number" min={1} max={168} defaultValue={48} className={`${inputCls} w-24`} /></div>
                  <button className={btnCls}>Request payment</button>
                </form>
              )}
            </div>
          </Card>
        ))}</div>
      )}
      <p className="mt-4 text-xs text-muted">Accepting a milestone and approving its payment are recorded in this app only. No QOR is sent, and nothing is released from the on-chain MilestoneEscrow: that needs a signing step this web app does not have.</p>
    </>
  );
}
