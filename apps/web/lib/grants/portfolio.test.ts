import { describe, expect, it } from "vitest";
import { alerts, disagreements, history, portfolio, receipt, type PApp, type PMs } from "./portfolio";

const W = 10n ** 18n;
const NOW = new Date("2026-12-01T12:00:00Z");
const apps: PApp[] = [
  { id: "A", name: "Alpha", status: "awarded", requested: (4000n * W).toString(), grantId: "g1", applicantUserId: "u1", content: { milestones: [{ due: "2026-11-25" }, { due: "2026-12-05" }] } },
  { id: "B", name: "Beta", status: "recommended", requested: (7000n * W).toString(), grantId: "g1", applicantUserId: "u2", content: null },
  { id: "P", name: "Alpha (previous round)", status: "awarded", requested: (1000n * W).toString(), grantId: "g0", applicantUserId: "u1", content: { milestones: [{ due: "2026-06-01" }] } },
];
const ms: PMs[] = [
  { id: "m1", parentId: "A", idx: 1, title: "MVP", amount: (2000n * W).toString(), status: "pending" },
  { id: "m2", parentId: "A", idx: 2, title: "API", amount: (2000n * W).toString(), status: "pending" },
  { id: "p1", parentId: "P", idx: 1, title: "Docs", amount: (1000n * W).toString(), status: "released" },
];

describe("portfolio", () => {
  it("sums commitments and releases from real rows only", () => {
    const p = portfolio(apps, ms, [{ milestoneId: "p1", status: "confirmed", createdAt: "2026-06-02" }], NOW);
    expect(p).toMatchObject({ awardedCount: 2, committedWei: 5000n * W, releasedWei: 1000n * W, remainingWei: 4000n * W, milestones: 3, releasedMilestones: 1, overdue: 1, completionRate: 33.3 });
  });
});

describe("alerts", () => {
  it("raises overdue and due-soon milestones, slow reviews, unfunded approvals and open high flags; a quiet repository is info only", () => {
    const list = alerts(apps, [...ms, { id: "m3", parentId: "A", idx: 3, title: "Extra", amount: "1", status: "evidence_submitted" }], [], [{ milestoneId: "m3", createdAt: "2026-11-20T00:00:00Z" }],
      [{ applicationId: "B", code: "SIMILAR_SUBMISSION", severity: "high", status: "open" }], [{ applicationId: "A", newestCommit: "2026-09-01T00:00:00Z", retrievedAt: "2026-12-01T00:00:00Z" }], {}, NOW);
    expect(list.map((x) => x.severity)).toEqual(["high", "high", "medium", "medium", "info"]);
    expect(list[0]!.text).toMatch(/was due 2026-11-25/);
    expect(list.find((x) => x.severity === "info")!.text).toMatch(/not a finding by itself/);
  });
});

describe("disagreements", () => {
  it("lists large overrides and decisions against the recommendation, with the reviewer's reason", () => {
    const reviews = [{ id: "r1", applicationId: "A", recommendation: "strong_candidate", scores: [{ key: "impact", label: "Impact", max: 10, score: 8, by: "ai" }, { key: "budget", label: "Budget", max: 10, score: null, by: "rules" }] }];
    const d = disagreements(reviews, [{ reviewId: "r1", criterion: "impact", newScore: 4, reason: "Metrics are not measurable" }, { reviewId: "r1", criterion: "impact", newScore: 7, reason: "small change" }, { reviewId: "r1", criterion: "budget", newScore: 6, reason: "Explained later" }], [{ applicationId: "A", decision: "reject", note: "Out of scope this round" }]);
    expect(d.map((x) => x.kind)).toEqual(["score", "score", "decision"]);
    expect(d[0]!.text).toBe("Impact: AI 8/10, reviewer 4/10.");
  });
});

describe("history and receipts", () => {
  it("shows an applicant's previous awarded grants with completion, without implying approval", () => {
    expect(history(apps[0]!, apps, ms)).toEqual([{ applicationId: "P", name: "Alpha (previous round)", grantId: "g0", milestones: 1, released: 1, pending: 0 }]);
  });
  it("a receipt carries a content hash, not the application text", () => {
    const r = receipt({ application: { id: "A", grantId: "g1", status: "awarded", version: 2, requested: "1", recipient: null }, versionContent: { overview: "secret plan" }, rubricVersion: 1, review: null, evidence: [], flags: [], decisions: [], milestones: [], funding: [] });
    expect(JSON.stringify(r)).not.toContain("secret plan");
    expect(r.application.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
