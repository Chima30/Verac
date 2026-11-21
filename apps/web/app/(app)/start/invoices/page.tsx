import { Badge, ProofStamp, Stat, StatRow } from "@/components/ui";
import { StartNav, recordedLabel } from "@/components/start-nav";
import { INVOICE_RUN as R, txUrl } from "@/lib/start";

export const metadata = { title: "Six agents review three invoices" };

/** Replay of the first agent-workflow payment (docs/LIVE_WORKFLOW_2026-11-16.md), step by step. */
export default function InvoiceReplay() {
  return (
    <>
      {recordedLabel(R.date)}
      <header className="mb-10">
        <h1 className="text-[32px] font-medium leading-[1.15] tracking-[-0.02em] sm:text-[40px]">Six agents review three invoices.<span className="block text-muted">One is paid. Two are held.</span></h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-[1.35] tracking-[-0.01em] text-muted">The invoices were synthetic demo data; the agents, the approval and the payment were real, on the deployed site and on Diana testnet.</p>
      </header>

      <section aria-labelledby="ask" className="mb-10">
        <h2 id="ask" className="label-mono text-muted">The instruction</h2>
        <blockquote className="mt-3 max-w-3xl border-l-2 border-[var(--ring)] pl-5 text-[22px] leading-[1.3] tracking-[-0.015em]">“{R.instruction}”</blockquote>
      </section>

      <StatRow>
        {R.invoices.map((inv) => (
          <Stat key={inv.number} tint={inv.outcome === "ELIGIBLE" ? "mint" : "peach"} label={`${inv.number} · ${inv.outcome}`} value={`${inv.amount} QOR`} sub={inv.why} />
        ))}
      </StatRow>

      <section aria-labelledby="steps" className="mb-10">
        <h2 id="steps" className="text-[22px] font-medium tracking-[-0.01em]">What happened, in order</h2>
        <ol className="mt-5 divide-y divide-line border-y border-line">
          {R.steps.map((s, i) => (
            <li key={s.who} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[2.5rem_16rem_minmax(0,1fr)]">
              <span className="font-mono text-[13px] font-medium text-muted">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-[15px] font-medium tracking-[-0.01em]">{s.who}</span>
              <span className="col-start-2 text-[15px] leading-[1.35] tracking-[-0.01em] text-muted sm:col-start-3">{s.what}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="chain" className="theme-dark rounded-[4px] bg-[var(--band)] p-6 text-white sm:p-8">
        <h2 id="chain" className="label-mono flex items-center gap-2 text-[var(--accent)]"><span aria-hidden className="inline-block h-[2px] w-3 bg-[var(--accent)]" />On chain</h2>
        <dl className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div><dt className="text-[15px] font-medium">Administrator's approval</dt><dd className="mt-2"><ProofStamp hash={R.approvalTx} href={txUrl(R.approvalTx)} detail={`block ${R.approvalBlock.toLocaleString("en-US")}`} /></dd></div>
          <div><dt className="text-[15px] font-medium">1.25 QOR paid by the vault</dt><dd className="mt-2"><ProofStamp hash={R.paymentTx} href={txUrl(R.paymentTx)} detail={`block ${R.paymentBlock.toLocaleString("en-US")}`} /></dd></div>
        </dl>
        <p className="mt-6 max-w-3xl text-[14px] leading-[1.4] text-[#b3b3b3]">The receipt carries the vault's PaymentExecuted event with the exact payment hash the administrator approved, the agent's address, and 1.25 QOR to the vendor's approved address. A different amount or recipient would not have matched the approval.</p>
        <p className="mt-3"><Badge tone="live" /></p>
      </section>

      <StartNav current="/start/invoices" />
    </>
  );
}
