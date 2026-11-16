import { QORE_NETWORK } from "@qoreops/shared-types";
import { ExternalLink } from "lucide-react";
import { CategorySection } from "@/components/proof/category-section";
import { ProofLedger, type ProofRow } from "@/components/proof/ledger";
import { Badge, Card, Metric, PageHeader, StatusDot, fmtUtc } from "@/components/ui";
import { Hash } from "@/components/ui-client";
import { RUN, type RunTx } from "@/lib/live-run";
import { classify, contractOf, evidenceDoc, verification } from "@/lib/proof";
import { reader } from "@/lib/server";
import deployment from "../../../../../deployments/diana-testnet.json";

export const revalidate = 300; // chain is re-read at most every 5 minutes
export const metadata = { title: "Live Proof" };

type Actual = "success" | "reverted" | "not found" | "unavailable";
interface Checked extends RunTx { actual: Actual; height?: string }

async function check(t: RunTx, q: ReturnType<typeof reader>): Promise<Checked> {
  try {
    if (t.lane === "evm") {
      const r = await q.evm.getTransactionReceipt({ hash: t.hash as `0x${string}` });
      return { ...t, actual: r.status, height: r.blockNumber.toString() };
    }
    const res = await fetch(`${QORE_NETWORK.rest}/cosmos/tx/v1beta1/txs/${t.hash}`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 404 || res.status === 400) return { ...t, actual: "not found" };
    if (!res.ok) return { ...t, actual: "unavailable" };
    const j = (await res.json()) as { tx_response?: { code?: number; height?: string } };
    return { ...t, actual: j.tx_response?.code === 0 ? "success" : "reverted", ...(j.tx_response?.height ? { height: j.tx_response.height } : {}) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return { ...t, actual: /not be found|could not be found/i.test(msg) ? "not found" : "unavailable" };
  }
}

export default async function Proof() {
  const q = reader();
  const checkedAt = new Date().toISOString();
  const checked = await Promise.all(RUN.map((t) => check(t, q)));
  const explorer = q.endpoints.explorer.replace(/\/$/, "");
  const rows: ProofRow[] = checked.map((c) => ({
    hash: c.hash, label: c.label, group: c.group, lane: c.lane, kind: classify(c), contract: c.lane === "evm" ? contractOf(c.label) : null,
    expect: c.expect, actual: c.actual, height: c.height ?? null, reason: c.reason ?? null, verification: verification(c.expect, c.actual),
    source: "recorded run", doc: evidenceDoc(c.group), url: `${explorer}/tx/${c.hash}`,
  }));
  const verified = rows.filter((r) => r.verification === "verified").length;
  const refused = rows.filter((r) => r.verification === "refused-as-expected").length;
  const mismatch = rows.filter((r) => r.verification === "mismatch").length;
  const unchecked = rows.filter((r) => r.verification === "unverifiable").length;
  const expectRefused = rows.filter((r) => r.expect === "reverted").length;
  const allGood = mismatch === 0 && unchecked === 0;
  const contracts = Object.entries(deployment.contracts) as Array<[string, { address: string; tx: string }]>;

  return (
    <>
      <PageHeader title="Live Proof" eyebrow="Evidence"
        description="Every transaction behind Verac's testnet claims, re-read from QoreChain Diana when this page is built. If the chain disagrees with the record, the row is flagged, never dropped."
        badge={<Badge tone="live" />}
        meta={<><span>Checked {fmtUtc(checkedAt)}</span><span>Cached for up to 5 minutes</span><span>Network: Diana testnet, EVM chain {deployment.evmChainId}</span></>} />

      {/* The answer first. */}
      <section aria-label="Verdict" className={`mb-6 rounded-lg border p-5 sm:p-6 ${allGood ? "border-[color-mix(in_srgb,var(--live)_30%,transparent)] bg-[var(--live-bg)]" : "border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-bg)]"}`}>
        <p className="text-[12.5px] font-medium" style={{ color: allGood ? "var(--live)" : "var(--bad)" }}>{allGood ? "Verdict: the record holds" : "Verdict: the chain disagrees with part of the record"}</p>
        <p className="mt-2 max-w-4xl text-[17px] leading-relaxed sm:text-[18px]">
          {allGood
            ? <>All <strong>{rows.length}</strong> recorded transactions match the chain. <strong>{verified}</strong> succeeded as recorded, and all <strong>{refused}</strong> attempts that the contracts were supposed to refuse were refused on chain with a named error, not blocked in the interface.</>
            : <><strong>{mismatch}</strong> record{mismatch === 1 ? "" : "s"} do not match what the chain returns{unchecked ? <> and <strong>{unchecked}</strong> could not be checked because the node did not answer</> : null}. They are listed first under “Only problems”.</>}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[color-mix(in_srgb,currentColor_10%,transparent)] pt-4 sm:grid-cols-4">
          <Metric label="Verified on-chain" value={verified} tone="live" />
          <Metric label="Refused on-chain, as expected" value={`${refused} / ${expectRefused}`} />
          <Metric label="Mismatches" value={mismatch} tone={mismatch ? "bad" : "muted"} />
          <Metric label="Could not check" value={unchecked} tone={unchecked ? "warn" : "muted"} />
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ProofLedger rows={rows} checkedAt={checkedAt} />

        <div className="space-y-6">
          <Card title="Contract identities" description={`Deployed ${deployment.deployedAt}. Bytecode is re-checked on the dashboard.`} flush>
            <ul className="-mx-5 divide-y divide-line">
              {contracts.map(([name, c]) => (
                <li key={name} className="px-5 py-2.5">
                  <p className="text-[13px] font-medium">{name}</p>
                  <Hash value={c.address} href={`${explorer}/address/${c.address}`} />
                </li>
              ))}
            </ul>
          </Card>

          <Card title="How this is verified">
            <ol className="space-y-3 text-[13px] leading-relaxed text-muted">
              <li><span className="font-medium text-ink">EVM transactions.</span> The receipt is fetched over JSON-RPC and its status compared with the record.</li>
              <li><span className="font-medium text-ink">Native transactions.</span> These are hybrid-signed (secp256k1 + ML-DSA-87). They are fetched from the chain&apos;s REST endpoint; code 0 means success.</li>
              <li><span className="font-medium text-ink">Refusals.</span> Revert reasons come from replaying the failed transactions when the run was written up.</li>
              <li><span className="font-medium text-ink">Your own payments.</span> Payments made from this site are on the Approvals and Treasury pages, each with its receipt.</li>
            </ol>
            <div className="mt-4 space-y-1.5 border-t border-line pt-4 text-[12.5px]">
              <p className="font-medium text-ink">Status words</p>
              <p><StatusDot tone="live">Verified on-chain</StatusDot></p>
              <p><StatusDot tone="approval">Refused on-chain: a control working</StatusDot></p>
              <p><StatusDot tone="failed">Mismatch: the chain disagrees</StatusDot></p>
              <p><StatusDot tone="unavailable">Could not check: node did not answer</StatusDot></p>
            </div>
          </Card>

          <Card title="What this does not prove">
            <ul className="list-disc space-y-2 pl-4 text-[13px] leading-relaxed text-muted">
              <li>Most steps were run from scripts. One payment so far was sent from the website (see “First website payment”).</li>
              <li>No AI made any of these decisions.</li>
              <li>In the 2026-11-14 runs one throwaway key acted as owner, approver and reviewer, so separation of duties is shown only from 2026-11-15.</li>
              <li>The contracts are not source-verified on an explorer and have had no external audit.</li>
            </ul>
            <a href={explorer} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-text hover:underline">QoreChain explorer<ExternalLink size={13} aria-hidden /></a>
          </Card>
        </div>
      </div>
      <CategorySection />
    </>
  );
}
