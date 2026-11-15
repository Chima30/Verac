import { redirect } from "next/navigation";
import type { PublicClient } from "viem";
import { Badge, Card, EmptyState, PageHeader, btnCls, inputCls } from "@/components/ui";
import { formatQor } from "@/lib/approvals";
import { daysOverdue, effectiveStatus, matchTransfer, summarise, type MatchState, type RevenueRow } from "@/lib/revenue";
import { reader } from "@/lib/server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { markPaid, recordRevenue, voidRecord } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revenue" };

const FINANCE = ["owner", "administrator", "finance_manager"];
const wei = (v: unknown) => String(v).split(".")[0]!;
const STATE_TONE = { issued: "pending", overdue: "failed", paid: "live", void: "neutral" } as const;
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

  const { data, error } = await sb.from("revenue_records").select("id,customer,reference,amount,due_date,status,matched_tx_hash,description,void_reason").eq("organization_id", s.org.id).order("due_date");
  const rows = (data ?? []) as unknown as Array<RevenueRow & { description: string | null; void_reason: string | null }>;
  const { data: tr } = await sb.from("treasuries").select("vault_address").eq("organization_id", s.org.id).limit(1).maybeSingle();
  const treasury = (tr?.vault_address as string | undefined) ?? null;
  const checks = await checkPayments(rows, treasury);
  const sum = summarise(rows, today);

  return (
    <>
      <PageHeader title="Revenue" description="Record what customers owe, and record which on-chain payment settled it. Overdue is worked out from the due date. A payment counts as verified only when the page finds a successful testnet transfer to your treasury for at least the amount owed." badge={<Badge tone="sim" />} />
      {sp.msg && <p role="status" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--live)_25%,transparent)] bg-[var(--live-bg)] px-4 py-3 text-[13.5px]">{sp.msg}</p>}
      {(sp.error || error) && <p role="alert" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-bg)] px-4 py-3 text-[13.5px] text-[var(--bad)]">{sp.error ?? error?.message}</p>}
      {checks.error && <p role="status" className="mb-4 text-[13.5px] text-muted">{checks.error}</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card title="Outstanding"><p className="text-lg">{formatQor(sum.outstanding.toString())} QOR</p></Card>
        <Card title="Overdue"><p className="text-lg">{formatQor(sum.overdue.toString())} QOR</p><p className="text-[12.5px] text-muted">{sum.overdueCount} record{sum.overdueCount === 1 ? "" : "s"}</p></Card>
        <Card title="Marked paid"><p className="text-lg">{formatQor(sum.paid.toString())} QOR</p><p className="text-[12.5px] text-muted">See each record for its on-chain check.</p></Card>
      </div>

      {finance && (
        <Card title="Record money owed" className="mb-4">
          <form action={recordRevenue} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input name="customer" required maxLength={160} className={inputCls} placeholder="Customer" />
            <input name="reference" required maxLength={80} className={inputCls} placeholder="Reference (must be unique), e.g. INV-001" />
            <input name="amount" required inputMode="decimal" className={inputCls} placeholder="Amount (QOR)" />
            <input name="due" type="date" required className={inputCls} />
            <input name="description" maxLength={500} className={`${inputCls} sm:col-span-2`} placeholder="What it is for (optional)" />
            <div className="sm:col-span-2"><button className={btnCls}>Record</button></div>
          </form>
          <p className="mt-2 text-[12.5px] text-muted">Payments are expected in native QOR to the treasury {treasury ? <span className="break-all font-mono">{treasury}</span> : "(none linked yet)"}. This only records the debt. It does not invoice or message anyone.</p>
        </Card>
      )}

      {rows.length === 0 ? <EmptyState title="No revenue records">{finance ? "Record the first one above." : "Finance records appear here."}</EmptyState> : (
        <div className="space-y-3">{rows.map((r) => {
          const st = effectiveStatus(r, today);
          const m = checks.out.get(r.id);
          return (
            <Card key={r.id} title={`${r.customer} · ${r.reference}`} right={<Badge tone={STATE_TONE[st]}>{st === "overdue" ? `OVERDUE ${daysOverdue(r.due_date!, today)}D` : st.toUpperCase()}</Badge>}>
              <p className="text-[13.5px]">{formatQor(wei(r.amount))} QOR · due {r.due_date}{r.description ? ` · ${r.description}` : ""}</p>
              {r.status === "paid" && r.matched_tx_hash && (
                <div className="mt-2 space-y-1 text-[13.5px]">
                  <p className="break-all font-mono text-[12.5px]">Claimed payment: {r.matched_tx_hash}</p>
                  {m && <p><Badge tone={m.state === "VERIFIED" ? "live" : "failed"}>{MATCH_LABEL[m.state]}</Badge> <span className="text-muted">{m.reason}</span></p>}
                  {!m && <p className="text-muted">Not checked (only the first 25 paid records are checked).</p>}
                </div>
              )}
              {r.status === "void" && <p className="mt-2 text-[13.5px] text-muted">Voided: {r.void_reason}</p>}
              {finance && (r.status === "issued" || r.status === "overdue") && (
                <div className="mt-3 space-y-2">
                  <form action={markPaid} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input name="tx" required className={`${inputCls} max-w-xl font-mono text-[12.5px]`} placeholder="Payment transaction hash 0x…" />
                    <button className={btnCls}>Mark paid</button>
                  </form>
                  <form action={voidRecord} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input name="reason" required minLength={5} maxLength={300} className={`${inputCls} max-w-sm`} placeholder="Reason to void" />
                    <button className="inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-line bg-surface px-3.5 text-[13.5px] font-medium text-ink shadow-sm transition-[background-color,border-color] hover:border-line-strong hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50">Void</button>
                  </form>
                </div>
              )}
            </Card>
          );
        })}</div>
      )}
      <p className="mt-4 text-[12.5px] text-muted">Only native QOR transfers to the treasury can be checked. A record marked paid with a hash that does not check out stays flagged NOT VERIFIED. Nothing here sends money, emails customers or chases payments.</p>
    </>
  );
}
