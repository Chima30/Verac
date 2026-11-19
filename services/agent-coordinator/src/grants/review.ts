/**
 * Grant review: what each specialist agent concludes, from records and collected evidence only.
 *
 * Deterministic code decides everything that is arithmetic or a rule: eligibility, budget figures, milestone checks,
 * similarity, risk flags, the budget and milestone scores, the recommendation category. A language model (Gemini) may
 * score the judgement criteria (relevance, technical/approach, feasibility, impact, capability), but only with references
 * to evidence it was given; a score without a valid reference is discarded as "missing". The model never decides an
 * award, a rejection or an amount.
 *
 * Kept apart in every report: applicant CLAIMS, observed FACTS (evidence), AI ASSESSMENTS, RULE results, HUMAN decisions.
 */
import { z } from "zod";
import type { Evidence, EvidenceStatus } from "./evidence";

// ------------------------------------------------------------------ inputs (read from the database; never invented)
export interface Criterion { key: string; label: string; max: number; guidance?: string; applies_to?: string[] }
export interface Milestone { title: string; deliverable: string; verification: string; due: string; amount: string }
export interface AppContent {
  overview?: string; problem?: string; solution?: string; team?: string; experience?: string; technical?: string; metrics?: string; timeline?: string;
  links?: { website?: string; docs?: string; demo?: string; repos?: string[] };
  contracts?: string[]; transactions?: string[];
  budget?: Array<{ item: string; amount: string }>;
  milestones?: Milestone[];
}
export interface GrantApp {
  id: string; applicantUserId: string; name: string; category: string | null; requested: string; recipient: string | null; status: string; version: number;
  content: AppContent; submittedAt: string | null; recipientHistory: string[];
}
export interface Round { id: string; title: string; budget: string; awarded: string; maxRequest: string | null; categories: string[]; requirements: string | null; deadline: string | null }
export interface EvidenceRef extends Evidence { ref: string } // E1, E2, … within one application

// ------------------------------------------------------------------ findings
export type GrantSeverity = "low" | "medium" | "high";
export interface Flag { code: string; severity: GrantSeverity; message: string; evidence: Record<string, unknown> }
export interface GrantFinding { agent: string; kind: "rule" | "fact" | "ai"; text: string; refs?: string[] }
export interface Question { question: string; about: string }
export type ScoreState = "scored" | "missing" | "inapplicable" | "source_failure" | "not_assessed";
export interface Score { key: string; label: string; max: number; score: number | null; state: ScoreState; explanation: string; evidence_refs: string[]; missing: string[]; by: "rules" | "ai" }

const WEI = 10n ** 18n;
const toQor = (wei: string | bigint) => Number(BigInt(wei) / 10n ** 12n) / 1e6;
const fmt = (wei: string | bigint) => toQor(wei).toLocaleString("en-US", { maximumFractionDigits: 6 });

/** Criteria that apply to a category. A criterion without applies_to applies to all. */
export const applicable = (criteria: Criterion[], category: string | null) => criteria.filter((c) => !c.applies_to?.length || (!!category && c.applies_to.includes(category)));

// ------------------------------------------------------------------ Grant Review Agent: eligibility and completeness (rules)
export function eligibility(app: GrantApp, round: Round): { eligible: boolean; findings: GrantFinding[]; missing: Question[] } {
  const f: GrantFinding[] = [];
  const missing: Question[] = [];
  const req = BigInt(app.requested);
  let eligible = true;
  if (!app.category || !round.categories.includes(app.category)) { eligible = false; f.push({ agent: "GrantAgent", kind: "rule", text: `Category "${app.category ?? "none"}" is not one this round accepts (${round.categories.join(", ")}).` }); }
  if (req > BigInt(round.budget)) { eligible = false; f.push({ agent: "GrantAgent", kind: "rule", text: `Requests ${fmt(req)} QOR, more than the whole round budget of ${fmt(round.budget)} QOR.` }); }
  if (round.maxRequest && req > BigInt(round.maxRequest)) { eligible = false; f.push({ agent: "GrantAgent", kind: "rule", text: `Requests ${fmt(req)} QOR, above the ${fmt(round.maxRequest)} QOR per-application maximum.` }); }
  if (eligible) f.push({ agent: "GrantAgent", kind: "rule", text: `Meets the round's category and amount rules (${fmt(req)} QOR requested; ${fmt(BigInt(round.budget) - BigInt(round.awarded))} QOR not yet awarded).` });
  const c = app.content;
  if (!c.experience?.trim()) missing.push({ about: "experience", question: "Please describe relevant previous work a reviewer can check (links to past projects, publications or releases)." });
  if (app.category === "software" && !(c.links?.repos?.length) && !c.links?.demo) missing.push({ about: "technical evidence", question: "No public repository or demo was provided. That is acceptable; please describe how reviewers can see the current state of the work (for example a recorded demo, a private repository walkthrough, or test reports)." });
  if (!c.metrics || c.metrics.trim().length < 30) missing.push({ about: "success metrics", question: "Please give measurable success metrics: what number or outcome will show the project worked, and by when?" });
  return { eligible, findings: f, missing };
}

