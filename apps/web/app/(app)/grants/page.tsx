import { redirect } from "next/navigation";
import { checkApplication } from "@qoreops/policy-engine";
import { Badge, Card, EmptyState, PageHeader, btnCls, inputCls } from "@/components/ui";
import { ReviewButton } from "@/components/grants/review-button";
import { formatQor } from "@/lib/approvals";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { applyToGrant, awardApplication, closeGrant, createGrant, decideApplication } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grants" };

const TONE: Record<string, "approval" | "live" | "failed" | "pending" | "neutral"> = { submitted: "pending", under_review: "approval", recommended: "approval", awarded: "live", rejected: "failed" };
const ADMIN = ["owner", "administrator"];
const wei = (v: unknown) => String(v).split(".")[0]!;

interface G { id: string; title: string; budget: string; status: string }
interface A {
  id: string; grant_id: string; applicant_user_id: string; applicant_name: string; requested_amount: string; pitch: string | null; status: string; recommended_by: string | null;
  review: { decision?: string; note?: string; ai?: { label?: string; fit?: number; summary?: string; strengths?: string[]; concerns?: string[]; questions_for_applicant?: string[] } } | null;
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <div><p className="text-[12.5px] font-medium text-muted">{title}</p><ul className="list-disc pl-5 text-[13.5px]">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
}

