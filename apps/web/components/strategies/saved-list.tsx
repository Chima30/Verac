import { cancelStrategy } from "@/app/(app)/strategies/actions";
import { Badge, EmptyState, btnSecondaryCls, fmtUtc } from "@/components/ui";

interface Row { id: string; kind: string; config: { name?: string }; mode: string; status: string; created_at: string }
const KIND: Record<string, string> = { dca: "DCA", rebalance: "Rebalance", arbitrage: "Arbitrage" };

/** Saved simulation inputs. Mode is always SIMULATION and status paused or cancelled: nothing here ever runs. */
export function SavedList({ rows, canCancel, back }: { rows: Row[]; canCancel: boolean; back: string }) {
  if (rows.length === 0) return <EmptyState title="Nothing saved yet">Saving stores only the numbers you typed, as a paused simulation.</EmptyState>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
      <table className="data-table min-w-[36rem] [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
        <thead><tr><th>Name</th><th>Kind</th><th>Saved</th><th>State</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td className="font-medium">{r.config.name ?? "Untitled"}</td>
            <td className="text-muted">{KIND[r.kind] ?? r.kind}</td>
            <td className="whitespace-nowrap text-[12.5px] text-muted">{fmtUtc(r.created_at)}</td>
            <td><span className="flex flex-wrap gap-1.5"><Badge tone="sim" /><Badge tone="neutral">{r.status === "cancelled" ? "CANCELLED" : "PAUSED, NEVER RUNS"}</Badge></span></td>
            <td className="text-right">
              {canCancel && r.status !== "cancelled" && (
                <form action={cancelStrategy}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} /><button className={`${btnSecondaryCls} min-h-8 text-[12.5px]`}>Cancel</button></form>
              )}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
