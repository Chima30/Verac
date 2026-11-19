import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { githubEvidence, githubGetter } from "@qoreops/agent-coordinator";
import { advanceGrantWorkflow } from "@/lib/grants/engine";
import { serviceClient } from "@/lib/live/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled grant monitoring. Call with `Authorization: Bearer $CRON_SECRET` (for example daily).
 *  1. Resumes grant investigations nobody is watching (a closed tab or a crashed worker).
 *  2. Re-reads public repository activity for AWARDED grants, at most once a week per application, unless the round set
 *     rules.monitoring.repo_activity to "off". Results are evidence rows; a quiet repository is shown as information, never
 *     as a failure. Nothing here approves, rejects or pays.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  const sb = serviceClient();
  const out: { investigations: Array<{ id: string; ran: string | null }>; activity: Array<{ application: string; items: number }>; skipped: number } = { investigations: [], activity: [], skipped: 0 };

  const { data: tasks } = await sb.from("agent_tasks").select("id").eq("kind", "grant_review").in("state", ["QUEUED", "RUNNING"]).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).order("updated_at").limit(3);
  for (const t of tasks ?? []) {
    for (let i = 0; i < 4; i++) { const r = await advanceGrantWorkflow(t.id as string); out.investigations.push({ id: t.id as string, ran: r.ran }); if (!r.ran) break; }
  }

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: apps } = await sb.from("grant_applications").select("id,organization_id,grant_id,version,content").eq("status", "awarded").limit(50);
  const { data: rounds } = await sb.from("grants").select("id,rules").in("id", [...new Set((apps ?? []).map((a) => a.grant_id as string))]);
  const get = githubGetter(process.env.GITHUB_TOKEN?.trim() || undefined);
  for (const a of apps ?? []) {
    const rules = (rounds ?? []).find((r) => r.id === a.grant_id)?.rules as { monitoring?: { repo_activity?: string } } | undefined;
    const repos = ((a.content as { links?: { repos?: string[] } } | null)?.links?.repos ?? []).slice(0, 3);
    if (rules?.monitoring?.repo_activity === "off" || !repos.length) { out.skipped++; continue; }
    const { count } = await sb.from("grant_evidence").select("id", { count: "exact", head: true }).eq("application_id", a.id).like("claim", "Monitoring:%").gte("retrieved_at", weekAgo);
    if (count) { out.skipped++; continue; }
    const items = [];
    for (const repo of repos) items.push(...(await githubEvidence(repo, get)).filter((e) => e.claim !== "The README describes the project"));
    if (items.length) await sb.from("grant_evidence").insert(items.map((e) => ({
      organization_id: a.organization_id, application_id: a.id, application_version: (a.version as number) || 1, source: e.source, subject: e.subject.slice(0, 300),
      claim: `Monitoring: ${e.claim}`.slice(0, 300), status: e.status, reason: e.reason.slice(0, 1000), observed: e.observed, url: e.url.slice(0, 500), retrieved_at: e.retrievedAt,
    })));
    out.activity.push({ application: a.id as string, items: items.length });
  }
  return NextResponse.json(out);
}
