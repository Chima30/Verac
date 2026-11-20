import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Badge, Card, EmptyState, HowItWorks, PageHeader, Pipeline, btnCls, btnSecondaryCls, inputCls, relTime } from "@/components/ui";
import { Panel } from "@/components/ui-client";
import { ReviewerKey } from "@/components/procurement/reviewer-key";
import { formatQor } from "@/lib/approvals";
import { keyFingerprint, REVIEWER_ROLES } from "@/lib/seal-server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { createTender } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Procurement" };

const TONE: Record<string, "approval" | "live" | "failed" | "pending" | "neutral" | "info"> = { draft: "pending", open: "info", review: "approval", awarded: "live", closed: "neutral" };
/** The stages the database allows (procurements.status). Funding, delivery and disputes are tracked on Milestones and Disputes. */
const STAGES = [{ key: "draft", label: "Draft" }, { key: "open", label: "Open for bids" }, { key: "review", label: "Reviewing bids" }, { key: "awarded", label: "Awarded" }, { key: "closed", label: "Closed" }];

export default async function Procurement({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Procurement" description="Tenders and sealed bids." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Procurement lives in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/procurement");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = await supabaseServer();
  const reviewer = REVIEWER_ROLES.includes(s.org.role);
  const { data: tenders, error } = await sb!.from("procurements").select("id,title,status,budget::text,bids_open_at,created_at").eq("organization_id", s.org.id).order("created_at", { ascending: false }).limit(50);
  let published: string | null = null;
  if (reviewer) {
    const { data } = await sb!.from("org_seal_keys").select("mlkem_public,x25519_public").eq("organization_id", s.org.id).eq("user_id", s.user.id).maybeSingle();
    if (data) published = keyFingerprint(data.mlkem_public, data.x25519_public);
  }
  return (
    <>
      <PageHeader title="Procurement" description="Run a tender: vendors seal their bids so nobody can read them until bidding closes, reviewers open them in their own browser, fixed rules check and rank them, and a person awards the winner." badge={<Badge tone="sim" />}
        actions={reviewer ? <><a href="#reading-key" className={btnSecondaryCls}>Reading key</a><a href="#create" className={btnCls}>Create tender</a></> : undefined} />
      {reviewer && !published && (
        <a href="#reading-key" className="mb-6 flex items-center gap-3 rounded-lg bg-[var(--warn-bg)] px-4 py-3 text-[14px] text-[var(--warn)] hover:underline">
          <KeyRound size={16} aria-hidden className="shrink-0" /><span className="flex-1">Create your reading key to open sealed bids. It is made in this browser and never sent to the server.</span><span className="label-mono">Create key</span>
        </a>
      )}
      {(sp.error || error) && <p role="alert" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-bg)] px-4 py-3 text-[13.5px] text-[var(--bad)]">{sp.error ?? error?.message}</p>}
      <>
        <div className="space-y-4">
          {!tenders || tenders.length === 0 ? <EmptyState title="No tenders yet">{reviewer ? "Create a tender with the button above. Create your reading key first, so vendors can seal bids to you." : "Nothing is open for bids right now."}</EmptyState> : (
            <>
            <Pipeline label="Tenders by stage" stages={STAGES} counts={tenders.reduce<Record<string, number>>((c, t) => ({ ...c, [t.status]: (c[t.status] ?? 0) + 1 }), {})} />
            <Card title={`${tenders.length} tender${tenders.length === 1 ? "" : "s"}`} description="Budgets are what the organisation set aside, not what has been paid." flush>
              <div className="-mx-5 overflow-x-auto">
                <table className="data-table min-w-[34rem] [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5">
                  <thead><tr><th>Tender</th><th>Stage</th><th className="num">Budget (QOR)</th><th>Bidding closes</th></tr></thead>
                  <tbody>{tenders.map((t) => (
                    <tr key={t.id}>
                      <td><Link className="font-medium hover:underline" href={`/procurement/${t.id}`}>{t.title}</Link><p className="text-[12px] text-muted">created {relTime(t.created_at)}</p></td>
                      <td><Badge tone={TONE[t.status] ?? "neutral"}>{(STAGES.find((x) => x.key === t.status)?.label ?? t.status).toUpperCase()}</Badge></td>
                      <td className="num">{formatQor(t.budget)}</td>
                      <td className="text-[12.5px] text-muted">{t.bids_open_at ? new Date(t.bids_open_at).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "No deadline"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
            </>
          )}
        </div>
        {reviewer ? (
          <>
            <Panel id="reading-key" title="Your reading key" description="Bids are sealed so only people holding a reading key can open them. Download the backup: if you lose the key, everything sealed to it cannot be recovered."><ReviewerKey orgId={s.org.id} userId={s.user.id} publishedFingerprint={published} /></Panel>
            <Panel id="create" title="Create a tender" description="Starts as a draft that vendors cannot see.">
              <form action={createTender} className="space-y-3">
                <div><label htmlFor="title" className="mb-1.5 block text-[12.5px] font-medium text-muted">Title</label><input id="title" name="title" required minLength={3} maxLength={160} className={inputCls} /></div>
                <div><label htmlFor="requirements" className="mb-1.5 block text-[12.5px] font-medium text-muted">Requirements (shown to vendors)</label><textarea id="requirements" name="requirements" required minLength={10} maxLength={3000} rows={4} className={inputCls} /></div>
                <div><label htmlFor="budget" className="mb-1.5 block text-[12.5px] font-medium text-muted">Budget (QOR)</label><input id="budget" name="budget" required inputMode="decimal" className={inputCls} /></div>
                <button className={btnCls} type="submit">Create draft</button>
              </form>
            </Panel>
          </>
        ) : <HowItWorks title="Vendors"><p className="text-[13.5px] text-muted">Open a tender to read its requirements and submit a sealed bid. Only organisation reviewers can open bids, and only after bidding closes.</p></HowItWorks>}
      </>
    </>
  );
}