// ------------------------------------------------------------------ Treasury / Budget Agent (rules)
const VAGUE_BUDGET = /^(development|engineering|work|misc(ellaneous)?|other|costs?|expenses?|team|salary|salaries|operations?)\b/i;
export function budgetReview(app: GrantApp, round: Round): { score: number; max: number; findings: GrantFinding[]; questions: Question[]; figures: Record<string, string | number> } {
  const lines = app.content.budget ?? [];
  const req = BigInt(app.requested);
  const findings: GrantFinding[] = [];
  const questions: Question[] = [];
  const total = lines.reduce((t, l) => t + BigInt(/^[0-9]+$/.test(l.amount) ? l.amount : "0"), 0n);
  const largest = lines.reduce((m, l) => (BigInt(l.amount) > m ? BigInt(l.amount) : m), 0n);
  const share = req > 0n ? Number((largest * 1000n) / req) / 10 : 0;
  const vague = lines.filter((l) => VAGUE_BUDGET.test(l.item.trim()) && l.item.trim().split(/\s+/).length <= 3);
  let points = 10;
  if (total !== req) { points -= 5; findings.push({ agent: "TreasuryAgent", kind: "rule", text: `Budget lines add up to ${fmt(total)} QOR, not the ${fmt(req)} QOR requested.` }); }
  if (lines.length <= 1) { points -= 4; questions.push({ about: "budget", question: `Your proposal requests ${fmt(req)} QOR, but the budget has ${lines.length ? "a single line" : "no lines"}. Please break it down: roles or items, time, and rate.` }); findings.push({ agent: "TreasuryAgent", kind: "rule", text: `${lines.length} budget line(s): the allocation is not explained.` }); }
  else if (share > 70) { points -= 2; questions.push({ about: "budget", question: `One budget line ("${lines.find((l) => BigInt(l.amount) === largest)?.item}") is ${share}% of the request. Please explain how that amount was estimated.` }); findings.push({ agent: "TreasuryAgent", kind: "rule", text: `The largest line is ${share}% of the request.` }); }
  if (vague.length) { points -= 2; questions.push({ about: "budget", question: `These budget lines are too general to assess: ${vague.map((v) => `"${v.item}"`).join(", ")}. Please describe what each pays for.` }); }
  const remaining = BigInt(round.budget) - BigInt(round.awarded);
  if (req > remaining) findings.push({ agent: "TreasuryAgent", kind: "rule", text: `The request (${fmt(req)} QOR) is more than the budget still unawarded (${fmt(remaining)} QOR).` });
  if (points === 10) findings.push({ agent: "TreasuryAgent", kind: "rule", text: `${lines.length} budget lines add up exactly to the request; the largest is ${share}% of it.` });
  return { score: Math.max(0, points), max: 10, findings, questions, figures: { requestedQor: toQor(req), budgetLines: lines.length, largestLineSharePct: share, remainingInRoundQor: toQor(remaining) } };
}

