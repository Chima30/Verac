/** Pure rules for the Revenue page. Amounts are whole base units (wei) as decimal strings. */

export interface RevenueRow { id: string; customer: string; reference: string; amount: string; due_date: string | null; status: string; matched_tx_hash: string | null }

/** "Overdue" is worked out from the due date when read; the database never stores it. */
export function effectiveStatus(r: Pick<RevenueRow, "status" | "due_date">, today: string): "issued" | "overdue" | "paid" | "void" {
  if (r.status === "paid" || r.status === "void") return r.status;
  return r.due_date && r.due_date < today ? "overdue" : "issued";
}

export function daysOverdue(due: string, today: string): number {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`);
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function summarise(rows: RevenueRow[], today: string) {
  let outstanding = 0n, overdue = 0n, paid = 0n, nOver = 0;
  for (const r of rows) {
    const amt = BigInt(r.amount.split(".")[0]!);
    const s = effectiveStatus(r, today);
    if (s === "paid") paid += amt;
    else if (s === "overdue") { overdue += amt; outstanding += amt; nOver++; }
    else if (s === "issued") outstanding += amt;
  }
  return { outstanding, overdue, paid, overdueCount: nOver };
}

export type MatchState = "VERIFIED" | "NOT_VERIFIED" | "NOT_FOUND";
export interface ChainTx { to: string | null; value: bigint; success: boolean }

/** A native-QOR payment counts only if it succeeded, went to the treasury, and was for at least the amount owed. */
export function matchTransfer(tx: ChainTx | null, expected: { to: string; amount: bigint }): { state: MatchState; reason: string } {
  if (!tx) return { state: "NOT_FOUND", reason: "No transaction with this hash was found on the testnet." };
  if (!tx.success) return { state: "NOT_VERIFIED", reason: "The transaction failed on-chain." };
  if (!tx.to || tx.to.toLowerCase() !== expected.to.toLowerCase()) return { state: "NOT_VERIFIED", reason: "The transaction did not pay the treasury address." };
  if (tx.value < expected.amount) return { state: "NOT_VERIFIED", reason: "The transaction paid less than the amount owed." };
  return { state: "VERIFIED", reason: "A successful transfer to the treasury for at least the amount owed." };
}
