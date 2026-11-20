import { redirect } from "next/navigation";
import type { PublicClient } from "viem";
import { Badge, Card, EmptyState, FlashMessages, HowItWorks, Metric, Notice, PageHeader, Source, StatusDot, btnCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { Hash, Panel } from "@/components/ui-client";
import { formatQor } from "@/lib/approvals";
import { ChartCard } from "@/components/charts/chart-card";
import { BarChart } from "@/components/charts/bar-chart";
import { receivablesByMonth } from "@/lib/charts";
import { daysOverdue, effectiveStatus, matchTransfer, summarise, type MatchState, type RevenueRow } from "@/lib/revenue";
import { reader } from "@/lib/server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { markPaid, recordRevenue, voidRecord } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revenue" };

const FINANCE = ["owner", "administrator", "finance_manager"];
const wei = (v: unknown) => String(v).split(".")[0]!;
const STATE_TONE = { issued: "pending", overdue: "failed", paid: "info", void: "neutral" } as const;
const MATCH_LABEL: Record<MatchState, string> = { VERIFIED: "VERIFIED ON TESTNET", NOT_VERIFIED: "NOT VERIFIED", NOT_FOUND: "TRANSACTION NOT FOUND" };

/** Looks each claimed payment up on the chain now. The result is never stored or trusted from the database. */
async function checkPayments(rows: RevenueRow[], treasury: string | null) {
  const out = new Map<string, { state: MatchState; reason: string }>();
  const paid = rows.filter((r) => r.status === "paid" && r.matched_tx_hash).slice(0, 25);
  if (!treasury) { for (const r of paid) out.set(r.id, { state: "NOT_VERIFIED", reason: "No treasury is linked to this organisation, so the payment cannot be checked." }); return { out, error: null as string | null }; }
  try {
    const evm = reader().evm as PublicClient;
    await Promise.all(paid.map(async (r) => {
      const hash = r.matched_tx_hash as `0x${string}`;
      const [tx, receipt] = await Promise.all([evm.getTransaction({ hash }).catch(() => null), evm.getTransactionReceipt({ hash }).catch(() => null)]);
      out.set(r.id, matchTransfer(tx && receipt ? { to: tx.to ?? null, value: tx.value, success: receipt.status === "success" } : null, { to: treasury, amount: BigInt(wei(r.amount)) }));
    }));
    return { out, error: null };
  } catch { return { out, error: "The testnet could not be reached, so payments are shown unchecked." }; }
}

