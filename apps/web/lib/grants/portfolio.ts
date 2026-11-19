/**
 * Grant portfolio figures, monitoring alerts, reviewer disagreements and decision receipts. Pure functions over rows that
 * were read from the database: no figure here is estimated or invented.
 */
import { createHash } from "node:crypto";

export interface PApp { id: string; name: string; status: string; requested: string; grantId: string; applicantUserId: string; content: { milestones?: Array<{ due: string }> } | null }
export interface PMs { id: string; parentId: string; idx: number; title: string; amount: string; status: string }
export interface PFund { milestoneId: string | null; status: string; createdAt: string }
export interface PSub { milestoneId: string; createdAt: string }
export interface PFlag { applicationId: string; code: string; severity: string; status: string }
export interface PActivity { applicationId: string; newestCommit: string | null; retrievedAt: string }
export interface Alert { severity: "high" | "medium" | "info"; text: string; applicationId: string }

const big = (v: string) => BigInt(String(v).split(".")[0]!);
const dueOf = (a: PApp | undefined, idx: number) => a?.content?.milestones?.[idx - 1]?.due ?? null;

export function portfolio(apps: PApp[], ms: PMs[], fund: PFund[], now = new Date()) {
  const awarded = apps.filter((a) => a.status === "awarded");
  const awardedIds = new Set(awarded.map((a) => a.id));
  const mine = ms.filter((m) => awardedIds.has(m.parentId));
  const amountOf = (id: string | null) => big(mine.find((m) => m.id === id)?.amount ?? "0");
  const released = fund.filter((f) => f.status === "confirmed").reduce((t, f) => t + amountOf(f.milestoneId), 0n);
  const requested = fund.filter((f) => f.status === "requested").reduce((t, f) => t + amountOf(f.milestoneId), 0n);
  const committed = awarded.reduce((t, a) => t + big(a.requested), 0n);
  const overdue = mine.filter((m) => m.status === "pending" && (() => { const d = dueOf(apps.find((a) => a.id === m.parentId), m.idx); return !!d && new Date(d) < now; })());
  const releasedCount = mine.filter((m) => m.status === "released").length;
  return {
    awardedCount: awarded.length, committedWei: committed, releasedWei: released, requestedWei: requested, remainingWei: committed - released,
    milestones: mine.length, releasedMilestones: releasedCount, overdue: overdue.length,
    completionRate: mine.length ? Math.round((releasedCount / mine.length) * 1000) / 10 : null,
  };
}

