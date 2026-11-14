import { describe, expect, it } from "vitest";
import { keccak256, toHex, type Hex } from "viem";
import { DEPLOYED } from "./contracts";
import { executeLiveOperation, type ExecutorDeps, type ExecutorSigner, type LiveRow } from "./live-executor";
import { prepareCall } from "./signer";
import { toPaymentTuple, type ReceiptVerdict } from "./execution";

const AGENT = "0x7615DAb4651b47f69F80305f89F39B211F829dd7" as const;
const APPROVER = "0x1111111111111111111111111111111111111111" as const;
const NATIVE = "0x0000000000000000000000000000000000000000";
const HASH = ("0x" + "ab".repeat(32)) as Hex;
const TX = ("0x" + "cd".repeat(32)) as Hex;
const APPROVAL_TX = ("0x" + "ee".repeat(32)) as Hex;

function row(over: Partial<LiveRow> = {}): LiveRow {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const base = { token: NATIVE, recipient: "0x200cad3c9de63d3613a33fc20b1ef31cb4dbf5af", amount: String(5n * 10n ** 18n), purpose_hash: keccak256(toHex("inv-1")) as Hex, policy_version: 1, nonce: "7", expires_at: new Date(expiry * 1000).toISOString() };
  const payment = toPaymentTuple({ token: base.token, to: base.recipient, amount: base.amount, purposeHash: base.purpose_hash, policyVersion: base.policy_version, expiry, nonce: base.nonce });
  return { id: "op-1", organization_id: "org-1", state: "READY", kind: "payment", payment_hash: HASH, calldata_hash: prepareCall({ kind: "executePayment", payment }).calldataHash, agent_account: AGENT, project_id: null, ...base, ...over };
}

interface Log { events: string[]; failures: string[]; alerts: string[]; outcome?: { ok: boolean; reason: string | null }; relays: Hex[]; submitted: Hex[] }
function setup(opts: { row?: LiveRow; claimError?: string; chainHash?: Hex; executed?: boolean; need?: number; have?: number; simExec?: { ok: boolean; errorName?: string }; simApprove?: { ok: boolean; errorName?: string }; receipt?: ReceiptVerdict; sendError?: string; approvalReceipt?: ReceiptVerdict } = {}) {
  const log: Log = { events: [], failures: [], alerts: [], relays: [], submitted: [] };
  const r = opts.row ?? row();
  const signer = (name: string, address: `0x${string}`): ExecutorSigner => ({
    address,
    send: async () => { if (opts.sendError && name === "agent") throw new Error(opts.sendError); log.events.push(`${name}.send`); return name === "agent" ? TX : APPROVAL_TX; },
    windows: { ensureOpen: async () => { log.events.push(`${name}.open`); return null; }, close: async () => { log.events.push(`${name}.close`); return null; } },
  });
  const d: ExecutorDeps = {
    now: () => Date.now(),
    agent: signer("agent", AGENT), approver: signer("approver", APPROVER),
    db: {
      claim: async () => { if (opts.claimError) throw new Error(opts.claimError); log.events.push("claim"); return r; },
      recordRelay: async (_i, h) => { log.relays.push(h); }, recordSubmitted: async (_i, h) => { log.submitted.push(h); },
      recordOutcome: async (_i, ok, _b, reason) => { log.outcome = { ok, reason }; },
      recordFailure: async (_i, reason) => { log.failures.push(reason); },
      alert: async (_o, kind) => { log.alerts.push(kind); },
    },
    chain: {
      vaultPaymentHash: async () => opts.chainHash ?? HASH,
      approvalsRequired: async () => opts.need ?? 1,
      onChainApprovals: async () => opts.have ?? 0,
      alreadyExecuted: async () => opts.executed ?? false,
      simulateExecutePayment: async () => opts.simExec ?? { ok: true },
      simulateFundEscrow: async () => opts.simExec ?? { ok: true },
      simulateApprovePayment: async () => opts.simApprove ?? { ok: true },
      waitForReceipt: async (h) => h === APPROVAL_TX ? (opts.approvalReceipt ?? { status: "success", executedPaymentHashes: [], escrowEvents: [] }) : (opts.receipt ?? { status: "success", blockNumber: 555n, executedPaymentHashes: [HASH], escrowEvents: [] }),
    },
  };
  return { d, log };
}

describe("executeLiveOperation: happy path", () => {
  it("relays the on-chain approval, pays, verifies the event, and confirms", async () => {
    const { d, log } = setup();
    const r = await executeLiveOperation(d, "op-1");
    expect(r).toMatchObject({ state: "CONFIRMED", txHash: TX, approvalTxHash: APPROVAL_TX, block: 555n });
    expect(log.events).toEqual(["claim", "approver.open", "approver.send", "approver.close", "agent.open", "agent.send", "agent.close"]);
    expect(log.relays).toEqual([APPROVAL_TX]);
    expect(log.submitted).toEqual([TX]);
    expect(log.outcome).toEqual({ ok: true, reason: null });
    expect(log.failures).toEqual([]);
  });
  it("skips the on-chain approval when the vault already has enough or needs none", async () => {
    for (const o of [{ need: 0 }, { need: 1, have: 1 }]) {
      const { d, log } = setup(o);
      expect((await executeLiveOperation(d, "op-1")).state).toBe("CONFIRMED");
      expect(log.events).not.toContain("approver.send");
    }
  });
});