export default async function Grants({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Grants" description="Grant rounds, applications and awards." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Grants live in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/grants");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = (await supabaseServer())!;
  const admin = ADMIN.includes(s.org.role);
  const applicant = s.org.role === "grant_applicant";

  const { data: gd, error } = await sb.from("grants").select("id,title,budget,status").eq("organization_id", s.org.id).order("created_at", { ascending: false });
  const grants = (gd ?? []) as unknown as G[];
  const { data: ad } = await sb.from("grant_applications").select("id,grant_id,applicant_user_id,applicant_name,requested_amount,pitch,status,recommended_by,review").eq("organization_id", s.org.id).order("created_at");
  const apps = (ad ?? []) as unknown as A[];

  return (
    <>
      <PageHeader title="Grants" description="An owner or administrator opens a round with a budget. Applicants apply. One administrator recommends, a different one awards, and the total awarded can never pass the budget. Gemini can give an advisory read of a pitch; it never awards or rejects." badge={<Badge tone="sim" />} />
      {sp.msg && <p role="status" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--live)_25%,transparent)] bg-[var(--live-bg)] px-4 py-3 text-[13.5px]">{sp.msg}</p>}
      {(sp.error || error) && <p role="alert" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-bg)] px-4 py-3 text-[13.5px] text-[var(--bad)]">{sp.error ?? error?.message}</p>}

      {admin && (
        <Card id="create" title="Open a grant round" className="mb-6">
          <form action={createGrant} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1"><label className="mb-1.5 block text-[12.5px] font-medium text-muted">Title</label><input name="title" required minLength={3} maxLength={160} className={inputCls} placeholder="Developer tooling round" /></div>
            <div><label className="mb-1.5 block text-[12.5px] font-medium text-muted">Budget (QOR)</label><input name="budget" required inputMode="decimal" className={`${inputCls} w-32`} placeholder="100" /></div>
            <button className={btnCls}>Open round</button>
          </form>
        </Card>
      )}

      {grants.length === 0 ? <EmptyState title="No grant rounds">{admin ? "Open the first round above." : applicant ? "No round is open for applications right now." : "An owner or administrator opens rounds."}</EmptyState> : (
        <div className="space-y-4">{grants.map((g) => {
          const mine = apps.filter((a) => a.grant_id === g.id);
          const awarded = mine.filter((a) => a.status === "awarded").reduce((t, a) => t + BigInt(wei(a.requested_amount)), 0n);
          const applied = mine.some((a) => a.applicant_user_id === s.user!.id);
          return (
            <Card key={g.id} title={g.title} right={<Badge tone={g.status === "open" ? "live" : "neutral"}>{g.status.toUpperCase()}</Badge>}>
              <p className="text-[13.5px]">Budget {formatQor(wei(g.budget))} QOR · awarded {formatQor(awarded.toString())} QOR · left {formatQor((BigInt(wei(g.budget)) - awarded).toString())} QOR</p>
              {admin && g.status === "open" && <form action={closeGrant} className="mt-2"><input type="hidden" name="id" value={g.id} /><button className="inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-3 text-[12.5px] font-medium text-ink hover:border-line-strong hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50">Close round</button></form>}

              {applicant && g.status === "open" && !applied && (
                <form action={applyToGrant} className="mt-3 space-y-2">
                  <input type="hidden" name="grant" value={g.id} />
                  <div className="flex flex-wrap gap-2">
                    <input name="name" required maxLength={120} className={`${inputCls} max-w-xs`} placeholder="Your name or team" />
                    <input name="amount" required inputMode="decimal" className={`${inputCls} w-36`} placeholder="Amount (QOR)" />
                  </div>
                  <textarea name="pitch" required minLength={20} maxLength={6000} rows={5} className={inputCls} placeholder="What will you build, and why does it fit this round?" />
                  <button className={btnCls}>Apply</button>
                  <p className="text-[12.5px] text-muted">Applications are plain text, not encrypted. Do not paste secrets.</p>
                </form>
              )}

              <div className="mt-3 space-y-3">{mine.map((a) => {
                const check = checkApplication({ requested: wei(a.requested_amount), pitch: a.pitch ?? "", name: a.applicant_name }, { budget: wei(g.budget), awarded: awarded.toString(), otherPitches: mine.filter((o) => o.id !== a.id).map((o) => o.pitch ?? "") });
                const open = ["submitted", "under_review"].includes(a.status);
                const ai = a.review?.ai;
                return (
                  <div key={a.id} className="rounded-lg border border-line bg-surface p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13.5px] font-medium">{a.applicant_name} · asks {formatQor(wei(a.requested_amount))} QOR</p>
                      <Badge tone={TONE[a.status] ?? "neutral"}>{a.status.replace("_", " ").toUpperCase()}</Badge>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-[13.5px]">{a.pitch}</p>
                    {admin && check.flags.length > 0 && (
                      <ul className="mt-2 space-y-1 text-[13.5px]">{check.flags.map((f) => <li key={f.code} className={f.blocking ? "text-[var(--bad)]" : "text-muted"}>{f.blocking ? "Blocking: " : "Note: "}{f.message}</li>)}</ul>
                    )}
                    {ai?.summary && (
                      <div className="mt-3 space-y-2 rounded-md border border-line p-3">
                        <Badge tone="neutral">{ai.label ?? "AI REVIEW"}</Badge>
                        <p className="text-[13.5px]">Fit {ai.fit}/10. {ai.summary}</p>
                        <List title="Strengths" items={ai.strengths} />
                        <List title="Concerns" items={ai.concerns} />
                        <List title="Questions for the applicant" items={ai.questions_for_applicant} />
                      </div>
                    )}
                    {a.review?.decision && <p className="mt-2 text-[13.5px] text-muted">Decision: {a.review.decision}{a.review.note ? ` (${a.review.note})` : ""}</p>}
                    {admin && (open || a.status === "recommended") && check.aiEligible && <div className="mt-3"><ReviewButton id={a.id} again={!!ai} /></div>}
                    {admin && open && (
                      <form action={decideApplication} className="mt-3 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={a.id} />
                        <input name="note" required minLength={5} maxLength={500} className={`${inputCls} max-w-sm`} placeholder="Reason for the decision" />
                        <button name="decision" value="recommend" className={btnCls}>Recommend</button>
                        <button name="decision" value="reject" className="inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-line bg-surface px-3.5 text-[13.5px] font-medium text-ink shadow-sm transition-[background-color,border-color] hover:border-line-strong hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50">Reject</button>
                      </form>
                    )}
                    {admin && a.status === "recommended" && (a.recommended_by === s.user!.id
                      ? <p className="mt-3 text-[13.5px] text-muted">You recommended this application, so a different administrator must award it.</p>
                      : (
                        <form action={awardApplication} className="mt-3 flex flex-wrap items-end gap-2">
                          <input type="hidden" name="id" value={a.id} />
                          <div><label className="mb-1.5 block text-[12.5px] font-medium text-muted">Equal milestones</label><input name="count" type="number" min={1} max={10} defaultValue={2} className={`${inputCls} w-24`} /></div>
                          <button className={btnCls}>Award</button>
                        </form>
                      ))}
                    {a.status === "awarded" && <p className="mt-2 text-[13.5px] text-muted">Awarded. Milestones exist, but evidence and payment for grant milestones are not built yet (PENDING).</p>}
                  </div>
                );
              })}</div>
            </Card>
          );
        })}</div>
      )}
      <p className="mt-4 text-[12.5px] text-muted">Awards are recorded in this app only. No QOR is sent and no on-chain escrow is created.</p>
    </>
  );
}
