import { describe, expect, it } from "vitest";
import { categoryChecks, runPassed } from "./category";

describe("category evidence", () => {
  it("counts a run as passed only when the outcome is the expected one", () => {
    expect(runPassed("refused", "refused")).toBe(true);
    expect(runPassed("execution failed: spending limit exceeded", "refused")).toBe(true);
    expect(runPassed("execution succeeded", "refused")).toBe(false);
    expect(runPassed("ADMITTED (unexpected) 0xabc", "refused")).toBe(false);
    expect(runPassed("linked", "admitted")).toBe(true);
    expect(runPassed("refused", "admitted")).toBe(false);
  });
  it("never claims an on-chain verification without a transaction or a recorded run", () => {
    for (const c of categoryChecks()) if (c.status === "verified-onchain") expect(c.txHash || c.actual).toBeTruthy();
  });
  it("shows planned proofs as not yet verified while nothing has been recorded", () => {
    expect(categoryChecks().find((c) => c.id === "F-3")!.status).toBe("not-verified");
  });
});
