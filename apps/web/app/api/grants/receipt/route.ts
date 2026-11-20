import { NextResponse } from "next/server";
import { z } from "zod";
import { receipt } from "@/lib/grants/portfolio";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Exportable decision receipt for one application (reviewers only): rubric version, sources, AI and rule findings, flags,
 * human decisions, milestone agreement and on-chain payment references. The application text itself is not included,
 * only its hash. Read through the signed-in user's row-level security.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!["owner", "administrator", "security_reviewer"].includes(s.org.role)) return NextResponse.json({ error: "Reviewers only." }, { status: 403 });
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get("app"));
  if (!id.success) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const sb = (await supabaseServer())!;
  const { data: a } = await sb.from("grant_applications").select("id,grant_id,status,version,requested_amount::text,recipient_address").eq("id", id.data).eq("organization_id", s.org.id).maybeSingle();
  if (!a) return NextResponse.json({ error: "Application not found." }, { status: 404 });
  const [{ data: v }, { data: rv }, { data: fl }, { data: au }, { data: ms }, { data: fd }] = await Promise.all([
    sb.from("grant_application_versions").select("content").eq("application_id", a.id).eq("version", a.version || 1).maybeSingle(),
    sb.from("grant_reviews").select("id,task_id,recommendation,scored_points,scored_max,scores,model,created_at,rubric_version").eq("application_id", a.id).order("created_at", { ascending: false }).limit(1),
    sb.from("grant_risk_flags").select("code,severity,status,decided_reason").eq("application_id", a.id),
    sb.from("audit_events").select("action,actor,created_at,detail").eq("organization_id", s.org.id).eq("subject", a.id).like("action", "grant.%").order("created_at"),
    sb.from("milestones").select("id,idx,title,amount::text,status,release_tx_hash").eq("parent_type", "grant").eq("parent_id", a.id).order("idx"),
    sb.from("grant_funding_records").select("milestone_id,status,route,tx_hash,block_number").eq("application_id", a.id),
  ]);
  const review = (rv ?? [])[0];
  const { data: ev } = review?.task_id ? await sb.from("grant_evidence").select("source,claim,status,url,retrieved_at").eq("task_id", review.task_id).eq("application_id", a.id) : { data: [] };
  const body = receipt({
    application: { id: a.id, grantId: a.grant_id, status: a.status, version: a.version || 1, requested: String(a.requested_amount), recipient: a.recipient_address },
    versionContent: v?.content ?? null, rubricVersion: review?.rubric_version ?? null,
    review: review ? { id: review.id, recommendation: review.recommendation, scoredPoints: Number(review.scored_points), scoredMax: Number(review.scored_max), scores: review.scores, model: review.model, createdAt: review.created_at } : null,
    evidence: (ev ?? []).map((e) => ({ source: e.source, claim: e.claim, status: e.status, url: e.url, retrievedAt: e.retrieved_at })),
    flags: (fl ?? []).map((f) => ({ code: f.code, severity: f.severity, status: f.status, decidedReason: f.decided_reason })),
    decisions: (au ?? []).map((x) => ({ action: x.action, actor: x.actor, at: x.created_at, detail: x.detail })),
    milestones: (ms ?? []).map((m) => ({ idx: m.idx, title: m.title, amount: String(m.amount), status: m.status, releaseTx: m.release_tx_hash })),
    funding: (fd ?? []).map((f) => ({ milestoneIdx: (ms ?? []).find((m) => m.id === f.milestone_id)?.idx ?? null, status: f.status, route: f.route, txHash: f.tx_hash, block: f.block_number })),
  });
  return new NextResponse(JSON.stringify(body, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="verac-grant-receipt-${a.id.slice(0, 8)}.json"` } });
}
