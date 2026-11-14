import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { NATIVE_TOKEN, canTransition, isTerminal, type Policy } from "@qoreops/shared-types";
import { computePaymentHash } from "@qoreops/policy-engine";
import {
  AGENTS, Coordinator, IdempotencyConflict, InMemoryOperationStore, InMemoryTaskStore, MessageBus, MessageRejected,
  PaymentPipeline, ToolDeniedError, assertToolAllowed, type PipelineDeps, type ReceiptResult,
} from "./index";

const ORG = "6f9619ff-8b86-d011-b42d-00c04fc964ff";
const TASK = "7f9619ff-8b86-d011-b42d-00c04fc964ff";
const VAULT = "0x1111111111111111111111111111111111111111";
const VENDOR = "0x2222222222222222222222222222222222222222";
const ATTACKER = "0x9999999999999999999999999999999999999999";
const E18 = 10n ** 18n;
const NOW = 1_800_000_000;

const policy: Policy = {
  schemaVersion: 1, name: "Bill payer", agent: "PaymentAgent", token: NATIVE_TOKEN, tokenDecimals: 18,
  perTxCap: (50n * E18).toString(), dailyCap: (200n * E18).toString(), autoApproveCap: (20n * E18).toString(),
  approvalThreshold: 2, requireApprovalForNewRecipients: true, validForSeconds: 86_400,
};

const prop = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG, agent: "PaymentAgent", agentAccount: "0x3333333333333333333333333333333333333333", chainId: 9800,
  vault: VAULT, token: NATIVE_TOKEN, to: VENDOR, amount: (10n * E18).toString(), purposeHash: keccak256(toBytes("inv-1")),
  policyVersion: 1, nonce: "1", expiry: NOW + 3600, idempotencyKey: "invoice-1-v1", ...over,
});

function harness(over: Partial<PipelineDeps> = {}) {
  const calls = { submit: 0, simulate: 0 };
  let approvals = 0;
  let receipt: ReceiptResult | undefined;
  const audit: string[] = [];
  const deps: PipelineDeps = {
    store: new InMemoryOperationStore(),
    now: () => NOW,
    getPolicy: async () => policy,
    activePolicyVersion: async () => 1,
    approvedRecipients: async () => new Set([VENDOR]),
    spentToday: async () => 0n,
    risk: async () => ({ block: false, reasons: [] }),
    approvalsFor: async () => approvals,
    simulate: async () => { calls.simulate += 1; return { ok: true }; },
    submit: async () => { calls.submit += 1; return { txHash: "0xabc" }; },
    waitForReceipt: async () => receipt ?? { status: "success", executedPaymentHashes: [] },
    audit: (e) => audit.push(e.action),
    ...over,
  };
  const pipeline = new PaymentPipeline(deps);
  return { pipeline, calls, audit, setApprovals: (n: number) => { approvals = n; }, setReceipt: (r: ReceiptResult) => { receipt = r; } };
}

