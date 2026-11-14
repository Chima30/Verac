import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader, btnCls, inputCls } from "@/components/ui";
import { ReviewerKey } from "@/components/procurement/reviewer-key";
import { formatQor } from "@/lib/approvals";
import { keyFingerprint, REVIEWER_ROLES } from "@/lib/seal-server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { createTender } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Procurement" };

const TONE: Record<string, "approval" | "live" | "failed" | "pending" | "neutral"> = { draft: "pending", open: "approval", review: "neutral", awarded: "live", closed: "failed" };

export default async function Procurement({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Procurement" description="Tenders and sealed bids." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Procurement lives in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/procurement");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = await supabaseServer();
  const reviewer = REVIEWER_ROLES.includes(s.org.role);
  const { data: tenders, error } = await sb!.from("procurements").select("id,title,status,budget,bids_open_at,created_at").eq("organization_id", s.org.id).order("created_at", { ascending: false }).limit(50);
  let published: string | null = null;
  if (reviewer) {
    const { data } = await sb!.from("org_seal_keys").select("mlkem_public,x25519_public").eq("organization_id", s.org.id).eq("user_id", s.user.id).maybeSingle();
    if (data) published = keyFingerprint(data.mlkem_public, data.x25519_public);
  }
  return (
    <>
      <PageHeader title="Procurement" description="Run a tender: vendors seal their bids so nobody can read them until bidding closes, reviewers open them in their own browser, fixed rules check and rank them, and a person awards the winner." badge={<Badge tone="sim" />} />
      {(sp.error || error) && <p role="alert" className="mb-4 text-sm text-[var(--bad)]">{sp.error ?? error?.message}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {!tenders || tenders.length === 0 ? <EmptyState title="No tenders yet">{reviewer ? "Create a tender on the right. First create and publish your reading key below it, so vendors can seal bids to you." : "Nothing is open for bids right now."}</EmptyState> : (
            <Card title={`${tenders.length} tender${tenders.length === 1 ? "" : "s"}`}>
              <ul className="divide-y divide-line text-sm">{tenders.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span><Link className="font-medium underline" href={`/procurement/${t.id}`}>{t.title}</Link> <span className="text-xs text-muted">budget {formatQor(t.budget)} QOR</span></span>
                  <Badge tone={TONE[t.status] ?? "neutral"}>{t.status.toUpperCase()}</Badge>
                </li>
              ))}</ul>
            </Card>
          )}
        </div>
        {reviewer ? (
          <div className="space-y-4">
            <Card title="Your reading key"><ReviewerKey orgId={s.org.id} userId={s.user.id} publishedFingerprint={published} /></Card>
            <Card title="Create a tender">
              <form action={createTender} className="space-y-3">
                <div><label htmlFor="title" className="mb-1 block text-xs text-muted">Title</label><input id="title" name="title" required minLength={3} maxLength={160} className={inputCls} /></div>
                <div><label htmlFor="requirements" className="mb-1 block text-xs text-muted">Requirements (shown to vendors)</label><textarea id="requirements" name="requirements" required minLength={10} maxLength={3000} rows={4} className={inputCls} /></div>
                <div><label htmlFor="budget" className="mb-1 block text-xs text-muted">Budget (QOR)</label><input id="budget" name="budget" required inputMode="decimal" className={inputCls} /></div>
                <button className={btnCls} type="submit">Create draft</button>
              </form>
            </Card>
          </div>
        ) : <Card title="Vendors"><p className="text-sm text-muted">Open a tender to read its requirements and submit a sealed bid. Only organisation reviewers can open bids, and only after bidding closes.</p></Card>}
      </div>
    </>
  );
}
