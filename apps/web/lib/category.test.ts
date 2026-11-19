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
  it("takes F-3 from the run recorded on 2026-11-17, with its transaction, and grades it as a refusal", () => {
    const f3 = categoryChecks().find((c) => c.id === "F-3")!;
    expect(f3.status).toBe("verified-onchain");
    expect(f3.txHash).toBe("01D93889DB917AA3D6203CD719AFDF56B7521FFB519F3409DB9504EE9A09C6B6");
    expect(f3.actual).toMatch(/^execution failed: per-tx limit/);
  });
});