// ------------------------------------------------------------------ Milestone Evaluation Agent (rules)
const VAGUE_MS = /\b(complete|finish|finalise|finalize|improve|work on|continue|polish|various|etc\.?|and so on|tbd|misc)\b/i;
const MEASURABLE = /\b(deploy(ed)?|release(d)?|publish(ed)?|merge(d)?|test(s|ed)?|document(ed|ation)?|audit(ed)?|api|endpoint|version|v\d|tag|report|workshop|tutorial|course|paper|dataset|dashboard|contract|transaction|users?|participants?|\d+)\b/i;
export function milestoneReview(app: GrantApp, today = new Date()): { score: number; max: number; findings: GrantFinding[]; questions: Question[] } {
  const ms = app.content.milestones ?? [];
  const findings: GrantFinding[] = [];
  const questions: Question[] = [];
  let points = 15;
  if (!ms.length) return { score: 0, max: 15, findings: [{ agent: "MilestoneAgent", kind: "rule", text: "No milestones were proposed." }], questions: [{ about: "milestones", question: "Please propose milestones with a deliverable, a due date, an amount and how a reviewer can verify each." }] };
  const req = BigInt(app.requested);
  ms.forEach((m, i) => {
    const n = i + 1;
    const vague = VAGUE_MS.test(m.deliverable) && !MEASURABLE.test(m.deliverable);
    if (vague) { points -= 3; questions.push({ about: `milestone ${n}`, question: `Milestone ${n} ("${m.title}") says "${m.deliverable.slice(0, 120)}", which does not describe a deliverable a reviewer can check. What exactly will exist when it is done, and how can it be verified?` }); }
    if (!m.verification || m.verification.trim().length < 15) { points -= 2; questions.push({ about: `milestone ${n}`, question: `Milestone ${n} ("${m.title}"): how can a reviewer verify completion (a link, release, transaction, report)?` }); }
    const days = (new Date(m.due).getTime() - today.getTime()) / 86_400_000;
    if (Number.isFinite(days) && days < 7) { points -= 1; findings.push({ agent: "MilestoneAgent", kind: "rule", text: `Milestone ${n} is due in ${Math.max(0, Math.round(days))} day(s): very tight.` }); }
  });
  const largest = ms.reduce((mx, m) => (BigInt(m.amount) > mx ? BigInt(m.amount) : mx), 0n);
  const share = req > 0n ? Number((largest * 1000n) / req) / 10 : 0;
  if (ms.length > 1 && share > 70) { points -= 2; findings.push({ agent: "MilestoneAgent", kind: "rule", text: `One milestone carries ${share}% of the funding, so most payment would depend on a single delivery.` }); }
  if (ms.length === 1 && req > 1000n * WEI) { points -= 2; findings.push({ agent: "MilestoneAgent", kind: "rule", text: "A single milestone for the whole request: no intermediate checkpoint." }); }
  const dues = ms.map((m) => m.due);
  if (dues.some((d, i) => i > 0 && d < dues[i - 1]!)) { points -= 1; findings.push({ agent: "MilestoneAgent", kind: "rule", text: "Milestone due dates are not in order." }); }
  if (points === 15) findings.push({ agent: "MilestoneAgent", kind: "rule", text: `${ms.length} milestones, each with a deliverable and a verification method; the largest carries ${share}% of the funding.` });
  return { score: Math.max(0, points), max: 15, findings, questions };
}

// ------------------------------------------------------------------ Grant Risk Agent (rules)
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
export function shingles(s: string, k = 5): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(" "));
  return out;
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
const proposalText = (a: GrantApp) => [a.content.overview, a.content.problem, a.content.solution, a.content.technical].filter(Boolean).join("\n");
const INJECTION = /\b(ignore (all |the )?(previous|prior|above) (instructions|rules)|disregard (the )?(rules|instructions)|you are (now )?an? (ai|assistant|model)|system prompt|score (this|it|me) (100|10\/10|highly)|approve (this|it) (application|grant|payment))\b/i;

