import { cancelStrategy } from "@/app/(app)/strategies/actions";
import { Badge, EmptyState } from "@/components/ui";

interface Row { id: string; kind: string; config: { name?: string }; mode: string; status: string; created_at: string }

/** Saved simulation inputs. Mode is always SIMULATION and status paused or cancelled: nothing here ever runs. */
export function SavedList({ rows, canCancel, back }: { rows: Row[]; canCancel: boolean; back: string }) {
  if (rows.length === 0) return <EmptyState title="Nothing saved">Saved inputs appear here. Saving stores only the numbers, as a paused SIMULATION.</EmptyState>;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line text-sm">{rows.map((r) => (
      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span><strong>{r.config.name ?? "Untitled"}</strong> <span className="text-muted">{r.kind} · {new Date(r.created_at).toUTCString()}</span></span>
        <span className="flex items-center gap-2">
          <Badge tone="sim" />
          <Badge tone="neutral">{r.status === "cancelled" ? "CANCELLED" : "PAUSED, NEVER RUNS"}</Badge>
          {canCancel && r.status !== "cancelled" && (
            <form action={cancelStrategy}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} /><button className="rounded-md border border-line px-2.5 py-1 text-xs hover:bg-[var(--neutral-bg)]">Cancel</button></form>
          )}
        </span>
      </li>
    ))}</ul>
  );
}