export default async function Revenue({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Revenue" description="Money owed to the organisation." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Revenue records live in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/revenue");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = (await supabaseServer())!;
  const finance = FINANCE.includes(s.org.role);
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await sb.from("revenue_records").select("id,customer,reference,amount::text,due_date,status,matched_tx_hash,description,void_reason").eq("organization_id", s.org.id).order("due_date");
  const rows = (data ?? []) as unknown as Array<RevenueRow & { description: string | null; void_reason: string | null }>;
  const { data: tr } = await sb.from("treasuries").select("vault_address").eq("organization_id", s.org.id).limit(1).maybeSingle();
  const treasury = (tr?.vault_address as string | undefined) ?? null;
  const checks = await checkPayments(rows, treasury);
  const sum = summarise(rows, today);

  const byMonth = receivablesByMonth(rows, (w) => Number(formatQor(w).replace(/,/g, "")));
  const order = { overdue: 0, issued: 1, paid: 2, void: 3 } as const;
  const sorted = [...rows].sort((a, b) => order[effectiveStatus(a, today)] - order[effectiveStatus(b, today)]);
  const verified = [...checks.out.values()].filter((m) => m.state === "VERIFIED").length;
  const unverified = [...checks.out.values()].filter((m) => m.state !== "VERIFIED").length;

  return (
    <>
      <PageHeader title="Revenue" eyebrow="Finance"
        description="Record what customers owe and which on-chain payment settled it. Overdue is worked out from the due date. A payment counts as verified only when this page finds a successful testnet transfer to your treasury for at least the amount owed."
        badge={<Badge tone="sim" />}
        actions={finance ? <a href="#record" className={btnCls}>Record money owed</a> : undefined} />
      <FlashMessages msg={sp.msg} error={sp.error ?? error?.message} />
      {checks.error && <Notice tone="warn" className="mb-6">{checks.error}</Notice>}

      <section aria-label="Receivables overview" className="mb-6 rounded-lg border border-line bg-surface p-5 shadow-card">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
          <Metric label="Outstanding" value={<>{formatQor(sum.outstanding.toString())} <span className="text-[13px] font-medium text-muted">QOR</span></>} />
          <Metric label="Overdue" value={<>{formatQor(sum.overdue.toString())} <span className="text-[13px] font-medium text-muted">QOR</span></>} sub={`${sum.overdueCount} record${sum.overdueCount === 1 ? "" : "s"}`} tone={sum.overdueCount ? "bad" : undefined} />
          <Metric label="Marked paid" value={<>{formatQor(sum.paid.toString())} <span className="text-[13px] font-medium text-muted">QOR</span></>} />
          <Metric label="Payments checked on chain" value={`${verified} verified`} sub={unverified ? `${unverified} could not be verified` : "none failed the check"} tone={unverified ? "warn" : undefined} />
        </dl>
      </section>

      <>
        <div className="min-w-0 space-y-6">
        {byMonth.length > 0 && (
          <ChartCard title="Receivables by due month" description="What customers settled and what is still owed, by the month it falls due."
            footer="From your revenue records. Paid means marked paid in Verac; whether each payment checks out on chain is shown on the record. Void records are left out.">
            <BarChart unit="QOR" caption="By due date, UTC" series={[{ key: "paid", label: "Paid", color: "#c8f6f9" }, { key: "open", label: "Still owed", color: "#bdbbff" }]} data={byMonth.map((b) => ({ key: b.key, label: b.label, values: { paid: b.paid, open: b.outstanding } }))} />
          </ChartCard>
        )}
        <Card title="Receivables" description="Overdue first. Open a record to settle or void it." flush>
          {rows.length === 0 ? <p className="py-8 text-center text-[13.5px] text-muted">{finance ? "No records yet. Record the first one." : "Finance records appear here."}</p> : (
            <ul className="-mx-5 divide-y divide-line">
              {sorted.map((r) => {
                const st = effectiveStatus(r, today);
                const m = checks.out.get(r.id);
                const actionable = finance && (r.status === "issued" || r.status === "overdue");
                return (
                  <li key={r.id}>
                    <details className="group">
                      <summary className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-2/50">
                        <span className="min-w-0 flex-1"><span className="text-[14px] font-medium">{r.customer}</span> <span className="font-mono text-[12px] text-muted">{r.reference}</span>
                          <span className="block text-[12.5px] text-muted">due {r.due_date}{r.description ? ` · ${r.description}` : ""}</span></span>
                        {m && <StatusDot tone={m.state === "VERIFIED" ? "live" : "failed"}>{m.state === "VERIFIED" ? "Verified on chain" : "Not verified"}</StatusDot>}
                        <span className="text-[14px] font-semibold tabular-nums">{formatQor(wei(r.amount))} <span className="text-[12px] font-medium text-muted">QOR</span></span>
                        <Badge tone={STATE_TONE[st]}>{st === "overdue" ? `OVERDUE ${daysOverdue(r.due_date!, today)}D` : st.toUpperCase()}</Badge>
                      </summary>
                      <div className="space-y-3 px-5 pb-4">
                        {r.status === "paid" && r.matched_tx_hash && (
                          <div className="rounded-lg bg-surface-2/60 p-3 text-[13px]">
                            <p className="text-[12px] text-muted">Claimed payment</p>
                            <Hash value={r.matched_tx_hash} href={`https://explore.qore.network/tx/${r.matched_tx_hash}`} />
                            {m ? <p className="mt-2 flex flex-wrap items-center gap-2"><Badge tone={m.state === "VERIFIED" ? "live" : "failed"}>{MATCH_LABEL[m.state]}</Badge><span className="text-muted">{m.reason}</span></p>
                              : <p className="mt-2 text-muted">Not checked: only the first 25 paid records are checked on each visit.</p>}
                          </div>
                        )}
                        {r.status === "void" && <p className="text-[13px] text-muted">Voided: {r.void_reason}</p>}
                        {actionable && (
                          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
                            <form action={markPaid} className="space-y-2 rounded-lg border border-line p-3">
                              <input type="hidden" name="id" value={r.id} />
                              <label htmlFor={`tx-${r.id}`} className={labelCls}>Payment transaction hash</label>
                              <input id={`tx-${r.id}`} name="tx" required className={`${inputCls} font-mono text-[12.5px]`} placeholder="0x…" spellCheck={false} autoComplete="off" />
                              <button className={btnCls}>Mark paid</button>
                            </form>
                            <form action={voidRecord} className="space-y-2 rounded-lg border border-line p-3">
                              <input type="hidden" name="id" value={r.id} />
                              <label htmlFor={`void-${r.id}`} className={labelCls}>Reason to void</label>
                              <input id={`void-${r.id}`} name="reason" required minLength={5} maxLength={300} className={inputCls} />
                              <button className={btnSecondaryCls}>Void</button>
                            </form>
                          </div>
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        </div>

        <>
          {finance && (
            <Panel id="record" title="Record money owed" description="This only records the debt. It does not invoice or message anyone.">
              <form action={recordRevenue} className="space-y-3">
                <div><label htmlFor="rv-c" className={labelCls}>Customer</label><input id="rv-c" name="customer" required maxLength={160} className={inputCls} /></div>
                <div><label htmlFor="rv-r" className={labelCls}>Reference (unique)</label><input id="rv-r" name="reference" required maxLength={80} className={inputCls} placeholder="INV-001" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label htmlFor="rv-a" className={labelCls}>Amount (QOR)</label><input id="rv-a" name="amount" required inputMode="decimal" className={inputCls} /></div>
                  <div><label htmlFor="rv-d" className={labelCls}>Due date</label><input id="rv-d" name="due" type="date" required className={inputCls} /></div>
                </div>
                <div><label htmlFor="rv-desc" className={labelCls}>What it is for (optional)</label><input id="rv-desc" name="description" maxLength={500} className={inputCls} /></div>
                <button className={btnCls}>Record</button>
              </form>
            </Panel>
          )}
          <HowItWorks title="Where payments go">
            {treasury ? <Hash value={treasury} href={`https://explore.qore.network/address/${treasury}`} /> : <p className="text-[13.5px] text-muted">No treasury is linked yet, so payments cannot be verified. Link one in Organisation settings.</p>}
            <Source>Only native QOR transfers to this address can be checked. A record marked paid with a hash that does not check out stays flagged as not verified. Nothing here sends money or chases customers.</Source>
          </HowItWorks>
        </>
      </>
    </>
  );
}