export function riskFlags(app: GrantApp, all: GrantApp[], evidence: EvidenceRef[]): Flag[] {
  const flags: Flag[] = [];
  const mine = shingles(proposalText(app));
  for (const o of all) {
    if (o.id === app.id) continue;
    const sim = jaccard(mine, shingles(proposalText(o)));
    if (sim >= 0.35) {
      // When both submission times are known, the earlier application is the likely original: it gets a low note, the later one the flag.
      const earlier = !!app.submittedAt && !!o.submittedAt && app.submittedAt < o.submittedAt;
      const later = !!app.submittedAt && !!o.submittedAt && app.submittedAt > o.submittedAt;
      flags.push({
        code: "SIMILAR_SUBMISSION", severity: earlier ? "low" : sim >= 0.6 ? "high" : "medium",
        message: earlier
          ? `A later application, "${o.name}", shares ${Math.round(sim * 100)}% of five-word passages with this one. This application was submitted first.`
          : `${Math.round(sim * 100)}% of five-word passages are shared with ${later ? "an earlier application, " : ""}"${o.name}". This can be legitimate (same template, same team, joint project); a reviewer should compare them.`,
        evidence: { otherApplication: o.id, similarity: Math.round(sim * 1000) / 1000, submittedFirst: earlier ? "this application" : later ? "the other application" : "unknown", method: "Jaccard similarity of 5-word shingles over overview, problem, solution and technical sections" },
      });
    }
    const sharedRepos = (app.content.links?.repos ?? []).map((r) => r.toLowerCase().replace(/\/$/, "")).filter((r) => (o.content.links?.repos ?? []).map((x) => x.toLowerCase().replace(/\/$/, "")).includes(r));
    if (sharedRepos.length) flags.push({ code: "SHARED_REPOSITORY", severity: "medium", message: `The same repository is listed by "${o.name}": ${sharedRepos.join(", ")}. A link does not prove ownership; ask both applicants about their roles.`, evidence: { otherApplication: o.id, repos: sharedRepos } });
    if (app.recipient && o.recipient && app.recipient.toLowerCase() === o.recipient.toLowerCase() && app.applicantUserId !== o.applicantUserId) flags.push({ code: "SHARED_RECIPIENT", severity: "high", message: `The payout address is also given by "${o.name}", a different applicant.`, evidence: { otherApplication: o.id, recipient: app.recipient } });
  }
  if (new Set(app.recipientHistory.map((x) => x.toLowerCase())).size > 1) flags.push({ code: "RECIPIENT_CHANGED", severity: "high", message: `The payout address changed between versions (${app.recipientHistory.join(" → ")}). Confirm the change with the applicant through a known channel.`, evidence: { history: app.recipientHistory } });
  for (const e of evidence.filter((x) => x.status === "CONTRADICTED")) flags.push({ code: "CONTRADICTED_CLAIM", severity: "medium", message: `${e.claim}: ${e.reason}`, evidence: { ref: e.ref, url: e.url, subject: e.subject } });
  const forks = evidence.filter((e) => e.source === "github" && (e.observed as { fork?: boolean }).fork);
  for (const e of forks) flags.push({ code: "FORKED_REPOSITORY", severity: "low", message: `${e.subject} is a fork of ${(e.observed as { parent?: string }).parent ?? "another repository"}. Reusing open source is legitimate; check which work is the applicant's own.`, evidence: { ref: e.ref, url: e.url } });
  if (INJECTION.test(JSON.stringify(app.content))) flags.push({ code: "INSTRUCTION_IN_TEXT", severity: "high", message: "The application contains text addressed to an automated reviewer. It was treated as data; a human should read it.", evidence: {} });
  return flags;
}

// ------------------------------------------------------------------ Technical Evaluation Agent: facts from evidence (rules)
export function technicalFacts(app: GrantApp, evidence: EvidenceRef[]): { findings: GrantFinding[]; state: "evidence" | "unavailable" | "none" } {
  const gh = evidence.filter((e) => e.source === "github");
  const chain = evidence.filter((e) => e.source === "qorechain");
  const f: GrantFinding[] = [];
  for (const e of [...gh, ...chain]) if (e.status !== "UNVERIFIED" || e.claim.startsWith("The application says")) f.push({ agent: "TechnicalEvaluationAgent", kind: "fact", text: `${e.claim}: ${statusWord(e.status)}. ${e.reason}`, refs: [e.ref] });
  if (!gh.length && !chain.length) return { findings: [{ agent: "TechnicalEvaluationAgent", kind: "fact", text: app.category === "software" ? "No repository, contract or transaction was provided, so there is no technical evidence to inspect. This is not a negative finding; ask how the work can be shown." : "Not a software project: no technical artefacts were expected." }], state: "none" };
  const usable = [...gh, ...chain].some((e) => e.status !== "UNAVAILABLE");
  return { findings: f, state: usable ? "evidence" : "unavailable" };
}
const statusWord = (s: EvidenceStatus) => ({ VERIFIED: "verified", PARTIALLY_VERIFIED: "partially verified", UNVERIFIED: "not verified", CONTRADICTED: "contradicted", UNAVAILABLE: "source unavailable" })[s];

// ------------------------------------------------------------------ AI assessment (Gemini) contract
export const AiAssessmentSchema = z.object({
  criteria: z.array(z.object({
    key: z.string().max(40),
    score: z.number().min(0).max(100).nullable(),
    explanation: z.string().max(700),
    evidence_refs: z.array(z.string().max(40)).max(12),
    missing: z.array(z.string().max(300)).max(5),
  })).max(12),
  strengths: z.array(z.string().max(300)).max(5),
  concerns: z.array(z.string().max(300)).max(5),
  questions: z.array(z.string().max(400)).max(5),
});
export type AiAssessment = z.infer<typeof AiAssessmentSchema>;
/** Criteria a rule scores; the AI's numbers for these are ignored. */
export const RULE_SCORED = new Set(["budget", "milestones"]);
/** Section names an AI may cite as a reference, besides evidence refs (E1, E2, …). */
export const SECTION_REFS = ["overview", "problem", "solution", "team", "experience", "technical", "metrics", "timeline", "budget", "milestones"].map((s) => `section:${s}`);

