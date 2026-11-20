import { cloneElement } from "react";
import Link from "next/link";
import { Bot, Receipt } from "lucide-react";
import { Badge, Card, EmptyState, FlashMessages, PageHeader, SectionHeading, ShortHash, btnCls, btnSecondaryCls, inputCls, labelCls, relTime } from "@/components/ui";
import { Panel } from "@/components/ui-client";
import { InvoiceChecker } from "@/components/invoices/checker";
import { formatQor } from "@/lib/approvals";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { recordInvoice, resetDemo, saveVendor } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bills and Invoices" };

const STATUS: Record<string, { tone: "pending" | "approval" | "info" | "live" | "failed"; text: string }> = {
  received: { tone: "pending", text: "RECEIVED" }, held: { tone: "approval", text: "HELD" }, approved: { tone: "info", text: "APPROVED" }, paid: { tone: "live", text: "PAID" }, rejected: { tone: "failed", text: "REJECTED" },
};
const FINANCE = ["owner", "administrator", "finance_manager"];

interface Inv { id: string; invoice_number: string; amount: string; recipient: string; status: string; due_date: string | null; vendor_id: string | null; milestone_id: string | null; transaction_id: string | null; is_demo: boolean; created_at: string }

export default async function Invoices({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  const header = <PageHeader title="Bills and Invoices" eyebrow="Finance" description="Record contractor invoices against their vendor and milestone, then ask Verac's agents to review them. Fixed rules decide whether an invoice is eligible, held or rejected; AI only explains." badge={<Badge tone="neutral">RULES DECIDE</Badge>} />;
  const checker = <><SectionHeading title="Quick check" description="Try the invoice rules on any invoice. Nothing is saved." /><InvoiceChecker /></>;
  if (!s.configured || !s.user || !s.org) return <>{header}{checker}</>;

  const sb = (await supabaseServer())!;
  const finance = FINANCE.includes(s.org.role);
  const admin = ["owner", "administrator"].includes(s.org.role);
  const [inv, ven, ms] = await Promise.all([
    sb.from("invoices").select("id,invoice_number,amount::text,recipient,status,due_date,vendor_id,milestone_id,transaction_id,is_demo,created_at").eq("organization_id", s.org.id).order("created_at", { ascending: false }).limit(100),
    sb.from("vendors").select("id,name,verified,payout_address,is_demo").eq("organization_id", s.org.id).order("name"),
    sb.from("milestones").select("id,idx,title,status,amount::text,parent_id").eq("organization_id", s.org.id).limit(200),
  ]);
  const invoices = (inv.data ?? []) as unknown as Inv[];
  const vendors = (ven.data ?? []) as Array<{ id: string; name: string; verified: boolean; payout_address: string | null; is_demo: boolean }>;
  const milestones = (ms.data ?? []) as Array<{ id: string; idx: number; title: string; status: string; amount: string }>;
  const vName = new Map(vendors.map((v) => [v.id, v]));
  const mName = new Map(milestones.map((m) => [m.id, m]));
  const open = invoices.filter((i) => ["received", "held", "approved"].includes(i.status) && !i.transaction_id).length;

  return (
    <>
      {cloneElement(header, { actions: finance ? <>{admin && invoices.length > 0 && <a href="#demo" className={btnSecondaryCls}>Demo data</a>}<a href="#vendors" className={btnSecondaryCls}>Vendors</a><a href="#record" className={btnCls}>Record invoice</a></> : undefined })}
      <FlashMessages msg={sp.msg} error={sp.error ?? inv.error?.message} />

      {open > 0 && finance && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-accent-soft px-5 py-4">
          <p className="text-[14px]"><span className="font-semibold">{open} outstanding invoice{open === 1 ? "" : "s"}.</span> <span className="text-muted">Let the agents check invoices, milestones, recipients and limits, and prepare what is eligible.</span></p>
          <Link href={`/command-center?instruction=${encodeURIComponent(`Review our ${open} outstanding contractor invoices, check whether their milestones were approved, flag anything suspicious, and prepare eligible payments.`)}#workflow`} className={btnCls}><Bot size={15} aria-hidden />Review with agents</Link>
        </div>
      )}

      <>
        <Card icon={Receipt} tile="orange" title="Recorded invoices" description="Linked to a vendor and a milestone. An invoice is marked paid only when its payment is confirmed on chain." flush>
          {invoices.length === 0 ? (
            <div className="py-6"><EmptyState title="No invoices recorded yet" action={admin ? <form action={resetDemo}><button className={btnSecondaryCls}>Load the three-invoice demo</button></form> : undefined}>Record one on the right{admin ? ", or load the demo: three synthetic invoices (one eligible, one waiting for its milestone, one with a suspicious payout address), clearly marked DEMO" : ""}.</EmptyState></div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="data-table min-w-[44rem] [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5">
                <thead><tr><th>Invoice</th><th>Vendor</th><th>Milestone</th><th className="num">QOR</th><th>Pay to</th><th>Status</th></tr></thead>
                <tbody>{invoices.map((i) => {
                  const v = i.vendor_id ? vName.get(i.vendor_id) : undefined;
                  const m = i.milestone_id ? mName.get(i.milestone_id) : undefined;
                  const st = STATUS[i.status] ?? { tone: "pending" as const, text: i.status.toUpperCase() };
                  return (
                    <tr key={i.id}>
                      <td><p className="font-medium">{i.invoice_number}</p><p className="text-[12px] text-muted">{relTime(i.created_at)}{i.due_date ? ` · due ${i.due_date}` : ""}{i.is_demo ? " · demo" : ""}</p></td>
                      <td className="text-[13px]">{v?.name ?? <span className="text-muted">none</span>}{v && !v.verified && <span className="block text-[11.5px] text-[var(--warn)]">not verified</span>}</td>
                      <td className="text-[13px]">{m ? <Link href="/milestones" className="hover:underline">{m.idx}. {m.title}</Link> : <span className="text-muted">none</span>}{m && <span className="block text-[11.5px] text-muted">{m.status.replace("_", " ")}</span>}</td>
                      <td className="num">{formatQor(i.amount)}</td>
                      <td><ShortHash value={i.recipient} />{v?.payout_address && v.payout_address.toLowerCase() !== i.recipient.toLowerCase() && <span className="block text-[11.5px] text-[var(--bad)]">differs from vendor record</span>}</td>
                      <td><Badge tone={st.tone}>{st.text}</Badge>{i.transaction_id && <Link href="/approvals" className="mt-1 block text-[12px] text-accent-text hover:underline">payment request</Link>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </Card>

        <>
          {finance && (
            <Panel id="record" title="Record an invoice" description="Exactly what the contractor sent. Agents compare it with the vendor record and milestone.">
              <form action={recordInvoice} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label htmlFor="iv-n" className={labelCls}>Invoice number</label><input id="iv-n" name="number" required maxLength={60} className={inputCls} /></div>
                  <div><label htmlFor="iv-a" className={labelCls}>Amount (QOR)</label><input id="iv-a" name="amount" required inputMode="decimal" className={inputCls} /></div>
                </div>
                <div><label htmlFor="iv-v" className={labelCls}>Vendor</label><select id="iv-v" name="vendor" className={inputCls} defaultValue=""><option value="">No vendor record</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.verified ? "" : " (not verified)"}</option>)}</select></div>
                <div><label htmlFor="iv-m" className={labelCls}>Milestone it bills for</label><select id="iv-m" name="milestone" className={inputCls} defaultValue=""><option value="">None</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.idx}. {m.title} ({formatQor(m.amount)} QOR, {m.status.replace("_", " ")})</option>)}</select></div>
                <div><label htmlFor="iv-r" className={labelCls}>Pay to (as written on the invoice)</label><input id="iv-r" name="recipient" required pattern="0x[0-9a-fA-F]{40}" className={`${inputCls} font-mono text-[12.5px]`} placeholder="0x…" spellCheck={false} autoComplete="off" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label htmlFor="iv-d" className={labelCls}>Invoice date</label><input id="iv-d" name="invoiceDate" type="date" className={inputCls} /></div>
                  <div><label htmlFor="iv-due" className={labelCls}>Due date</label><input id="iv-due" name="dueDate" type="date" className={inputCls} /></div>
                </div>
                <div><label htmlFor="iv-notes" className={labelCls}>Notes on the invoice</label><textarea id="iv-notes" name="notes" maxLength={1000} rows={2} className={inputCls} /></div>
                <button className={btnCls}>Record invoice</button>
                <p className="text-[12px] text-muted">Invoice text is untrusted. If it contains instructions, agents treat them as a warning sign, never as commands.</p>
              </form>
            </Panel>
          )}
          {finance && (
            <Panel id="vendors" title="Vendors" description="The approved payout address on file is what invoices are checked against.">
              {vendors.length > 0 && <ul className="mb-4 space-y-2 text-[13px]">{vendors.map((v) => <li key={v.id} className="flex items-center justify-between gap-2"><span className="min-w-0 truncate">{v.name}{v.is_demo ? <span className="text-muted"> · demo</span> : ""}</span>{v.payout_address ? <ShortHash value={v.payout_address} /> : <span className="text-muted">no payout</span>}</li>)}</ul>}
              <form action={saveVendor} className="space-y-3 border-t border-line pt-4">
                <div><label htmlFor="vd-n" className={labelCls}>New vendor name</label><input id="vd-n" name="name" required maxLength={120} className={inputCls} /></div>
                <div><label htmlFor="vd-p" className={labelCls}>Approved payout address</label><input id="vd-p" name="payout" pattern="0x[0-9a-fA-F]{40}" className={`${inputCls} font-mono text-[12.5px]`} placeholder="0x…" spellCheck={false} autoComplete="off" /></div>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="verified" className="size-4 accent-[var(--accent)]" />Payout address confirmed with the vendor</label>
                <button className={btnSecondaryCls}>Save vendor</button>
              </form>
            </Panel>
          )}
          {admin && invoices.length > 0 && (
            <Panel id="demo" title="Demo data" description="Three synthetic DEMO-* invoices: one eligible, one waiting for its milestone, one with a suspicious payout address.">
              <form action={resetDemo}><button className={`${btnSecondaryCls} w-full`}>Reset and load a fresh demo</button></form>
              <p className="mt-2 text-[12px] text-muted">Replaces the open DEMO-* invoices with a fresh set (invoice A is 1.25 QOR). Demo invoices already linked to a payment request are kept, as part of the record.</p>
            </Panel>
          )}
        </>
      </>

      <div className="mt-10">{checker}</div>
    </>
  );
}
