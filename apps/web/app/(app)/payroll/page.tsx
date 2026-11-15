import Link from "next/link";
import { redirect } from "next/navigation";
import type { PayrollItem } from "@qoreops/policy-engine";
import { Badge, Card, EmptyState, FlashMessages, Metric, PageHeader, ShortHash, Source, Steps } from "@/components/ui";
import { PayrollWorkbench } from "@/components/payroll-workbench";
import { formatQor } from "@/lib/approvals";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payroll" };

const TONE: Record<string, "approval" | "live" | "failed" | "pending" | "neutral" | "info"> = { draft: "pending", awaiting_approval: "approval", approved: "info", paid: "live", failed: "failed" };
const LABEL: Record<string, string> = { draft: "DRAFT", awaiting_approval: "AWAITING APPROVAL", approved: "APPROVED IN APP", paid: "PAID", failed: "FAILED" };
const FINANCE = ["owner", "administrator", "finance_manager"];

export default async function Payroll() {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Payroll" description="Contributor payment batches." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Payroll lives in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/payroll");
  if (!s.org) redirect("/onboarding");
  const sb = await supabaseServer();
  const { data, error } = await sb!.from("payroll_batches").select("id,period,total,status,items,created_at").eq("organization_id", s.org.id).order("period", { ascending: false }).limit(24);
  const internal = ["owner", "administrator", "finance_manager", "procurement_manager", "security_reviewer", "auditor"].includes(s.org.role);
  const batches = (data ?? []) as Array<{ id: string; period: string; total: string; status: string; items: PayrollItem[]; created_at: string }>;
  const waiting = batches.filter((b) => b.status === "awaiting_approval");
  const lastApproved = batches.find((b) => b.status === "approved" || b.status === "paid");
  const people = new Set(batches.flatMap((b) => b.items.map((i) => i.address.toLowerCase()))).size;

  return (
    <>
      <PageHeader title="Payroll" eyebrow="Finance"
        description="Prepare a contributor payment batch, compare it with last period, and send it for approval. Payroll uses fixed rules only: no AI prepares or approves it. The approver sees every line, and the batch hash binds each address and amount."
        badge={<Badge tone="sim" />} />
      <FlashMessages error={error?.message} />
      {!internal ? <EmptyState title="Not available for your role">Payroll is visible to organisation staff only.</EmptyState> : (
        <>
          <section aria-label="Payroll overview" className="mb-6 rounded-lg border border-line bg-surface p-5 shadow-card">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
              <Metric label="Waiting for approval" value={waiting.length} sub={waiting.length ? `${formatQor(waiting.reduce((t, b) => t + BigInt(String(b.total).split(".")[0]!), 0n).toString())} QOR` : "nothing pending"} tone={waiting.length ? "warn" : undefined} />
              <Metric label="Last approved period" value={lastApproved?.period ?? "–"} sub={lastApproved ? `${formatQor(lastApproved.total)} QOR, ${lastApproved.items.length} lines` : undefined} />
              <Metric label="Contributors paid in recent batches" value={people} sub="distinct addresses" />
              <Metric label="Batches on record" value={batches.length} sub="last 24 periods" />
            </dl>
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <Card title="New batch" description="Paste one line per contributor, check it, then submit for approval.">
              <PayrollWorkbench canSubmit={FINANCE.includes(s.org.role)} />
            </Card>

            <div className="min-w-0 space-y-6">
              <Card title="Batches" description="Open a batch to see every line." flush>
                {batches.length === 0 ? <p className="py-8 text-center text-[13.5px] text-muted">No batches yet. A second finance member approves each one on <Link href="/approvals">Approvals</Link>.</p> : (
                  <ul className="-mx-5 divide-y divide-line">
                    {batches.map((b) => (
                      <li key={b.id}>
                        <details className="group">
                          <summary className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-2/50">
                            <span className="min-w-0 flex-1"><span className="text-[14px] font-medium tabular-nums">{b.period}</span><span className="block text-[12.5px] text-muted">{b.items.length} line{b.items.length === 1 ? "" : "s"}</span></span>
                            <span className="text-[14px] font-semibold tabular-nums">{formatQor(b.total)} <span className="text-[12px] font-medium text-muted">QOR</span></span>
                            <Badge tone={TONE[b.status] ?? "neutral"}>{LABEL[b.status] ?? b.status.toUpperCase()}</Badge>
                          </summary>
                          <div className="overflow-x-auto px-5 pb-4">
                            <table className="data-table min-w-[28rem]">
                              <thead><tr><th>Contributor</th><th>Address</th><th className="num">QOR</th></tr></thead>
                              <tbody>{b.items.map((i, k) => <tr key={k}><td>{i.name}</td><td><ShortHash value={i.address} /></td><td className="num">{i.amountQor}</td></tr>)}</tbody>
                            </table>
                            {b.status === "awaiting_approval" && <Link href="/approvals" className="mt-3 inline-block text-[13px] font-medium text-accent-text hover:underline">Review on Approvals</Link>}
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="How payroll is approved">
                <Steps compact steps={[
                  { label: "Paste the lines and check", detail: "Addresses, amounts and changes from last period are checked by fixed rules.", state: "step" },
                  { label: "Submit for approval", detail: "The batch hash binds every address and amount.", state: "step" },
                  { label: "A second finance member approves", detail: "They see every line before deciding.", state: "step" },
                ]} />
                <Source>Approved means approved in Verac. No QOR is sent: executing payroll on chain is not wired to the web app.</Source>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
