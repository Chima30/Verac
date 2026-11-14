import { describe, expect, it } from "vitest";
import { PolicyDraftSchema, computePaymentHash, describePolicy, evaluatePayment, policyFromDraft, qorToWei, validatePolicy, type EvaluationContext } from "./index";
import { NATIVE_TOKEN, PaymentProposalSchema, type Policy } from "@qoreops/shared-types";
import { keccak256, toBytes } from "viem";

const ORG = "6f9619ff-8b86-d011-b42d-00c04fc964ff";
const VAULT = "0x1111111111111111111111111111111111111111";
const VENDOR = "0x2222222222222222222222222222222222222222";
const AGENT_ACCT = "0x3333333333333333333333333333333333333333";
const E18 = 10n ** 18n;

const policy: Policy = {
  schemaVersion: 1,
  name: "Bill payer",
  agent: "PaymentAgent",
  token: NATIVE_TOKEN,
  tokenDecimals: 18,
  perTxCap: (50n * E18).toString(),
  dailyCap: (200n * E18).toString(),
  autoApproveCap: (20n * E18).toString(),
  approvalThreshold: 2,
  requireApprovalForNewRecipients: true,
  validForSeconds: 86_400,
};

const NOW = 1_800_000_000;
const ctx = (over: Partial<EvaluationContext> = {}): EvaluationContext => ({
  now: NOW,
  approvedRecipients: new Set([VENDOR]),
  spentToday: 0n,
  activePolicyVersion: 3,
  ...over,
});

const proposal = (over: Record<string, unknown> = {}) =>
  PaymentProposalSchema.parse({
    organizationId: ORG,
    agent: "PaymentAgent",
    agentAccount: AGENT_ACCT,
    chainId: 9800,
    vault: VAULT,
    token: NATIVE_TOKEN,
    to: VENDOR,
    amount: (12n * E18).toString(),
    purposeHash: keccak256(toBytes("invoice-1")),
    policyVersion: 3,
    nonce: "7",
    expiry: 1_800_086_400,
    idempotencyKey: "invoice-1-attempt-1",
    ...over,
  });

describe("computePaymentHash", () => {
  it("matches the Solidity TreasuryVault.paymentHash vector (contracts/test/HashVector.t.sol)", () => {
    const h = computePaymentHash(
      proposal({ to: "0x2222222222222222222222222222222222222222" }),
    );
    expect(h).toBe("0xbaa105045e98ce07d24489c65e81c1f4a84846d062cc7735f307a4ece9907321");
  });
  it("changes when any bound field changes", () => {
    const base = computePaymentHash(proposal());
    expect(computePaymentHash(proposal({ to: "0x4444444444444444444444444444444444444444" }))).not.toBe(base);
    expect(computePaymentHash(proposal({ amount: (13n * E18).toString() }))).not.toBe(base);
    expect(computePaymentHash(proposal({ nonce: "8" }))).not.toBe(base);
    expect(computePaymentHash(proposal({ policyVersion: 4 }))).not.toBe(base);
    expect(computePaymentHash(proposal({ expiry: 1_800_086_401 }))).not.toBe(base);
    expect(computePaymentHash(proposal({ agentAccount: "0x5555555555555555555555555555555555555555" }))).not.toBe(base);
  });
});

describe("evaluatePayment", () => {
  it("allows small payments to approved recipients", () => {
    const r = evaluatePayment(policy, proposal(), ctx());
    expect(r.decision).toBe("ALLOW");
    expect(r.requiredApprovals).toBe(0);
  });
  it("requires approvals above the auto ceiling", () => {
    const r = evaluatePayment(policy, proposal({ amount: (40n * E18).toString() }), ctx());
    expect(r.decision).toBe("REQUIRE_APPROVAL");
    expect(r.requiredApprovals).toBe(2);
    expect(r.codes).toContain("ABOVE_AUTO_APPROVE");
  });
  it("requires approvals for a new recipient even for tiny amounts", () => {
    const r = evaluatePayment(policy, proposal({ to: "0x9999999999999999999999999999999999999999", amount: "1" }), ctx());
    expect(r.decision).toBe("REQUIRE_APPROVAL");
    expect(r.codes).toContain("NEW_RECIPIENT");
  });
  it("rejects over per-tx cap", () => {
    const r = evaluatePayment(policy, proposal({ amount: (51n * E18).toString() }), ctx());
    expect(r.decision).toBe("REJECT");
    expect(r.codes).toContain("EXCEEDS_PER_TX_CAP");
  });
  it("rejects when daily cap would be exceeded", () => {
    const r = evaluatePayment(policy, proposal({ amount: (10n * E18).toString() }), ctx({ spentToday: 195n * E18 }));
    expect(r.decision).toBe("REJECT");
    expect(r.codes).toContain("EXCEEDS_DAILY_CAP");
  });
  it("rejects expired, far-future, wrong policy version, no policy", () => {
    expect(evaluatePayment(policy, proposal({ expiry: NOW - 1 }), ctx()).codes).toContain("EXPIRED");
    expect(evaluatePayment(policy, proposal({ expiry: NOW + 8 * 86_400 }), ctx()).codes).toContain("EXPIRY_TOO_FAR");
    expect(evaluatePayment(policy, proposal({ policyVersion: 2 }), ctx()).codes).toContain("POLICY_VERSION_MISMATCH");
    expect(evaluatePayment(policy, proposal(), ctx({ activePolicyVersion: 0 })).codes).toContain("POLICY_NOT_ACTIVE");
  });
  it("rejects wrong agent / token / recipient not on allow-list", () => {
    expect(evaluatePayment(policy, proposal({ agent: "PayrollAgent" }), ctx()).codes).toContain("AGENT_MISMATCH");
    expect(evaluatePayment(policy, proposal({ token: "0x6666666666666666666666666666666666666666" }), ctx()).codes).toContain("TOKEN_MISMATCH");
    const strict = { ...policy, allowedRecipients: ["0x7777777777777777777777777777777777777777"] };
    expect(evaluatePayment(strict, proposal(), ctx()).codes).toContain("RECIPIENT_NOT_ALLOWED");
  });
  it("rejects zero amount", () => {
    expect(evaluatePayment(policy, proposal({ amount: "0" }), ctx()).codes).toContain("ZERO_AMOUNT");
  });
});

