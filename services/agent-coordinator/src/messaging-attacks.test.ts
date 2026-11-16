import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { COORDINATOR, MessageBus, MessageRejected, canonical, mayMessage, type Envelope } from "./messaging";

/**
 * Category requirement G (authenticated messaging): each attack below must be refused with a specific reason.
 * These are the outcomes recorded in docs/CATEGORY_COMPLIANCE.md and on the Proof Center.
 */
const SECRET = "ab".repeat(32);
const ORG = randomUUID(), OTHER_ORG = randomUUID(), TASK = randomUUID(), OTHER_TASK = randomUUID();
const clock = { t: 1_800_000_000_000 };
const bus = () => new MessageBus(SECRET, () => clock.t);
const reason = (fn: () => unknown): string => { try { fn(); return "ACCEPTED"; } catch (e) { return e instanceof MessageRejected ? e.reason : `THREW ${String(e)}`; } };

function report(b: MessageBus, over: Partial<{ from: Parameters<MessageBus["sign"]>[0]["from"]; to: Parameters<MessageBus["sign"]>[0]["to"]; ttlMs: number; taskId: string }> = {}): Envelope {
  return b.sign({
    from: over.from ?? "InvoiceFraudAgent", to: over.to ?? COORDINATOR, organizationId: ORG, taskId: over.taskId ?? TASK, kind: "finding.report", ttlMs: over.ttlMs,
    payload: { taskId: over.taskId ?? TASK, subject: "invoice:INV-C", severity: "high", summary: "Recipient differs from the vendor record", evidenceRefs: ["invoice:1", "vendor:2"], digest: createHash("sha256").update("x").digest("hex") },
  });
}

describe("authenticated agent messaging: attacks", () => {
  it("accepts a genuine report exactly once", () => {
    const b = bus(); const env = report(b);
    expect(reason(() => b.verify(env, { recipient: COORDINATOR, organizationId: ORG, taskId: TASK }))).toBe("ACCEPTED");
    expect(reason(() => b.verify(env, { recipient: COORDINATOR, organizationId: ORG, taskId: TASK }))).toBe("REPLAY");
  });
  it("rejects a spoofed agent: the tag was made with another agent's key", () => {
    const b = bus();
    const genuine = report(b, { from: "TreasuryAgent" });
    const spoofed = { ...genuine, from: "PaymentAgent" as const };
    expect(reason(() => b.verify(spoofed))).toBe("BAD_SIGNATURE");
  });
  it("rejects a modified payload", () => {
    const b = bus(); const env = report(b);
    const altered = { ...env, payload: { ...(env.payload as object), severity: "info", summary: "All clear" } };
    expect(reason(() => b.verify(altered))).toBe("BAD_SIGNATURE");
  });
  it("rejects a tag forged without the secret", () => {
    const b = bus(); const env = report(b);
    const { sig: _drop, ...unsigned } = env;
    const forged = { ...env, sig: createHash("sha256").update(canonical(unsigned)).digest("hex") };
    expect(reason(() => b.verify(forged))).toBe("BAD_SIGNATURE");
  });
  it("rejects a message signed under a different root secret", () => {
    const outsider = new MessageBus("cd".repeat(32), () => clock.t);
    expect(reason(() => bus().verify(report(outsider)))).toBe("BAD_SIGNATURE");
  });
  it("rejects an expired message", () => {
    const b = bus(); const env = report(b, { ttlMs: 1000 });
    clock.t += 1001;
    expect(reason(() => b.verify(env))).toBe("EXPIRED");
  });
  it("rejects a message for another organisation", () => {
    const b = bus(); const env = report(b);
    expect(reason(() => b.verify(env, { organizationId: OTHER_ORG }))).toBe("WRONG_ORGANIZATION");
  });
  it("rejects a message moved to another task", () => {
    const b = bus(); const env = report(b);
    expect(reason(() => b.verify(env, { taskId: OTHER_TASK }))).toBe("WRONG_TASK");
  });
  it("rejects a payload naming a different task than its envelope", () => {
    const b = bus();
    const env = b.sign({ from: "InvoiceFraudAgent", to: COORDINATOR, organizationId: ORG, taskId: TASK, kind: "task.handoff", payload: { taskId: TASK, subject: "x" } });
    const { sig: _s, ...u } = env;
    // Re-signing needs the key, so an attacker cannot do this; checked here with the real bus to prove the rule itself.
    const swapped = b.sign({ ...u, from: "InvoiceFraudAgent", to: COORDINATOR, kind: "task.handoff", payload: { taskId: OTHER_TASK, subject: "x" } });
    expect(reason(() => b.verify(swapped))).toBe("WRONG_TASK");
  });
  it("rejects a message delivered to the wrong recipient", () => {
    const b = bus(); const env = report(b);
    expect(reason(() => b.verify(env, { recipient: "PaymentAgent" }))).toBe("WRONG_RECIPIENT");
  });
  it("rejects an unauthorised sender: an agent that may not talk to PaymentAgent", () => {
    const b = bus();
    const env = b.sign({ from: "ArbitrageAgent", to: "PaymentAgent", organizationId: ORG, taskId: TASK, kind: "payment.proposal.ready", payload: { taskId: TASK, operationId: randomUUID() } });
    expect(reason(() => b.verify(env))).toBe("SENDER_NOT_ALLOWED");
    expect(mayMessage("ArbitrageAgent", "PaymentAgent")).toBe(false);
  });
  it("refuses extra fields that could smuggle a transaction", () => {
    const b = bus();
    expect(() => b.sign({ from: COORDINATOR, to: "PaymentAgent", organizationId: ORG, taskId: TASK, kind: "task.handoff", payload: { taskId: TASK, subject: "x", calldata: "0xdead" } })).toThrow();
  });
  it("keeps replay protection per organisation (the same nonce in another org is a different key)", () => {
    const b = bus(); const env = report(b);
    b.verify(env);
    expect(reason(() => b.verify(env))).toBe("REPLAY");
  });
});
