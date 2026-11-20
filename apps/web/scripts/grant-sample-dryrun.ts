/**
 * Runs the sample programme (Alpha, Beta, Gamma) through the SAME research and assessment code the website uses
 * (lib/grants/engine.ts research + assessWithAi, and the agent rules), against real GitHub, Diana and Gemini.
 * Writes nothing to any database. Prints a summary and saves the full output to deployments/grants-sample-dryrun.json.
 *
 *   cd apps/web && npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/grant-sample-dryrun.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SAMPLE_ROUND, SAMPLE_RUBRIC, applicable, budgetReview, buildScores, eligibility, milestoneReview, recommend, riskFlags, sampleApplications, technicalFacts, type EvidenceRef } from "@qoreops/agent-coordinator";
import { assessWithAi, research } from "@/lib/grants/engine";

const RUBRIC = SAMPLE_RUBRIC, round = SAMPLE_ROUND, apps = sampleApplications();

async function main() {
const out: unknown[] = [];
for (const app of apps) {
  const ev: EvidenceRef[] = (await research(app)).map((e, i) => ({ ...e, ref: `E${i + 1}` }));
  const elig = eligibility(app, round), bud = budgetReview(app, round), ms = milestoneReview(app), tech = technicalFacts(app, ev), flags = riskFlags(app, apps, ev);
  const rules = [...elig.findings, ...bud.findings, ...ms.findings, ...tech.findings];
  const ai = await assessWithAi("sample-dryrun", app, round, applicable(RUBRIC, app.category), ev, rules);
  const scores = buildScores(RUBRIC, app.category, { budget: bud, milestones: ms }, "data" in ai ? ai.data : null, ev.map((e) => e.ref), tech.state);
  const ruleQuestions = [...elig.missing, ...bud.questions, ...ms.questions];
  const questions = [...ruleQuestions, ...("data" in ai ? ai.data.questions.map((q) => ({ question: q, about: "AI-drafted (optional)" })) : [])];
  const rec = recommend(scores, flags, ruleQuestions, elig.eligible);
  const scored = scores.filter((s) => s.state === "scored");
  console.log(`\n=== ${app.name}: ${rec.recommendation.toUpperCase()} (${rec.why})`);
  console.log(`evidence: ${ev.map((e) => `${e.ref} ${e.status} ${e.claim}`).join(" | ")}`);
  console.log(`scores: ${scores.map((s) => `${s.key}=${s.state === "scored" ? `${s.score}/${s.max}` : s.state}`).join(", ")}  (${scored.reduce((t, s) => t + (s.score ?? 0), 0)}/${scored.reduce((t, s) => t + s.max, 0)})`);
  console.log(`flags: ${flags.map((f) => `${f.code}(${f.severity})`).join(", ") || "none"}`);
  console.log(`questions: ${questions.length}${questions[0] ? ` e.g. "${questions[0].question.slice(0, 140)}"` : ""}`);
  console.log(`AI: ${"data" in ai ? ai.model : `not used (${ai.error.slice(0, 120)})`}`);
  out.push({ app: app.name, recommendation: rec, evidence: ev.map(({ untrustedText: _u, ...e }) => e), scores, flags, questions, ai: "data" in ai ? { model: ai.model, strengths: ai.data.strengths, concerns: ai.data.concerns } : { error: ai.error } });
}
writeFileSync(resolve(process.cwd(), "../../deployments/grants-sample-dryrun.json"), JSON.stringify({ ranAt: new Date().toISOString(), note: "Sample programme with fictional applicants; real GitHub, Diana and Gemini; nothing written to a database.", results: out }, null, 2) + "\n");
}
main().catch((e) => { console.error(e); process.exit(1); });