describe("validatePolicy", () => {
  it("accepts a consistent policy and flags a single-approver warning", () => {
    const ok = validatePolicy({ ...policy, approvalThreshold: 1 });
    expect(ok.ok).toBe(true);
    expect(ok.findings.map((f) => f.code)).toContain("SINGLE_APPROVER");
  });
  it("rejects contradictions", () => {
    const bad = validatePolicy({ ...policy, dailyCap: "1", autoApproveCap: (60n * E18).toString() });
    expect(bad.ok).toBe(false);
    expect(bad.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["DAILY_LT_PERTX", "AUTO_GT_PERTX"]));
  });
  it("rejects malformed LLM output (unknown keys, negative numbers, bad addresses)", () => {
    expect(validatePolicy({ ...policy, sneaky: true }).ok).toBe(false);
    expect(validatePolicy({ ...policy, perTxCap: "-5" }).ok).toBe(false);
    expect(validatePolicy({ ...policy, token: "not-an-address" }).ok).toBe(false);
    expect(validatePolicy("drop table").ok).toBe(false);
  });
  it("describes the policy in plain language", () => {
    const lines = describePolicy(policy);
    expect(lines[0]).toContain("50 QOR per transaction");
    expect(lines[0]).toContain("200 QOR per UTC day");
  });
});

describe("AI policy drafts", () => {
  const draft = { name: "Ops", perTxQor: 10, dailyQor: 20, autoApproveQor: 5, approvalThreshold: 2, requireApprovalForNewRecipients: true, validForDays: 30, summary: "x" };

  it("converts QOR to 18-decimal base units exactly", () => {
    expect(qorToWei(1)).toBe("1000000000000000000");
    expect(qorToWei(0.000001)).toBe("1000000000000");
    expect(qorToWei(60)).toBe("60000000000000000000");
    expect(() => qorToWei(0.0000001)).toThrow(/decimal/);
    expect(() => qorToWei(-1)).toThrow();
    expect(() => qorToWei(Number.NaN)).toThrow();
  });

  it("builds a policy that passes validation, with native QOR and the PaymentAgent fixed by code", () => {
    const r = validatePolicy(policyFromDraft(PolicyDraftSchema.parse(draft)));
    expect(r.ok).toBe(true);
    expect(r.policy?.agent).toBe("PaymentAgent");
    expect(r.policy?.token).toBe("0x0000000000000000000000000000000000000000");
    expect(r.policy?.perTxCap).toBe("10000000000000000000");
  });

  it("a contradictory draft is built but flagged by validation, never silently fixed", () => {
    const r = validatePolicy(policyFromDraft(PolicyDraftSchema.parse({ ...draft, perTxQor: 10, dailyQor: 5 })));
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.code === "DAILY_LT_PERTX")).toBe(true);
  });

  it("the draft schema has no way to carry a token, recipient, agent or extra field", () => {
    for (const extra of [{ token: "0x" + "1".repeat(40) }, { allowedRecipients: ["0x" + "2".repeat(40)] }, { agent: "TreasuryAgent" }, { callData: "0x" }]) {
      expect(PolicyDraftSchema.safeParse({ ...draft, ...extra }).success).toBe(false);
    }
    expect(PolicyDraftSchema.safeParse({ ...draft, perTxQor: -1 }).success).toBe(false);
    expect(PolicyDraftSchema.safeParse({ ...draft, perTxQor: 1e12 }).success).toBe(false);
    expect(PolicyDraftSchema.safeParse({ ...draft, approvalThreshold: 0 }).success).toBe(false);
  });
});
