import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { PayrollWorkbench } from "@/components/payroll-workbench";
import { formatQor } from "@/lib/approvals";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payroll" };

const TONE: Record<string, "approval" | "live" | "failed" | "pending" | "neutral"> = { draft: "pending", awaiting_approval: "approval", approved: "live", paid: "live", failed: "failed" };
const FINANCE = ["owner", "administrator", "finance_manager"];

export default async function Payroll() {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Payroll" description="Contributor payment batches." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Payroll lives in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/payroll");
  if (!s.org) redirect("/onboarding");
  const sb = await supabaseServer();
  const { data, error } = await sb!.from("payroll_batches").select("id,period,total,status,items,created_at").eq("organization_id", s.org.id).order("period", { ascending: false }).limit(24);
  const internal = ["owner", "administrator", "finance_manager", "procurement_manager", "security_reviewer", "auditor"].includes(s.org.role);
  return (
    <>
      <PageHeader title="Payroll" description="Prepare a contributor payment batch, check it against last period, and send it for approval. Everything here is fixed rules: no AI prepares or approves payroll. The approver sees every line, and the batch hash binds each address and amount." badge={<Badge tone="sim" />} />
      {error && <p role="alert" className="mb-4 text-sm text-[var(--fail-text)]">{error.message}</p>}
      {!internal ? <EmptyState title="Not available for your role">Payroll is visible to organisation staff only.</EmptyState> : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3"><Card title="New batch"><PayrollWorkbench canSubmit={FINANCE.includes(s.org.role)} /></Card></div>
          <div className="lg:col-span-2">
            {!data || data.length === 0 ? <EmptyState title="No batches yet">Check a batch and submit it for approval. A second finance member must approve it on the <Link className="underline" href="/approvals">Approvals</Link> page.</EmptyState> : (
              <Card title="Batches">
                <ul className="divide-y divide-line text-sm">{data.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span><span className="font-medium">{b.period}</span> <span className="text-xs text-text-2">{(b.items as unknown[]).length} lines · {formatQor(b.total)} QOR</span></span>
                    <Badge tone={TONE[b.status] ?? "neutral"}>{b.status.replace("_", " ").toUpperCase()}</Badge>
                  </li>
                ))}</ul>
                <p className="mt-3 text-xs text-text-2">Approved means approved in this app. No QOR has been sent: executing payroll on chain is not wired to the web app.</p>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
