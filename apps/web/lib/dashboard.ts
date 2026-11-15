import type { BalancePoint } from "./vault";
import { getSession, type Session } from "./session";
import { supabaseServer } from "./supabase/server";

/** A payment request waiting for people, live or simulated. Everything here comes from the transactions table. */
export interface QueueItem {
  id: string; live: boolean; agent: string; recipient: string; amountWei: string; purpose: string | null; policyVersion: number;
  approvals: number; required: number; createdAt: string; expiresAt: string; payroll: number | null;
}
export interface TaskItem { id: string; agent: string; intent: string; state: string; error: string | null; updatedAt: string; txId: string | null }
export interface OrgData {
  session: Session;
  queue: QueueItem[];
  queueError?: string;
  tasks: TaskItem[];
  tasksError?: string;
  ops: { tenders: Record<string, number>; tenderBudgetWei: bigint; grantsOpen: number; grantsBudgetWei: bigint; milestonesToReview: number; disputesOpen: number; proposalsVoting: number };
  live: { submitted: number; confirmed: number; failed: number; rejected: number };
  members: number | null;
  reviewerKey: boolean | null;
}

const big = (v: unknown) => { try { return BigInt(String(v ?? 0).split(".")[0] || "0"); } catch { return 0n; } };

/** One round of reads for everything on the dashboard that lives in the database. Each read fails on its own. */
export async function orgData(): Promise<OrgData> {
  const session = await getSession();
  const sb = session.user && session.org ? await supabaseServer() : null;
  if (!session.user || !session.org || !sb) return { session, queue: [], tasks: [], ops: { tenders: {}, tenderBudgetWei: 0n, grantsOpen: 0, grantsBudgetWei: 0n, milestonesToReview: 0, disputesOpen: 0, proposalsVoting: 0 }, live: { submitted: 0, confirmed: 0, failed: 0, rejected: 0 }, members: null, reviewerKey: null };
  const org = session.org.id;

  const [pend, tasks, tenders, grants, ms, disputes, props, live, members, key] = await Promise.all([
    sb.from("transactions").select("id,agent_id,recipient,amount,evaluation,policy_version,required_approvals,created_at,expires_at,calldata_hash").eq("organization_id", org).eq("state", "AWAITING_APPROVAL").order("created_at", { ascending: true }).limit(8),
    sb.from("agent_tasks").select("id,agent_id,intent,state,error,result,updated_at").eq("organization_id", org).order("updated_at", { ascending: false }).limit(8),
    sb.from("procurements").select("status,budget").eq("organization_id", org),
    sb.from("grants").select("status,budget").eq("organization_id", org),
    sb.from("milestones").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("status", "evidence_submitted"),
    sb.from("disputes").select("id", { count: "exact", head: true }).eq("organization_id", org).neq("status", "resolved"),
    sb.from("governance_proposals").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("status", "voting"),
    sb.from("transactions").select("state").eq("organization_id", org).eq("source", "LIVE_TESTNET").not("calldata_hash", "is", null).in("state", ["SUBMITTED", "CONFIRMED", "FAILED", "REJECTED"]),
    sb.from("memberships").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("status", "active"),
    sb.from("org_seal_keys").select("user_id").eq("organization_id", org).eq("user_id", session.user.id).maybeSingle(),
  ]);

  const pendRows = (pend.data ?? []) as Array<{ id: string; agent_id: string; recipient: string; amount: string; evaluation: unknown; policy_version: number; required_approvals: number; created_at: string; expires_at: string; calldata_hash: string | null }>;
  const ids = pendRows.map((r) => r.id);
  const { data: ap } = ids.length ? await sb.from("approvals").select("subject_id").in("subject_id", ids).eq("decision", "approve") : { data: [] as Array<{ subject_id: string }> };
  const count = new Map<string, number>();
  for (const a of ap ?? []) count.set(a.subject_id, (count.get(a.subject_id) ?? 0) + 1);

  const queue: QueueItem[] = pendRows.map((r) => {
    const ev = r.evaluation as { purpose?: string; payroll?: { items?: unknown[] } } | null;
    return {
      // Live operations carry a calldata hash; requests without one are recorded in the app only (simulation).
      id: r.id, live: !!r.calldata_hash, agent: r.agent_id, recipient: r.recipient, amountWei: String(r.amount),
      purpose: ev?.purpose ?? null, policyVersion: r.policy_version, approvals: count.get(r.id) ?? 0, required: r.required_approvals,
      createdAt: r.created_at, expiresAt: r.expires_at, payroll: ev?.payroll?.items?.length ?? null,
    };
  });

  const tenderCounts: Record<string, number> = {};
  let tenderBudgetWei = 0n;
  for (const t of (tenders.data ?? []) as Array<{ status: string; budget: string }>) {
    tenderCounts[t.status] = (tenderCounts[t.status] ?? 0) + 1;
    if (t.status !== "closed") tenderBudgetWei += big(t.budget);
  }
  const openGrants = ((grants.data ?? []) as Array<{ status: string; budget: string }>).filter((g) => g.status === "open");
  const liveRows = (live.data ?? []) as Array<{ state: string }>;
  const n = (s: string) => liveRows.filter((r) => r.state === s).length;

  return {
    session, queue, ...(pend.error ? { queueError: pend.error.message } : {}),
    tasks: ((tasks.data ?? []) as Array<{ id: string; agent_id: string; intent: string; state: string; error: string | null; result: unknown; updated_at: string }>).map((t) => ({
      id: t.id, agent: t.agent_id, intent: t.intent, state: t.state, error: t.error, updatedAt: t.updated_at, txId: (t.result as { transaction_id?: string } | null)?.transaction_id ?? null,
    })),
    ...(tasks.error ? { tasksError: tasks.error.message } : {}),
    ops: {
      tenders: tenderCounts, tenderBudgetWei, grantsOpen: openGrants.length, grantsBudgetWei: openGrants.reduce((t, g) => t + big(g.budget), 0n),
      milestonesToReview: ms.count ?? 0, disputesOpen: disputes.count ?? 0, proposalsVoting: props.count ?? 0,
    },
    live: { submitted: n("SUBMITTED"), confirmed: n("CONFIRMED"), failed: n("FAILED"), rejected: n("REJECTED") },
    members: members.error ? null : members.count ?? null,
    reviewerKey: key.error ? null : !!key.data,
  };
}

/**
 * The balance series cut to a window. The value at the window's start is the last known value before it, so the line is
 * still the real balance, just over a shorter span. Returns [] when there are not two real points to draw.
 */
export function windowed(points: BalancePoint[], spanMs: number, now = Date.now()): BalancePoint[] {
  if (points.length < 2) return [];
  const from = now - spanMs;
  if (points[0]!.date >= from) return points;
  const before = points.filter((p) => p.date < from);
  const inside = points.filter((p) => p.date >= from);
  const start = { date: from, value: before[before.length - 1]!.value };
  return [start, ...inside];
}
