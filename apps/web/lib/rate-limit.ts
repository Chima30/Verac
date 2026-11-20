/**
 * SERVER ONLY. Request limits for API routes, shared by every server instance through Postgres (migration 0022,
 * take_rate_limit). If that is unavailable (migration not applied, or no service key), falls back to a per-instance
 * counter so a limit still applies. Keys are the client's IP address and route group; nothing else is stored.
 */
import { NextResponse } from "next/server";

export const LIMITS = {
  /** Calls that spend AI quota. */
  ai: { max: 10, windowSeconds: 60 },
  /** Starting a multi-agent workflow or a grants investigation. */
  workflow: { max: 5, windowSeconds: 60 },
  /** Proposing, approving, signing or executing a payment. */
  money: { max: 20, windowSeconds: 60 },
  /** Polling a running workflow. */
  poll: { max: 120, windowSeconds: 60 },
  /** Public read-only chain and status reads. */
  read: { max: 60, windowSeconds: 60 },
} as const;
export type LimitGroup = keyof typeof LIMITS;

const local = new Map<string, number[]>();
function localTake(key: string, max: number, windowSeconds: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now(), win = windowSeconds * 1000;
  const recent = (local.get(key) ?? []).filter((t) => now - t < win);
  recent.push(now);
  local.set(key, recent);
  if (local.size > 10_000) local.clear();
  return { allowed: recent.length <= max, retryAfter: Math.max(1, Math.ceil((recent[0]! + win - now) / 1000)) };
}

/** The client address Vercel reports (first x-forwarded-for entry), or "unknown". */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "unknown";
}

let sharedDown = 0; // after a failure, use the local counter for a minute instead of retrying the database every request

/**
 * Counts this request. Returns null when it is allowed, or a 429 response to return as is.
 * `who` can narrow the key (for example a user id) instead of the IP address.
 */
export async function rateLimit(req: Request, group: LimitGroup, who?: string): Promise<NextResponse | null> {
  const { max, windowSeconds } = LIMITS[group];
  const key = `${group}:${who ?? clientIp(req)}`.slice(0, 200);
  let res: { allowed: boolean; retryAfter: number } | null = null;
  if (Date.now() > sharedDown) {
    try {
      const { serviceClient } = await import("@/lib/live/service");
      const { data, error } = await serviceClient().rpc("take_rate_limit", { p_key: key, p_window_seconds: windowSeconds, p_max: max });
      const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean; retry_after_seconds: number } | null;
      if (error || !row) throw new Error(error?.message ?? "no result");
      res = { allowed: row.allowed, retryAfter: row.retry_after_seconds };
    } catch {
      sharedDown = Date.now() + 60_000;
    }
  }
  res ??= localTake(key, max, windowSeconds);
  if (res.allowed) return null;
  return NextResponse.json({ error: `Too many requests. Try again in ${res.retryAfter} second${res.retryAfter === 1 ? "" : "s"}.` }, { status: 429, headers: { "Retry-After": String(res.retryAfter) } });
}