/** Builds per-criterion scores: rules for budget and milestones; validated AI scores for the rest; never a silent zero. */
export function buildScores(criteria: Criterion[], category: string | null, rules: { budget: { score: number; max: number }; milestones: { score: number; max: number } }, ai: AiAssessment | null, refs: string[], techState: "evidence" | "unavailable" | "none"): Score[] {
  const valid = new Set([...refs, ...SECTION_REFS]);
  return criteria.map((c): Score => {
    const base = { key: c.key, label: c.label, max: c.max, evidence_refs: [] as string[], missing: [] as string[] };
    if (!applicable([c], category).length) return { ...base, score: null, state: "inapplicable", explanation: `Does not apply to ${category ?? "this"} projects.`, by: "rules" };
    if (c.key === "budget" || c.key === "milestones") {
      const r = rules[c.key];
      return { ...base, score: Math.round((r.score / r.max) * c.max * 10) / 10, state: "scored", explanation: `Scored by fixed rules (${r.score}/${r.max}); see the ${c.key === "budget" ? "budget" : "milestone"} review.`, evidence_refs: [`section:${c.key}`], by: "rules" };
    }
    if (c.key === "technical" && techState === "unavailable" && category === "software") return { ...base, score: null, state: "source_failure", explanation: "Every technical source was unavailable (not found, private or rate limited). Not scored; ask the applicant or retry later.", by: "rules" };
    const a = ai?.criteria.find((x) => x.key === c.key);
    if (!ai) return { ...base, score: null, state: "not_assessed", explanation: "The AI assessment was not available; a reviewer can score this manually.", by: "rules" };
    if (!a || a.score === null) return { ...base, score: null, state: "missing", explanation: a?.explanation || "Not enough information to score.", missing: a?.missing ?? [], by: "ai" };
    const cited = a.evidence_refs.filter((r) => valid.has(r));
    if (!cited.length) return { ...base, score: null, state: "missing", explanation: `The AI gave a score without citing evidence or an application section, so it was discarded. Its note: ${a.explanation.slice(0, 300)}`, missing: a.missing, by: "ai" };
    return { ...base, score: Math.min(c.max, Math.max(0, Math.round(a.score * 10) / 10)), state: "scored", explanation: a.explanation, evidence_refs: cited, missing: a.missing, by: "ai" };
  });
}

export type Recommendation = "strong_candidate" | "needs_clarification" | "further_review";
/**
 * A category for human attention, decided by rules: never an award or rejection. `questions` are the RULE questions
 * (required information found missing); optional AI-drafted questions go into the clarification draft but do not hold back
 * an otherwise complete application.
 */
export function recommend(scores: Score[], flags: Flag[], questions: Question[], eligible: boolean): { recommendation: Recommendation; why: string } {
  if (!eligible) return { recommendation: "further_review", why: "It does not meet the round's eligibility rules." };
  const high = flags.filter((f) => f.severity === "high");
  if (high.length) return { recommendation: "further_review", why: `${high.length} high-severity flag(s) need a human look first.` };
  if (questions.length) return { recommendation: "needs_clarification", why: `${questions.length} question(s) should be answered before deciding.` };
  const scored = scores.filter((s) => s.state === "scored");
  const pts = scored.reduce((t, s) => t + (s.score ?? 0), 0), max = scored.reduce((t, s) => t + s.max, 0);
  const unscored = scores.filter((s) => ["missing", "source_failure", "not_assessed"].includes(s.state));
  if (unscored.length) return { recommendation: "further_review", why: `${unscored.length} criteria could not be scored from the available evidence.` };
  if (max && pts / max >= 0.7) return { recommendation: "strong_candidate", why: `Scored ${pts} of ${max} applicable points with no open questions or high flags.` };
  return { recommendation: "further_review", why: `Scored ${pts} of ${max} applicable points.` };
}

/** Deterministic allocation within a budget: greedy by a chosen score, never splitting an application. Advisory. */
export function allocate(items: Array<{ id: string; name: string; requestedWei: bigint; value: number }>, budgetWei: bigint): { funded: string[]; totalWei: bigint; leftWei: bigint; skipped: Array<{ id: string; reason: string }> } {
  const sorted = [...items].sort((a, b) => b.value - a.value || (a.requestedWei < b.requestedWei ? -1 : 1));
  const funded: string[] = []; const skipped: Array<{ id: string; reason: string }> = [];
  let left = budgetWei;
  for (const it of sorted) {
    if (it.requestedWei <= left) { funded.push(it.id); left -= it.requestedWei; }
    else skipped.push({ id: it.id, reason: `needs ${fmt(it.requestedWei)} QOR; ${fmt(left)} QOR left` });
  }
  return { funded, totalWei: budgetWei - left, leftWei: left, skipped };
}
