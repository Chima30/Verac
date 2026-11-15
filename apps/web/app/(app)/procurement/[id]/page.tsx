import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, PageHeader, Pipeline, btnCls, inputCls } from "@/components/ui";
import { BidForm } from "@/components/procurement/bid-form";
import { ReviewPanel } from "@/components/procurement/review-panel";
import { formatQor } from "@/lib/approvals";
import { REVIEWER_ROLES } from "@/lib/seal-server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { closeBidding, openTender } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tender" };

const TONE: Record<string, "approval" | "live" | "failed" | "pending" | "neutral" | "info"> = { draft: "pending", open: "info", review: "approval", awarded: "live", closed: "neutral" };
const STAGES = [{ key: "draft", label: "Draft" }, { key: "open", label: "Open for bids" }, { key: "review", label: "Reviewing bids" }, { key: "awarded", label: "Awarded" }, { key: "closed", label: "Closed" }];
const NEXT: Record<string, string> = {
  draft: "Next: a reviewer opens the tender for bids.",
  open: "Next: vendors submit sealed bids; a reviewer closes bidding to release them.",
  review: "Next: reviewers open the bids, check the fixed-rule ranking and AI notes, and award one.",
  awarded: "Next: fund the milestone escrow and track delivery on Milestones.",
  closed: "This tender is closed.",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Tender({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await getSession();
  if (!s.configured || !s.user) redirect("/login?next=/procurement");
  if (!s.org) redirect("/onboarding");
  if (!UUID.test(id)) notFound();
  const sb = (await supabaseServer())!;
  const { data: t } = await sb.from("procurements").select("id,title,requirements,budget,status,bids_open_at,award_bid_id,created_by").eq("id", id).eq("organization_id", s.org.id).maybeSingle();
  if (!t) notFound();

  const reviewer = REVIEWER_ROLES.includes(s.org.role);
  const isVendor = s.org.role === "vendor";
  const budgetQor = Number(formatQor(t.budget));
  const { data: own } = isVendor ? await sb.from("bids").select("id,created_at").eq("procurement_id", t.id).eq("submitted_by", s.user.id).maybeSingle() : { data: null };
  const { count: bidCount } = reviewer ? await sb.from("bids").select("id", { count: "exact", head: true }).eq("procurement_id", t.id) : { count: null };
  const { data: keys } = isVendor && t.status === "open" && !own ? await sb.rpc("procurement_reviewer_keys", { p_proc: t.id }) : { data: null };
  const { data: sealed } = reviewer && ["review", "awarded", "closed"].includes(t.status) ? await sb.rpc("procurement_bids", { p_proc: t.id }) : { data: null };
  const { data: milestones } = t.status === "awarded" ? await sb.from("milestones").select("idx,title,amount,status").eq("parent_id", t.id).eq("parent_type", "procurement").order("idx") : { data: null };

  return (
    <>
      <PageHeader eyebrow={<Link href="/procurement" className="hover:text-ink">← Procurement</Link>} title={t.title} description={`Budget ${formatQor(t.budget)} QOR${t.bids_open_at ? ` · bidding closes ${new Date(t.bids_open_at).toISOString().replace("T", " ").slice(0, 16)} UTC` : ""}`} badge={<Badge tone={TONE[t.status] ?? "neutral"}>{t.status.toUpperCase()}</Badge>} />
      <div className="mb-6"><Pipeline label="Tender stage" stages={STAGES} current={t.status} /><p className="mt-2 text-[13px] text-muted">{NEXT[t.status]}</p></div>
      {sp.error && <p role="alert" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-bg)] px-4 py-3 text-[13.5px] text-[var(--bad)]">{sp.error}</p>}
      <div className="space-y-4">
        <Card title="Requirements"><p className="whitespace-pre-wrap text-[13.5px]">{t.requirements}</p></Card>

        {reviewer && t.status === "draft" && (
          <Card title="Open for bids">
            <form action={openTender} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={t.id} />
              <div><label htmlFor="deadline" className="mb-1.5 block text-[12.5px] font-medium text-muted">Bidding closes (optional)</label><input id="deadline" name="deadline" type="datetime-local" className={inputCls} /></div>
              <button className={btnCls}>Open tender</button>
            </form>
            <p className="mt-2 text-[12.5px] text-muted">You need a published reading key first (Procurement page). Vendors cannot see a draft.</p>
          </Card>
        )}
        {reviewer && t.status === "open" && (
          <Card title="Bidding" right={<Badge tone="sim">{bidCount ?? 0} SEALED BID{bidCount === 1 ? "" : "S"}</Badge>}>
            <p className="mb-3 text-[13.5px] text-muted">Bids are ciphertext. Closing bidding releases them to reviewers, who open them with their own reading keys. Closing cannot be undone. Closing early is allowed and is recorded in the audit log.</p>
            <form action={closeBidding}><input type="hidden" name="id" value={t.id} /><button className={btnCls} disabled={!bidCount}>Close bidding</button></form>
          </Card>
        )}
        {reviewer && sealed && (
          <Card title="Bids and evaluation">
            <ReviewPanel tenderId={t.id} orgId={s.org.id} userId={s.user.id} requirements={t.requirements ?? ""} budgetQor={budgetQor} status={t.status} awardBidId={t.award_bid_id} bids={sealed} />
          </Card>
        )}
        {milestones && milestones.length > 0 && (
          <Card title="Milestone plan" right={<Badge tone="pending">ESCROW NOT FUNDED FROM THIS APP</Badge>}>
            <ul className="divide-y divide-line text-[13.5px]">{milestones.map((m) => <li key={m.idx} className="flex justify-between py-2"><span>{m.idx}. {m.title}</span><span>{formatQor(m.amount)} QOR · {m.status}</span></li>)}</ul>
            <p className="mt-3 text-[12.5px] text-muted">The plan is recorded. Funding the escrow and releasing milestones on chain still need a signing step that is not wired to the web app. The deployed MilestoneEscrow contract and a real testnet run are on the Live Proof page.</p>
          </Card>
        )}

        {isVendor && (
          <Card title="Your bid">
            {own ? <p className="text-[13.5px]">You submitted a sealed bid on {new Date(own.created_at).toISOString().slice(0, 10)}. <Badge tone="live">SEALED</Badge> It can only be read by the organisation&apos;s reviewers after bidding closes.</p>
              : t.status !== "open" ? <p className="text-[13.5px] text-muted">This tender is not open for bids.</p>
              : <BidForm tenderId={t.id} reviewers={(keys ?? []) as Array<{ user_id: string; mlkem_public: string; x25519_public: string }>} budgetQor={formatQor(t.budget)} />}
          </Card>
        )}
        {!reviewer && !isVendor && <p className="text-[13.5px] text-muted">Your role ({s.org.role}) can view this tender but not bid on it or open bids.</p>}
      </div>
    </>
  );
}
