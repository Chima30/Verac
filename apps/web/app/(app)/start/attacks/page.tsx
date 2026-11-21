import { ProofStamp, Stat, StatRow } from "@/components/ui";
import { StartNav, recordedLabel } from "@/components/start-nav";
import { V2_RUN as R, txUrl, type V2Result } from "@/lib/start";

export const metadata = { title: "Try to steal from the vault" };

/** Who stopped it, with the contract's error name only (the raw revert data stays in the record). */
const by = (r: V2Result) => {
  if (r.outcome === "rejected-by-chain") return "QoreChain, before the transaction was included";
  const name = (r.error ?? r.expected).match(/^[A-Za-z]+(\([^)]{0,40}\))?/)?.[0];
  return name ? `the vault contract: ${name}` : "the vault contract";
};

/** Replay of the TreasuryVault V2 live run (deployments/v2-live-results.json): every attack, who stopped it, and the transaction. */
export default function AttackReplay() {
  return (
    <>
      {recordedLabel("19 November 2026 · TreasuryVault V2 on Diana testnet")}
      <header className="mb-10">
        <h1 className="text-[32px] font-medium leading-[1.15] tracking-[-0.02em] sm:text-[40px]">Everything the server holds.<span className="block text-muted">{R.attacks.length} attempts. None of them paid.</span></h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-[1.35] tracking-[-0.01em] text-muted">
          The attacker had the agent's key, the relayer's key and both of their registered post-quantum keys: everything Verac's
          server holds. A payment needs two of three administrators' ML-DSA-87 signatures, checked by the vault on chain.
        </p>
      </header>

      <StatRow>
        <Stat tint="peach" label="Attacks refused" value={`${R.attacks.length} of ${R.attacks.length}`} sub="each one a transaction you can open" />
        <Stat tint="mint" label="Legitimate payments" value={String(R.payments.length)} sub="signed by two administrators, paid" />
        <Stat tint="sky" label="Vault balance" value={`${R.before} → ${R.after}`} sub="QOR before and after: exactly the two payments" />
      </StatRow>

      <section aria-labelledby="list">
        <h2 id="list" className="text-[22px] font-medium tracking-[-0.01em]">Every attempt</h2>
        <ul className="mt-5 divide-y divide-line border-y border-line">
          {R.attacks.map((r) => (
            <li key={r.id} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 gap-y-2 py-4 md:grid-cols-[3rem_minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center">
              <span className="font-mono text-[13px] font-medium text-muted">{r.id}</span>
              <span className="text-[15px] leading-[1.35] tracking-[-0.01em]">{r.scenario}</span>
              <span className="col-start-2 text-[13.5px] leading-[1.35] text-muted md:col-start-3">Stopped by {by(r)}</span>
              <span className="col-start-2 md:col-start-4">{r.txHash ? <a href={txUrl(r.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[4px] bg-[var(--tint-peach)] px-2 py-0.5 font-mono text-[11px] font-medium uppercase text-[var(--tint-ink)] hover:underline">Refused · {r.txHash.slice(0, 6)}…{r.txHash.slice(-4)}</a> : <span className="font-mono text-[11px] font-medium uppercase text-muted">Never included</span>}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="paid" className="mt-10">
        <h2 id="paid" className="text-[22px] font-medium tracking-[-0.01em]">The payments that did go through</h2>
        <ul className="mt-4 space-y-3">
          {R.payments.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-3 text-[15px] tracking-[-0.01em]"><span className="font-mono text-[13px] text-muted">{r.id}</span>{r.scenario}{r.txHash && <ProofStamp hash={r.txHash} href={txUrl(r.txHash)} />}</li>)}
        </ul>
      </section>

      <StartNav current="/start/attacks" />
    </>
  );
}
