import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { RUN, type RunTx } from "@/lib/live-run";
import { reader } from "@/lib/server";
import { QORE_NETWORK } from "@qoreops/shared-types";

export const revalidate = 300; // chain is re-read at most every 5 minutes
export const metadata = { title: "Live Proof" };

interface Checked extends RunTx { actual: "success" | "reverted" | "not found" | "unavailable"; height?: string }

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
  const checked = await Promise.all(RUN.map((t) => check(t, q)));
  const matches = checked.filter((c) => c.actual === c.expect).length;
  const denied = checked.filter((c) => c.expect === "reverted");
  const deniedOk = denied.filter((c) => c.actual === "reverted").length;
  const groups = [...new Set(checked.map((c) => c.group))];
  const explorer = q.endpoints.explorer.replace(/\/$/, "");
  const link = (c: Checked) => `${explorer}/tx/${c.lane === "evm" ? c.hash : c.hash}`;

  return (
    <>
      <PageHeader title="Live Proof" description="Every transaction from the 2026-11-14 testnet runs, re-read from the chain when this page loads (cached for up to 5 minutes). If a result differs from what the run expected, it is flagged rather than hidden."
        badge={<Badge tone="live" />} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Transactions matching the record" value={`${matches} / ${checked.length}`} badge={<Badge tone={matches === checked.length ? "live" : "failed"}>{matches === checked.length ? "ALL MATCH" : "MISMATCH"}</Badge>} />
        <Stat label="Attempts the contracts refused" value={`${deniedOk} / ${denied.length}`} sub="Failed on-chain with a named error, not blocked in the UI" />
        <Stat label="Network" value="Diana testnet" sub="chain 9800, throwaway accounts, no real value" />
      </div>

      <div className="mt-6 space-y-4">
        {groups.map((g) => (
          <Card key={g} title={g}>
            <ul className="divide-y divide-line text-sm">
              {checked.filter((c) => c.group === g).map((c) => {
                const ok = c.actual === c.expect;
                const refused = c.expect === "reverted";
                return (
                  <li key={c.hash} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className={refused ? "font-medium" : ""}>{c.label}</p>
                      <a className="break-all font-mono text-[11px] text-muted underline" href={link(c)} target="_blank" rel="noreferrer">{c.hash}</a>
                      {refused && c.reason && <p className="text-xs text-muted">Expected refusal: <span className="font-mono">{c.reason}</span></p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.height && <span className="font-mono text-xs text-muted">block {c.height}</span>}
                      <Badge tone={!ok ? "failed" : refused ? "approval" : "live"}>{!ok ? `EXPECTED ${c.expect.toUpperCase()}, GOT ${c.actual.toUpperCase()}` : refused ? "REFUSED ON-CHAIN" : "CONFIRMED"}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      <p className="mt-6 max-w-3xl text-xs text-muted">What this does not show: the steps were run from scripts, not from this app. No AI made any decision. The owner, approver and reviewer were the same throwaway key, so separation of duties is not demonstrated. The contracts are not source-verified on an explorer and have had no external audit. Revert reasons come from replaying the failed transactions.</p>
    </>
  );
}