describe("executeLiveOperation: refusals", () => {
  it("does nothing when the database refuses the claim (not approved, expired, or already claimed)", async () => {
    const { d, log } = setup({ claimError: "operation is READY and cannot be executed" });
    await expect(executeLiveOperation(d, "op-1")).rejects.toThrow(/cannot be executed/);
    expect(log.events).toEqual([]);
  });
  it("refuses and alerts when the stored calldata hash does not match what would be sent", async () => {
    const { d, log } = setup({ row: row({ calldata_hash: ("0x" + "00".repeat(32)) as Hex }) });
    const r = await executeLiveOperation(d, "op-1");
    expect(r.state).toBe("FAILED");
    expect(log.alerts).toEqual(["calldata_mismatch"]);
    expect(log.events).not.toContain("agent.send");
  });
  it("refuses and alerts when the payment hash differs from the vault's", async () => {
    const { d, log } = setup({ chainHash: ("0x" + "99".repeat(32)) as Hex });
    expect((await executeLiveOperation(d, "op-1")).state).toBe("FAILED");
    expect(log.alerts).toEqual(["payment_hash_mismatch"]);
    expect(log.events).not.toContain("agent.send");
  });
  it("refuses an operation for a different agent account", async () => {
    const { d, log } = setup({ row: row({ agent_account: APPROVER }) });
    expect((await executeLiveOperation(d, "op-1")).state).toBe("FAILED");
    expect(log.alerts).toEqual(["agent_mismatch"]);
  });
  it("refuses a duplicate: the vault says it already executed", async () => {
    const { d, log } = setup({ executed: true });
    const r = await executeLiveOperation(d, "op-1");
    expect(r).toMatchObject({ state: "FAILED", reason: expect.stringMatching(/already been executed/) });
    expect(log.events).not.toContain("agent.send");
  });
  it("refuses more than 10 QOR even if the database row says otherwise", async () => {
    const { d, log } = setup({ row: row({ amount: String(11n * 10n ** 18n) }) });
    const r = await executeLiveOperation(d, "op-1");
    expect(r.state).toBe("FAILED");
    expect(log.events).not.toContain("agent.send");
  });
  it("records the contract's own rejection and sends nothing when simulation fails", async () => {
    const { d, log } = setup({ simExec: { ok: false, errorName: "ExceedsDailyCap" } });
    const r = await executeLiveOperation(d, "op-1");
    expect(r).toMatchObject({ state: "FAILED", reason: expect.stringMatching(/ExceedsDailyCap/) });
    expect(log.alerts).toEqual(["contract_rejected"]);
    expect(log.events).not.toContain("agent.send");
    expect(log.failures).toHaveLength(1);
  });
  it("fails safely when the on-chain approval would be rejected", async () => {
    const { d, log } = setup({ simApprove: { ok: false, errorName: "NotApprover" } });
    expect((await executeLiveOperation(d, "op-1")).state).toBe("FAILED");
    expect(log.events).not.toContain("agent.send");
    expect(log.events).toContain("approver.close");
  });
  it("fails when the approval transaction reverts, and never pays", async () => {
    const { d, log } = setup({ approvalReceipt: { status: "reverted", executedPaymentHashes: [], escrowEvents: [], failureReason: "Reverted on chain: NotApprover" } });
    const r = await executeLiveOperation(d, "op-1");
    expect(r.state).toBe("FAILED");
    expect(log.events).not.toContain("agent.send");
  });
});

describe("executeLiveOperation: verification", () => {
  it("records a revert as FAILED with the reason, never CONFIRMED", async () => {
    const { d, log } = setup({ receipt: { status: "reverted", blockNumber: 9n, executedPaymentHashes: [], escrowEvents: [], failureReason: "Reverted on chain: ExceedsPerTxCap" } });
    const r = await executeLiveOperation(d, "op-1");
    expect(r).toMatchObject({ state: "FAILED", txHash: TX });
    expect(log.outcome).toEqual({ ok: false, reason: "Reverted on chain: ExceedsPerTxCap" });
  });
  it("does not report paid when the receipt succeeded but the vault's event for this hash is missing", async () => {
    const { d, log } = setup({ receipt: { status: "success", blockNumber: 9n, executedPaymentHashes: [("0x" + "77".repeat(32)) as Hex], escrowEvents: [] } });
    const r = await executeLiveOperation(d, "op-1");
    expect(r.state).toBe("FAILED");
    expect(log.outcome?.ok).toBe(false);
    expect(log.outcome?.reason).toMatch(/not reported as paid/);
  });
  it("closes the agent window even when sending throws, and records a failure before submission", async () => {
    const { d, log } = setup({ sendError: "nonce too low" });
    const r = await executeLiveOperation(d, "op-1");
    expect(r).toMatchObject({ state: "FAILED", reason: expect.stringMatching(/nonce too low/) });
    expect(log.events).toContain("agent.close");
    expect(log.submitted).toEqual([]);
    expect(log.failures).toHaveLength(1);
  });
});

void DEPLOYED;