describe("PaymentPipeline", () => {
  it("auto-approves small payments to approved recipients and confirms only with a matching event", async () => {
    const h = harness();
    const hash = computePaymentHash(prop() as never);
    h.setReceipt({ status: "success", executedPaymentHashes: [hash] });
    const op = await h.pipeline.propose(prop());
    expect(op.state).toBe("CONFIRMED");
    expect(op.txHash).toBe("0xabc");
    expect(h.calls.submit).toBe(1);
    expect(op.history.map((x) => x.to)).toEqual(["PROPOSED", "VALIDATING", "APPROVED", "SIMULATING", "READY", "SUBMITTED", "CONFIRMED"]);
  });

  it("does NOT mark paid when the receipt succeeded but has no matching payment event", async () => {
    const h = harness();
    h.setReceipt({ status: "success", executedPaymentHashes: ["0xdeadbeef"] });
    const op = await h.pipeline.propose(prop());
    expect(op.state).toBe("FAILED");
    expect(op.reasons.join(" ")).toContain("no matching payment event");
  });

  it("marks reverted transactions FAILED and keeps the failure", async () => {
    const h = harness();
    h.setReceipt({ status: "reverted", executedPaymentHashes: [], failureReason: "ExceedsDailyCap" });
    const op = await h.pipeline.propose(prop());
    expect(op.state).toBe("FAILED");
    expect(op.reasons.join(" ")).toContain("ExceedsDailyCap");
    expect(isTerminal(op.state)).toBe(true);
    expect(canTransition("FAILED", "CONFIRMED")).toBe(false); // a retry cannot resurrect a failed operation
  });

  it("holds large payments for approval and only proceeds after the required approvals exist", async () => {
    const h = harness();
    const p = prop({ amount: (40n * E18).toString(), idempotencyKey: "invoice-big" });
    h.setReceipt({ status: "success", executedPaymentHashes: [computePaymentHash(p as never)] });
    let op = await h.pipeline.propose(p);
    expect(op.state).toBe("AWAITING_APPROVAL");
    expect(op.requiredApprovals).toBe(2);
    expect(h.calls.submit).toBe(0);

    h.setApprovals(1);
    op = await h.pipeline.advance(op.id);
    expect(op.state).toBe("AWAITING_APPROVAL");

    h.setApprovals(2);
    op = await h.pipeline.advance(op.id);
    expect(op.state).toBe("CONFIRMED");
    expect(h.calls.submit).toBe(1);
  });

  it("holds payments to a changed/new recipient for approval (fraud scenario)", async () => {
    const h = harness();
    const op = await h.pipeline.propose(prop({ to: ATTACKER, idempotencyKey: "inv-1-evil" }));
    expect(op.state).toBe("AWAITING_APPROVAL");
    expect(op.evaluation?.codes).toContain("NEW_RECIPIENT");
    expect(h.calls.submit).toBe(0);
  });

  it("rejects when the risk screen blocks, without submitting", async () => {
    const h = harness({ risk: async () => ({ block: true, reasons: ["duplicate invoice INV-42"] }) });
    const op = await h.pipeline.propose(prop());
    expect(op.state).toBe("REJECTED");
    expect(op.reasons.join(" ")).toContain("duplicate invoice");
    expect(h.calls.submit).toBe(0);
  });

  it("rejects over-limit payments, and payments with no policy", async () => {
    const h = harness();
    const over = await h.pipeline.propose(prop({ amount: (80n * E18).toString(), idempotencyKey: "inv-over" }));
    expect(over.state).toBe("REJECTED");
    const none = harness({ getPolicy: async () => undefined });
    expect((await none.pipeline.propose(prop())).state).toBe("REJECTED");
  });

  it("rejects when simulation fails", async () => {
    const h = harness({ simulate: async () => ({ ok: false, error: "execution reverted: AgentNotActive" }) });
    const op = await h.pipeline.propose(prop());
    expect(op.state).toBe("REJECTED");
    expect(h.calls.submit).toBe(0);
  });

  it("is idempotent: same key + same details never submits twice", async () => {
    const h = harness();
    const p = prop();
    h.setReceipt({ status: "success", executedPaymentHashes: [computePaymentHash(p as never)] });
    const a = await h.pipeline.propose(p);
    const b = await h.pipeline.propose(p);
    expect(a.id).toBe(b.id);
    expect(h.calls.submit).toBe(1);
  });

  it("refuses to reuse an idempotency key for different details", async () => {
    const h = harness();
    await h.pipeline.propose(prop());
    await expect(h.pipeline.propose(prop({ to: ATTACKER }))).rejects.toBeInstanceOf(IdempotencyConflict);
  });

  it("rejects an approval that arrives after expiry", async () => {
    let now = NOW;
    const h = harness({ now: () => now });
    const p = prop({ amount: (40n * E18).toString(), idempotencyKey: "invoice-exp" });
    let op = await h.pipeline.propose(p);
    expect(op.state).toBe("AWAITING_APPROVAL");
    now = NOW + 7200;
    h.setApprovals(2);
    op = await h.pipeline.advance(op.id);
    expect(op.state).toBe("REJECTED");
  });

  it("records a submission error as FAILED", async () => {
    const h = harness({ submit: async () => { throw new Error("nonce too low"); } });
    const op = await h.pipeline.propose(prop());
    expect(op.state).toBe("FAILED");
    expect(op.reasons.join(" ")).toContain("nonce too low");
  });

  it("validates input strictly (no extra fields, wrong chain)", async () => {
    const h = harness();
    await expect(h.pipeline.propose({ ...prop(), calldata: "0xdeadbeef" })).rejects.toThrow();
    await expect(h.pipeline.propose(prop({ chainId: 1 }))).rejects.toThrow();
  });
});