/** Alerts worth a human's attention. Fewer, specific alerts beat many vague ones. */
export function alerts(apps: PApp[], ms: PMs[], fund: PFund[], subs: PSub[], flags: PFlag[], activity: PActivity[], opts: { dueSoonDays?: number; reviewAfterDays?: number; quietDays?: number } = {}, now = new Date()): Alert[] {
  const out: Alert[] = [];
  const day = 86_400_000;
  const name = (id: string) => apps.find((a) => a.id === id)?.name ?? "an application";
  for (const m of ms) {
    const a = apps.find((x) => x.id === m.parentId);
    if (!a || a.status !== "awarded") continue;
    const due = dueOf(a, m.idx);
    if (m.status === "pending" && due) {
      const left = (new Date(due).getTime() - now.getTime()) / day;
      if (left < 0) out.push({ severity: "high", applicationId: a.id, text: `${a.name}: milestone ${m.idx} ("${m.title}") was due ${due} and has no evidence yet.` });
      else if (left <= (opts.dueSoonDays ?? 7)) out.push({ severity: "medium", applicationId: a.id, text: `${a.name}: milestone ${m.idx} is due in ${Math.ceil(left)} day(s) (${due}).` });
    }
    if (m.status === "evidence_submitted") {
      const last = subs.filter((x) => x.milestoneId === m.id).map((x) => x.createdAt).sort().pop();
      if (last && (now.getTime() - new Date(last).getTime()) / day > (opts.reviewAfterDays ?? 3)) out.push({ severity: "medium", applicationId: a.id, text: `${a.name}: evidence for milestone ${m.idx} has waited ${Math.floor((now.getTime() - new Date(last).getTime()) / day)} days for review.` });
    }
    if (m.status === "approved" && fund.some((f) => f.milestoneId === m.id && f.status === "awaiting_authorised_path") && !fund.some((f) => f.milestoneId === m.id && ["requested", "confirmed"].includes(f.status))) {
      out.push({ severity: "medium", applicationId: a.id, text: `${a.name}: milestone ${m.idx} is approved but waits for an authorised funding path.` });
    }
  }
  for (const f of flags) if (f.status === "open" && f.severity === "high" && ["recommended", "awarded"].includes(apps.find((a) => a.id === f.applicationId)?.status ?? "")) out.push({ severity: "high", applicationId: f.applicationId, text: `${name(f.applicationId)}: high-severity flag ${f.code.replace(/_/g, " ").toLowerCase()} is still open.` });
  for (const act of activity) {
    const a = apps.find((x) => x.id === act.applicationId);
    if (!a || a.status !== "awarded" || !act.newestCommit) continue;
    const quiet = (now.getTime() - new Date(act.newestCommit).getTime()) / day;
    if (quiet > (opts.quietDays ?? 30)) out.push({ severity: "info", applicationId: a.id, text: `${a.name}: no public commits for ${Math.floor(quiet)} days (checked ${act.retrievedAt.slice(0, 10)}). Work may be private or off GitHub; this is not a finding by itself.` });
  }
  const rank = { high: 0, medium: 1, info: 2 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}

export interface DScore { key: string; label: string; max: number; score: number | null; by: string }
export interface DOverride { reviewId: string; criterion: string; newScore: number; reason: string }
/** Where people and the AI disagree: overrides of 30% of a criterion's range or more, and decisions against the recommendation. */
export function disagreements(reviews: Array<{ id: string; applicationId: string; scores: DScore[]; recommendation: string }>, overrides: DOverride[], decisions: Array<{ applicationId: string; decision: string; note: string }>) {
  const out: Array<{ applicationId: string; kind: "score" | "decision"; text: string; reason: string }> = [];
  for (const o of overrides) {
    const r = reviews.find((x) => x.id === o.reviewId);
    const s = r?.scores.find((x) => x.key === o.criterion);
    if (!r || !s) continue;
    if (s.score === null) out.push({ applicationId: r.applicationId, kind: "score", text: `${s.label}: the report left it unscored; a reviewer scored ${o.newScore}/${s.max}.`, reason: o.reason });
    else if (Math.abs(o.newScore - s.score) >= 0.3 * s.max) out.push({ applicationId: r.applicationId, kind: "score", text: `${s.label}: ${s.by === "rules" ? "rules" : "AI"} ${s.score}/${s.max}, reviewer ${o.newScore}/${s.max}.`, reason: o.reason });
  }
  for (const d of decisions) {
    const r = reviews.filter((x) => x.applicationId === d.applicationId).pop();
    if (!r) continue;
    if ((r.recommendation === "strong_candidate" && d.decision === "reject") || (r.recommendation === "further_review" && d.decision === "recommend")) {
      out.push({ applicationId: d.applicationId, kind: "decision", text: `The report said "${r.recommendation.replace("_", " ")}"; a reviewer chose to ${d.decision}.`, reason: d.note });
    }
  }
  return out;
}

/** Previous grants of the same applicant (other applications), for renewal context. Past funding never implies approval. */
export function history(app: PApp, all: PApp[], ms: PMs[]) {
  return all.filter((a) => a.applicantUserId === app.applicantUserId && a.id !== app.id && a.status === "awarded").map((a) => {
    const own = ms.filter((m) => m.parentId === a.id);
    return { applicationId: a.id, name: a.name, grantId: a.grantId, milestones: own.length, released: own.filter((m) => m.status === "released").length, pending: own.filter((m) => m.status !== "released").length };
  });
}

/** A decision receipt: references and hashes, not private application text. */
export function receipt(input: {
  application: { id: string; grantId: string; status: string; version: number; requested: string; recipient: string | null };
  versionContent: unknown; rubricVersion: number | null; review: { id: string; recommendation: string; scoredPoints: number; scoredMax: number; scores: unknown; model: string | null; createdAt: string } | null;
  evidence: Array<{ source: string; claim: string; status: string; url: string; retrievedAt: string }>; flags: Array<{ code: string; severity: string; status: string; decidedReason: string | null }>;
  decisions: Array<{ action: string; actor: string; at: string; detail: unknown }>; milestones: Array<{ idx: number; title: string; amount: string; status: string; releaseTx: string | null }>;
  funding: Array<{ milestoneIdx: number | null; status: string; route: string; txHash: string | null; block: number | null }>;
}) {
  return {
    format: "verac-grant-decision-receipt/1",
    generatedAt: new Date().toISOString(),
    note: "References and hashes only: the application text is not included. Database records are Verac's own records, not tamper-proof; on-chain references can be checked on the explorer.",
    application: { ...input.application, contentSha256: createHash("sha256").update(JSON.stringify(input.versionContent ?? null)).digest("hex") },
    rubricVersion: input.rubricVersion,
    aiAndRuleFindings: input.review,
    sources: input.evidence,
    riskFlags: input.flags,
    humanDecisions: input.decisions,
    milestoneAgreement: input.milestones,
    funding: input.funding,
  };
}
