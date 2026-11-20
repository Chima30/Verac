/**
 * The SAMPLE "Web3 Developer Grants" programme (fictional applicants Alpha, Beta and Gamma) used by the live dry run
 * (apps/web/scripts/grant-sample-dryrun.ts) and the evaluation set (eval.test.ts). Alpha links Verac's own public
 * repository so its evidence is real; Gamma reuses Alpha's text and repository and claims a contract with no code.
 */
import type { Criterion, GrantApp, Round } from "./review";

export const Q = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const day = (d: number, from = Date.now()) => new Date(from + d * 86_400_000).toISOString().slice(0, 10);
export const SAMPLE_RUBRIC: Criterion[] = [
  { key: "relevance", label: "Project relevance", max: 20 }, { key: "technical", label: "Technical implementation", max: 20, applies_to: ["software"] },
  { key: "approach", label: "Method or approach", max: 20, applies_to: ["research", "education", "community", "other"] }, { key: "feasibility", label: "Feasibility", max: 15 },
  { key: "milestones", label: "Milestone quality", max: 15 }, { key: "budget", label: "Budget justification", max: 10 }, { key: "impact", label: "Expected impact", max: 10 }, { key: "capability", label: "Execution capability", max: 10 },
];
export const SAMPLE_ROUND: Round = { id: "sample", title: "SAMPLE Web3 Developer Grants", budget: Q(20000), awarded: "0", maxRequest: Q(8000), categories: ["software", "research", "education"], requirements: "Open-source developer tooling, research or education for QoreChain builders. Milestones must be verifiable.", deadline: null };
const alphaText = {
  overview: "Alpha builds an open-source indexer that shows grant milestone deliveries on QoreChain in one dashboard for programme managers. (Fictional sample application.)",
  problem: "Grant managers today read scattered transaction lists and spreadsheets to check whether funded teams delivered their milestones on time.",
  solution: "We index milestone transactions and contract events, link them to grant agreements, and publish a documented read-only API and a dashboard.",
  technical: "TypeScript indexer with Postgres, read-only RPC access to Diana, CI with unit and integration tests on every commit.",
};
const base = { status: "submitted", version: 1, category: "software" } as const;
/** The three applications, with milestone dates relative to `from` (default now). */
export const sampleApplications = (from = Date.now()): GrantApp[] => [
  { ...base, submittedAt: "2026-11-19T10:00:00Z", id: "alpha", applicantUserId: "u-alpha", name: "SAMPLE Project Alpha", requested: Q(4000), recipient: "0xA1fA000000000000000000000000000000000001", recipientHistory: ["0xA1fA000000000000000000000000000000000001"],
    content: { ...alphaText, team: "Two engineers who maintain an SDK (fictional).", experience: "Maintainers of an open-source TypeScript SDK since 2025 (fictional).", metrics: "Three grant programmes use the API within two months of release, measured by API keys issued.", timeline: "Eight weeks.",
      links: { repos: ["https://github.com/Chima30/Verac"] }, contracts: [], transactions: [],
      budget: [{ item: "Engineer A: 8 weeks at 250 QOR per week", amount: Q(2000) }, { item: "Engineer B: 6 weeks at 250 QOR per week", amount: Q(1500) }, { item: "Hosting and RPC for 12 months", amount: Q(500) }],
      milestones: [{ title: "Indexer MVP", deliverable: "Indexer deployed against Diana with documented endpoints and tests.", verification: "Public endpoint URL and a tagged release on GitHub.", due: day(30, from), amount: Q(2000) },
        { title: "Dashboard and API v1", deliverable: "Dashboard published and API v1 released with usage documentation.", verification: "Dashboard URL, release v1.0 and the documentation site.", due: day(60, from), amount: Q(2000) }] } },
  { ...base, submittedAt: "2026-11-19T11:00:00Z", id: "beta", applicantUserId: "u-beta", name: "SAMPLE Project Beta", requested: Q(7000), recipient: "0xBe7A000000000000000000000000000000000002", recipientHistory: ["0xBe7A000000000000000000000000000000000002"],
    content: { overview: "Beta is a wallet analytics tool for DAO treasurers that tracks outgoing grant payments over time. (Fictional sample application.)", problem: "Treasurers lack a clear view of outgoing grant payments over time across many wallets.",
      solution: "We extend Beta with grant payment tracking and alerts for overdue milestones, with exports.", technical: "Next.js application with a Rust backend.", team: "Three developers (fictional).", metrics: "Ten DAOs onboarded within three months.", timeline: "Ten weeks.",
      links: { demo: "https://verac-web.vercel.app" }, contracts: [], transactions: [], budget: [{ item: "Development", amount: Q(7000) }],
      milestones: [{ title: "Phase 1", deliverable: "Complete the protocol.", verification: "Trust us", due: day(20, from), amount: Q(3500) }, { title: "Phase 2", deliverable: "Release v2 with alerts and exports.", verification: "Release notes and a demo video link.", due: day(50, from), amount: Q(3500) }] } },
  { ...base, submittedAt: "2026-11-19T12:00:00Z", id: "gamma", applicantUserId: "u-gamma", name: "SAMPLE Project Gamma", requested: Q(3000), recipient: "0x6A3A000000000000000000000000000000000003", recipientHistory: ["0x6A3A000000000000000000000000000000000003"],
    content: { ...alphaText, overview: alphaText.overview.replace("Alpha", "Gamma"), team: "One engineer (fictional).", metrics: "Programmes onboarded within two months.", timeline: "Six weeks.",
      links: { repos: ["https://github.com/Chima30/Verac"] }, contracts: ["0x000000000000000000000000000000000000dEaD"], transactions: [],
      budget: [{ item: "Engineering", amount: Q(2500) }, { item: "Hosting", amount: Q(500) }],
      milestones: [{ title: "Indexer", deliverable: "Indexer deployed against Diana with documented endpoints.", verification: "Endpoint URL and a release tag.", due: day(30, from), amount: Q(3000) }] } },
];

