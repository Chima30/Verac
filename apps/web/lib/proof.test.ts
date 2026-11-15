import { describe, expect, it } from "vitest";
import { RUN } from "./live-run";
import { classify, contractOf, evidenceDoc, verification } from "./proof";

describe("proof classification", () => {
  it("puts every refused attempt under rejected, whatever its label", () => {
    for (const t of RUN.filter((r) => r.expect === "reverted")) expect(classify(t)).toBe("rejected");
  });
  it("recognises deployments, escrow funding, releases and payments", () => {
    expect(classify({ group: "Deployment", label: "Deploy TreasuryVault", expect: "success" })).toBe("deployment");
    expect(classify({ group: "x", label: "Agent funds escrow 60 QOR (approved)", expect: "success" })).toBe("escrow-funding");
    expect(classify({ group: "x", label: "RELEASE: 60 QOR paid to the contractor", expect: "success" })).toBe("escrow-release");
    expect(classify({ group: "x", label: "PAYMENT: 1 QOR to the approved recipient", expect: "success" })).toBe("payment");
    expect(classify({ group: "x", label: "Fund vault with 20 QOR", expect: "success" })).toBe("payment");
    expect(classify({ group: "x", label: "Set agent limits: 10 QOR per payment, 20 per day", expect: "success" })).toBe("authorisation");
  });
  it("gives every recorded transaction exactly one kind", () => {
    const kinds = new Set(RUN.map(classify));
    expect(kinds.size).toBeGreaterThan(3);
  });
  it("names the contract only when the label does", () => {
    expect(contractOf("Deploy PolicyManager")).toBe("PolicyManager");
    expect(contractOf("Register escrow with the vault")).toBe("MilestoneEscrow");
    expect(contractOf("Open EVM windows, deployer and agent (1)")).toBeNull();
  });
  it("links each run to its written record", () => {
    expect(evidenceDoc("First website payment, 2026-11-15")).toBe("docs/LIVE_PAYMENT_2026-11-15.md");
    expect(evidenceDoc("Live execution setup, 2026-11-15")).toBe("docs/LIVE_SETUP_2026-11-15.md");
    expect(evidenceDoc("Deployment")).toBe("docs/LIVE_RUN_2026-11-14.md");
  });
  it("never reports an unchecked or missing transaction as verified", () => {
    expect(verification("success", "success")).toBe("verified");
    expect(verification("reverted", "reverted")).toBe("refused-as-expected");
    expect(verification("success", "reverted")).toBe("mismatch");
    expect(verification("reverted", "success")).toBe("mismatch");
    expect(verification("success", "not found")).toBe("mismatch");
    expect(verification("success", "unavailable")).toBe("unverifiable");
  });
});
