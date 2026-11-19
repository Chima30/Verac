/**
 * Runs the sample programme (Alpha, Beta, Gamma) through the SAME research and assessment code the website uses
 * (lib/grants/engine.ts research + assessWithAi, and the agent rules), against real GitHub, Diana and Gemini.
 * Writes nothing to any database. Prints a summary and saves the full output to deployments/grants-sample-dryrun.json.
 *
 *   cd apps/web && npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/grant-sample-dryrun.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicable, budgetReview, buildScores, eligibility, milestoneReview, recommend, riskFlags, technicalFacts, type Criterion, type EvidenceRef, type GrantApp, type Round } from "@qoreops/agent-coordinator";
import { assessWithAi, research } from "@/lib/grants/engine";

const Q = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const RUBRIC: Criterion[] = [
  { key: "relevance", label: "Project relevance", max: 20 }, { key: "technical", label: "Technical implementation", max: 20, applies_to: ["software"] },
  { key: "approach", label: "Method or approach", max: 20, applies_to: ["research", "education", "community", "other"] }, { key: "feasibility", label: "Feasibility", max: 15 },
  { key: "milestones", label: "Milestone quality", max: 15 }, { key: "budget", label: "Budget justification", max: 10 }, { key: "impact", label: "Expected impact", max: 10 }, { key: "capability", label: "Execution capability", max: 10 },
];
const round: Round = { id: "sample", title: "SAMPLE Web3 Developer Grants", budget: Q(20000), awarded: "0", maxRequest: Q(8000), categories: ["software", "research", "education"], requirements: "Open-source developer tooling, research or education for QoreChain builders. Milestones must be verifiable.", deadline: null };
const alphaText = {
  overview: "Alpha builds an open-source indexer that shows grant milestone deliveries on QoreChain in one dashboard for programme managers. (Fictional sample application.)",
  problem: "Grant managers today read scattered transaction lists and spreadsheets to check whether funded teams delivered their milestones on time.",
  solution: "We index milestone transactions and contract events, link them to grant agreements, and publish a documented read-only API and a dashboard.",
  technical: "TypeScript indexer with Postgres, read-only RPC access to Diana, CI with unit and integration tests on every commit.",
};
const base = { status: "submitted", version: 1, category: "software" } as const;
const apps: GrantApp[] = [
  { ...base, submittedAt: "2026-11-19T10:00:00Z", id: "alpha", applicantUserId: "u-alpha", name: "SAMPLE Project Alpha", requested: Q(4000), recipient: "0xA1fA000000000000000000000000000000000001", recipientHistory: ["0xA1fA000000000000000000000000000000000001"],
    content: { ...alphaText, team: "Two engineers who maintain an SDK (fictional).", experience: "Maintainers of an open-source TypeScript SDK since 2025 (fictional).", metrics: "Three grant programmes use the API within two months of release, measured by API keys issued.", timeline: "Eight weeks.",
      links: { repos: ["https://github.com/Chima30/Verac"] }, contracts: [], transactions: [],
      budget: [{ item: "Engineer A: 8 weeks at 250 QOR per week", amount: Q(2000) }, { item: "Engineer B: 6 weeks at 250 QOR per week", amount: Q(1500) }, { item: "Hosting and RPC for 12 months", amount: Q(500) }],
      milestones: [{ title: "Indexer MVP", deliverable: "Indexer deployed against Diana with documented endpoints and tests.", verification: "Public endpoint URL and a tagged release on GitHub.", due: day(30), amount: Q(2000) },
        { title: "Dashboard and API v1", deliverable: "Dashboard published and API v1 released with usage documentation.", verification: "Dashboard URL, release v1.0 and the documentation site.", due: day(60), amount: Q(2000) }] } },
  { ...base, submittedAt: "2026-11-19T11:00:00Z", id: "beta", applicantUserId: "u-beta", name: "SAMPLE Project Beta", requested: Q(7000), recipient: "0xBe7A000000000000000000000000000000000002", recipientHistory: ["0xBe7A000000000000000000000000000000000002"],
    content: { overview: "Beta is a wallet analytics tool for DAO treasurers that tracks outgoing grant payments over time. (Fictional sample application.)", problem: "Treasurers lack a clear view of outgoing grant payments over time across many wallets.",
      solution: "We extend Beta with grant payment tracking and alerts for overdue milestones, with exports.", technical: "Next.js application with a Rust backend.", team: "Three developers (fictional).", metrics: "Ten DAOs onboarded within three months.", timeline: "Ten weeks.",
      links: { demo: "https://verac-web.vercel.app" }, contracts: [], transactions: [], budget: [{ item: "Development", amount: Q(7000) }],
      milestones: [{ title: "Phase 1", deliverable: "Complete the protocol.", verification: "Trust us", due: day(20), amount: Q(3500) }, { title: "Phase 2", deliverable: "Release v2 with alerts and exports.", verification: "Release notes and a demo video link.", due: day(50), amount: Q(3500) }] } },
  { ...base, submittedAt: "2026-11-19T12:00:00Z", id: "gamma", applicantUserId: "u-gamma", name: "SAMPLE Project Gamma", requested: Q(3000), recipient: "0x6A3A000000000000000000000000000000000003", recipientHistory: ["0x6A3A000000000000000000000000000000000003"],
    content: { ...alphaText, overview: alphaText.overview.replace("Alpha", "Gamma"), team: "One engineer (fictional).", metrics: "Programmes onboarded within two months.", timeline: "Six weeks.",
      links: { repos: ["https://github.com/Chima30/Verac"] }, contracts: ["0x000000000000000000000000000000000000dEaD"], transactions: [],
      budget: [{ item: "Engineering", amount: Q(2500) }, { item: "Hosting", amount: Q(500) }],
      milestones: [{ title: "Indexer", deliverable: "Indexer deployed against Diana with documented endpoints.", verification: "Endpoint URL and a release tag.", due: day(30), amount: Q(3000) }] } },
];

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
