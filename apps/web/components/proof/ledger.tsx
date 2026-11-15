"use client";
import { ChevronRight, Download, ExternalLink, Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Badge, chipCls, inputCls, type Tone } from "@/components/ui";
import { CopyButton } from "@/components/ui-client";
import { KIND_LABEL, type ProofKind, type Verification } from "@/lib/proof";

export interface ProofRow {
  hash: string; label: string; group: string; lane: "native" | "evm"; kind: ProofKind; contract: string | null;
  expect: "success" | "reverted"; actual: string; height: string | null; reason: string | null;
  verification: Verification; source: "recorded run" | "app records"; doc: string | null; url: string;
}

const V: Record<Verification, { text: string; tone: Tone; help: string }> = {
  verified: { text: "VERIFIED ON-CHAIN", tone: "live", help: "The chain returned a successful receipt, as the record says." },
  "refused-as-expected": { text: "REFUSED ON-CHAIN", tone: "approval", help: "The contract reverted with a named error, as the record says. This is a control working." },
  mismatch: { text: "MISMATCH", tone: "failed", help: "The chain disagrees with the record. Shown, never hidden." },
  pending: { text: "PENDING", tone: "pending", help: "Submitted but not yet in a block." },
  unverifiable: { text: "COULD NOT CHECK", tone: "unavailable", help: "The node did not answer, so this row is not verified right now." },
};

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function ProofLedger({ rows, checkedAt }: { rows: ProofRow[]; checkedAt: string }) {
  const [kind, setKind] = useState<ProofKind | "all">("all");
  const [state, setState] = useState<"all" | "problems">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const r of rows) c[r.kind] = (c[r.kind] ?? 0) + 1; return c; }, [rows]);
  const shown = useMemo(() => rows.filter((r) =>
    (kind === "all" || r.kind === kind) &&
    (state === "all" || r.verification === "mismatch" || r.verification === "unverifiable") &&
    (!q.trim() || `${r.label} ${r.hash} ${r.group} ${r.contract ?? ""} ${r.reason ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [rows, kind, state, q]);
  const problems = rows.filter((r) => r.verification === "mismatch" || r.verification === "unverifiable").length;

  const exportRows = shown.map((r) => ({ label: r.label, group: r.group, kind: r.kind, lane: r.lane, hash: r.hash, block: r.height, contract: r.contract, expected: r.expect, actual: r.actual, verification: r.verification, revert_reason: r.reason, source: r.source, evidence_doc: r.doc, explorer: r.url, checked_at: checkedAt }));
  const kinds = (Object.keys(KIND_LABEL) as ProofKind[]).filter((k) => counts[k]);

  return (
    <section aria-labelledby="ledger-h" className="rounded-lg border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div><h2 id="ledger-h" className="text-[14px] font-semibold">Evidence ledger</h2><p className="mt-0.5 text-[12.5px] text-muted">Each row is a transaction re-read from Diana testnet. Open a row for the full record.</p></div>
        <div className="flex gap-2">
          <button type="button" className={chipCls(false)} onClick={() => download(`verac-proof-${checkedAt.slice(0, 10)}.csv`, [Object.keys(exportRows[0] ?? { label: "" }).join(","), ...exportRows.map((r) => Object.values(r).map(csvCell).join(","))].join("\n"), "text/csv")}><Download size={13} aria-hidden />CSV</button>
          <button type="button" className={chipCls(false)} onClick={() => download(`verac-proof-${checkedAt.slice(0, 10)}.json`, JSON.stringify({ checked_at: checkedAt, network: "qorechain-diana (EVM chain 9800)", rows: exportRows }, null, 2), "application/json")}><Download size={13} aria-hidden />JSON</button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-b border-line px-5 pb-4">
        <div role="group" aria-label="Filter by kind" className="flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={kind === "all"} className={chipCls(kind === "all")} onClick={() => setKind("all")}>All <span className="tabular-nums text-subtle">{rows.length}</span></button>
          {kinds.map((k) => <button key={k} type="button" aria-pressed={kind === k} className={chipCls(kind === k)} onClick={() => setKind(k)}>{KIND_LABEL[k]} <span className="tabular-nums text-subtle">{counts[k]}</span></button>)}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1"><Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <label htmlFor="proof-q" className="sr-only">Search the ledger</label>
            <input id="proof-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by label, hash, contract or revert reason" className={`${inputCls} pl-9`} /></div>
          <button type="button" aria-pressed={state === "problems"} className={chipCls(state === "problems")} onClick={() => setState(state === "all" ? "problems" : "all")}>Only problems <span className="tabular-nums text-subtle">{problems}</span></button>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">{shown.length} of {rows.length} records shown</p>
      {shown.length === 0 ? <p className="px-5 py-10 text-center text-[13.5px] text-muted">{state === "problems" ? "No problems: every record matches the chain." : "No records match this filter."}</p> : (
        <div className="overflow-x-auto">
          <table className="data-table min-w-[44rem] [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5">
            <thead><tr><th className="w-8"><span className="sr-only">Expand</span></th><th>Operation</th><th>Transaction</th><th className="num">Block</th><th>Verification</th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const isOpen = open === r.hash; const v = V[r.verification];
                return (
                  <Fragment key={r.hash}>
                    <tr className="cursor-pointer" onClick={() => setOpen(isOpen ? null : r.hash)}>
                      <td className="!pr-0"><button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} details for ${r.label}`} onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : r.hash); }} className="grid size-6 place-items-center rounded text-subtle hover:bg-surface-2 hover:text-ink"><ChevronRight size={14} aria-hidden className={`transition-transform ${isOpen ? "rotate-90" : ""}`} /></button></td>
                      <td><p className={`text-[13.5px] ${r.expect === "reverted" ? "font-medium" : ""}`}>{r.label}</p><p className="mt-0.5 text-[12px] text-muted">{r.group}{r.contract ? ` · ${r.contract}` : ""}</p></td>
                      <td><span className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}><a href={r.url} target="_blank" rel="noreferrer" title={r.hash} className="whitespace-nowrap font-mono text-[12.5px] underline decoration-line-strong underline-offset-[3px] hover:decoration-current">{r.hash.slice(0, 10)}…{r.hash.slice(-6)}</a><CopyButton value={r.hash} label="Copy transaction hash" /></span></td>
                      <td className="num font-mono text-[12.5px] text-muted">{r.height ? Number(r.height).toLocaleString("en-US") : "–"}</td>
                      <td><Badge tone={v.tone}>{v.text}</Badge></td>
                    </tr>
                    {isOpen && (
                      <tr className="hover:!bg-transparent">
                        <td />
                        <td colSpan={4} className="!pt-0">
                          <dl className="grid gap-x-8 gap-y-3 rounded-lg bg-surface-2 p-4 text-[13px] sm:grid-cols-2">
                            <div className="sm:col-span-2"><dt className="text-[12px] text-muted">Transaction hash</dt><dd className="mt-0.5 flex items-center gap-1"><span className="break-all font-mono text-[12.5px]">{r.hash}</span><CopyButton value={r.hash} /></dd></div>
                            <div><dt className="text-[12px] text-muted">Lane</dt><dd className="mt-0.5">{r.lane === "evm" ? "EVM (receipt read over JSON-RPC)" : "Native, hybrid post-quantum signed (read over REST)"}</dd></div>
                            <div><dt className="text-[12px] text-muted">Block</dt><dd className="mt-0.5 font-mono text-[12.5px]">{r.height ?? "not returned"}</dd></div>
                            <div><dt className="text-[12px] text-muted">Contract</dt><dd className="mt-0.5">{r.contract ?? (r.lane === "native" ? "Native chain module" : "Not named in the record")}</dd></div>
                            <div><dt className="text-[12px] text-muted">Expected / found</dt><dd className="mt-0.5">{r.expect} / <span className={r.verification === "mismatch" ? "font-medium text-[var(--bad)]" : ""}>{r.actual}</span></dd></div>
                            {r.reason && <div><dt className="text-[12px] text-muted">Revert reason</dt><dd className="mt-0.5 font-mono text-[12.5px]">{r.reason}</dd></div>}
                            <div><dt className="text-[12px] text-muted">Workflow</dt><dd className="mt-0.5">{r.group}</dd></div>
                            <div><dt className="text-[12px] text-muted">Evidence source</dt><dd className="mt-0.5">{r.source === "app records" ? "Verac's transactions table, then checked on chain" : <>Recorded run, written up in <span className="font-mono text-[12px]">{r.doc}</span></>}</dd></div>
                            <div><dt className="text-[12px] text-muted">What the badge means</dt><dd className="mt-0.5 text-muted">{v.help}</dd></div>
                            <div className="sm:col-span-2"><a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-text hover:underline">Open in QoreChain explorer<ExternalLink size={13} aria-hidden /></a></div>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
