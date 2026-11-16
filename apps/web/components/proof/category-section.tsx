import { QORE_NETWORK } from "@qoreops/shared-types";
import { Badge, Card, Notice, ShortHash, Source, type Tone } from "@/components/ui";
import { categoryChecks, STATUS_TEXT, type CategoryCheck, type EvidenceStatus } from "@/lib/category";
import { reader } from "@/lib/server";

const TONE: Record<EvidenceStatus, Tone> = { "verified-onchain": "live", "local-test": "info", configured: "neutral", "not-verified": "pending", failed: "failed" };

/** Re-reads a recorded transaction now. A record the chain no longer backs is shown as failed, not hidden. */
async function recheck(c: CategoryCheck, q: ReturnType<typeof reader>): Promise<CategoryCheck & { chain?: string }> {
  if (!c.txHash) return c;
  try {
    if (c.lane === "evm") {
      const r = await q.evm.getTransactionReceipt({ hash: c.txHash as `0x${string}` });
      const ok = (r.status === "reverted") === (c.denial === "on-chain");
      return { ...c, height: r.blockNumber.toString(), chain: r.status, ...(ok ? {} : { status: "failed" as const }) };
    }
    const res = await fetch(`${QORE_NETWORK.rest}/cosmos/tx/v1beta1/txs/${c.txHash}`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { ...c, chain: res.status === 404 ? "not found" : "unavailable", ...(res.status === 404 ? { status: "failed" as const } : {}) };
    const j = (await res.json()) as { tx_response?: { code?: number; height?: string } };
    return { ...c, height: j.tx_response?.height, chain: j.tx_response?.code === 0 ? "success" : `code ${j.tx_response?.code}` };
  } catch { return { ...c, chain: "unavailable" }; }
}

async function windowCard(label: string, evm: string | undefined, q: ReturnType<typeof reader>) {
  if (!evm || !/^0x[0-9a-fA-F]{40}$/.test(evm)) return null;
  try {
    const native = q.toNativeAddress(evm);
    const w = await q.evmWindow(native);
    return { label, evm, native, w };
  } catch (e) { return { label, evm, native: "", w: null, error: e instanceof Error ? e.message : String(e) }; }
}

export async function CategorySection() {
  const q = reader();
  const explorer = q.endpoints.explorer.replace(/\/$/, "");
  const checks = await Promise.all(categoryChecks().map((c) => recheck(c, q)));
  const windows = (await Promise.all([windowCard("Payment agent", process.env.LIVE_AGENT_ADDRESS, q), windowCard("Approver", process.env.LIVE_APPROVER_ADDRESS, q)])).filter(Boolean);
  const reqs = [...new Set(checks.map((c) => c.requirement.charAt(0)))];
  const statusOf = (letter: string): EvidenceStatus => {
    const cs = checks.filter((c) => c.requirement.startsWith(letter));
    if (cs.some((c) => c.status === "failed")) return "failed";
    if (cs.some((c) => c.status === "verified-onchain") && cs.every((c) => c.status === "verified-onchain" || c.status === "local-test")) return "verified-onchain";
    if (cs.every((c) => c.status === "local-test")) return "local-test";
    if (cs.some((c) => c.status === "verified-onchain")) return "configured";
    return "not-verified";
  };
  const NAMES: Record<string, string> = { A: "Scoped EVM authorisation", B: "Transaction-count limits", C: "Value limits", D: "Duration limits", E: "Target restrictions", F: "Native smart-account spending rules", G: "Authenticated messaging" };

  return (
    <section aria-labelledby="cat-h" className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="cat-h" className="text-[20px] font-bold tracking-[-0.02em]">Post-Quantum AI Agents: category evidence</h2>
          <p className="mt-1 max-w-3xl text-[13.5px] text-muted">Each requirement, how it is enforced and what proves it. &ldquo;Partly proven&rdquo; means the configuration is on chain but the refusal itself has not been demonstrated yet.</p></div>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {reqs.map((l) => {
          const st = statusOf(l);
          return (
            <div key={l} className="rounded-lg border border-line bg-surface p-3 shadow-card">
              <p className="text-[11.5px] font-semibold text-subtle">{l}</p>
              <p className="mt-0.5 text-[13px] font-semibold leading-snug">{NAMES[l]}</p>
              <div className="mt-2"><Badge tone={TONE[st]}>{st === "configured" ? "PARTLY PROVEN" : STATUS_TEXT[st]}</Badge></div>
            </div>
          );
        })}
      </div>

      <Card title="Checks" flush>
        <div className="-mx-5 overflow-x-auto">
          <table className="data-table min-w-[60rem] [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5">
            <thead><tr><th>Check</th><th>Enforced by</th><th>Expected</th><th>Where refused</th><th>Evidence</th><th>Status</th></tr></thead>
            <tbody>{checks.map((c) => (
              <tr key={c.id}>
                <td><p className="font-medium">{c.name}</p><p className="text-[12px] text-muted">{c.requirement} · {c.subject}</p></td>
                <td className="max-w-[18rem] text-[12.5px] text-muted">{c.mechanism}</td>
                <td className="text-[12.5px]">{c.expected}{c.actual && <span className="block text-muted">Got: {c.actual}</span>}</td>
                <td className="text-[12.5px] text-muted">{c.denial === "on-chain" ? "On chain (in a block)" : c.denial === "before-inclusion" ? "Before inclusion (RPC refusal)" : "n/a"}</td>
                <td className="text-[12.5px]">
                  {c.txHash ? <a className="font-mono text-[12px] underline decoration-line-strong underline-offset-[3px] hover:decoration-current" href={`${explorer}/tx/${c.txHash}`} target="_blank" rel="noreferrer">{c.txHash.slice(0, 10)}…</a> : null}
                  {"chain" in c && c.chain ? <span className="block text-subtle">chain now: {c.chain}{c.height ? `, block ${c.height}` : ""}</span> : null}
                  {c.rpcError && <span className="block max-w-[16rem] truncate font-mono text-[11px] text-subtle" title={c.rpcError}>{c.rpcError}</span>}
                  <span className="block text-subtle">{c.source}</span>
                </td>
                <td><Badge tone={TONE[c.status]}>{STATUS_TEXT[c.status]}</Badge></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>

      {windows.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {windows.map((x) => x && (
            <Card key={x.label} title={`${x.label}: EVM window now`} description={<ShortHash value={x.native || x.evm} />}>
              {"error" in x && x.error ? <Notice tone="bad">{x.error}</Notice> : x.w && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                  <dt className="text-muted">Status</dt><dd>{x.w.live ? "open" : x.w.found ? "expired or used up" : "no window"}</dd>
                  <dt className="text-muted">Opened at / expires at</dt><dd className="tabular-nums">{x.w.found ? `${x.w.openedHeight} / ${x.w.expiryHeight}` : "–"}</dd>
                  <dt className="text-muted">Transactions used</dt><dd className="tabular-nums">{x.w.found ? `${x.w.usedTxs} of ${x.w.maxTxs}` : "–"}</dd>
                  <dt className="text-muted">Value used (uqor)</dt><dd className="tabular-nums">{x.w.found ? `${x.w.usedValue} of ${x.w.maxValue}` : "–"}</dd>
                  <dt className="text-muted">Allowed targets</dt><dd className="break-all font-mono text-[11.5px]">{x.w.found ? (x.w.allowedTargets.length ? x.w.allowedTargets.join(", ") : "any (unscoped)") : "–"}</dd>
                </dl>
              )}
              <Source>Read live over REST. Verac opens these windows only for an approved operation and closes them afterwards, so &ldquo;no window&rdquo; is the normal state.</Source>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