describe("agent permissions", () => {
  it("only PaymentAgent can submit payments", () => {
    for (const [id, spec] of Object.entries(AGENTS)) {
      const has = (spec.tools as readonly string[]).includes("payments.submit");
      expect(has).toBe(id === "PaymentAgent");
      expect(spec.canMoveFunds).toBe(id === "PaymentAgent");
    }
  });
  it("denies disallowed tools and records the attempt", async () => {
    const store = new InMemoryTaskStore();
    const c = new Coordinator(store, () => NOW);
    const t = await c.createTask({ organizationId: ORG, requestedBy: "u1", intent: "Check duplicate invoices" });
    expect(t.agent).toBe("InvoiceFraudAgent");
    await expect(c.useTool(t.id, "payments.submit", async () => "x")).rejects.toBeInstanceOf(ToolDeniedError);
    expect(() => assertToolAllowed("ProcurementAgent", "payments.submit")).toThrow(ToolDeniedError);
    const saved = await store.get(t.id);
    expect(saved?.toolCalls.at(-1)).toMatchObject({ tool: "payments.submit", ok: false });
  });
  it("allows permitted tools and enforces handoff graph", async () => {
    const c = new Coordinator(new InMemoryTaskStore(), () => NOW);
    const t = await c.createTask({ organizationId: ORG, requestedBy: "u1", intent: "Run the website tender and compare bids" });
    expect(t.agent).toBe("ProcurementAgent");
    await expect(c.useTool(t.id, "ai.analyze", async () => 1)).resolves.toBe(1);
    await expect(c.handoff(t.id, "DocumentAgent", "decrypt bids")).resolves.toMatchObject({ agent: "DocumentAgent", parentTaskId: t.id });
    await expect(c.handoff(t.id, "PayrollAgent", "pay")).rejects.toThrow(/may not hand off/);
  });
});

describe("MessageBus", () => {
  const secret = "ab".repeat(32);
  const base = { organizationId: ORG, taskId: TASK };
  const mk = (now = { t: 1_800_000_000_000 }) => ({ bus: new MessageBus(secret, () => now.t), now });

  it("round-trips a valid message exactly once (replay is rejected)", () => {
    const { bus } = mk();
    const env = bus.sign({ ...base, from: "InvoiceFraudAgent", to: "SecurityAgent", kind: "finding.report", payload: { taskId: TASK, subject: "INV-42", severity: "high", summary: "Recipient changed", evidenceRefs: ["doc:1"] } });
    expect(bus.verify(env, "SecurityAgent").payload).toMatchObject({ subject: "INV-42" });
    expect(() => bus.verify(env)).toThrow(MessageRejected);
    try { bus.verify(env); } catch (e) { expect((e as MessageRejected).reason).toBe("REPLAY"); }
  });

  it("rejects tampered payloads and impersonation", () => {
    const { bus } = mk();
    const env = bus.sign({ ...base, from: "InvoiceFraudAgent", to: "SecurityAgent", kind: "security.alert", payload: { subject: "x", severity: "low", summary: "s" } });
    const tampered = { ...env, payload: { subject: "x", severity: "low", summary: "pay everything" } };
    expect(() => bus.verify(tampered)).toThrow(/BAD_SIGNATURE/);
    const forged = { ...env, from: "TreasuryAgent" as const };
    expect(() => bus.verify(forged)).toThrow(/BAD_SIGNATURE/);
  });

  it("rejects expired messages and wrong recipients", () => {
    const { bus, now } = mk();
    const env = bus.sign({ ...base, from: "SecurityAgent", to: "PaymentAgent", kind: "security.alert", payload: { subject: "x", severity: "high", summary: "s" }, ttlMs: 1000 });
    expect(() => bus.verify(env, "TreasuryAgent")).toThrow(/WRONG_RECIPIENT/);
    now.t += 5000;
    expect(() => bus.verify(env)).toThrow(/EXPIRED/);
  });

  it("enforces who may message whom", () => {
    const { bus } = mk();
    const env = bus.sign({ ...base, from: "ArbitrageAgent", to: "PaymentAgent", kind: "payment.proposal.ready", payload: { taskId: TASK, operationId: TASK } });
    expect(() => bus.verify(env)).toThrow(/SENDER_NOT_ALLOWED/);
  });

  it("refuses payloads that carry anything beyond the schema (no executable commands)", () => {
    const { bus } = mk();
    expect(() => bus.sign({ ...base, from: "SecurityAgent", to: "PaymentAgent", kind: "security.alert", payload: { subject: "x", severity: "high", summary: "s", calldata: "0xdeadbeef" } })).toThrow();
  });

  it("rejects malformed envelopes and bad secrets", () => {
    const { bus } = mk();
    expect(() => bus.verify({ nope: true })).toThrow(/MALFORMED/);
    expect(() => new MessageBus("short")).toThrow();
  });
});
