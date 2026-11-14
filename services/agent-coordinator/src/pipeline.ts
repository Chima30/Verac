import { randomUUID } from "node:crypto";
import { assertTransition, PaymentProposalSchema, type OperationState, type PaymentProposal, type Policy } from "@qoreops/shared-types";
import { computePaymentHash, evaluatePayment, type Evaluation } from "@qoreops/policy-engine";

/**
 * The ONE payment pipeline. Every agent that wants value to move goes through here:
 *
 *   propose -> validate (policy, risk) -> [human approvals bound to the exact payment hash]
 *           -> simulate -> submit -> verify receipt -> confirmed
 *
 * A payment is CONFIRMED only when the receipt succeeded AND the vault's PaymentExecuted/EscrowFunded event for
 * this exact payment hash is present. Prepared, submitted or simulated payments are never reported as paid.
 */

export interface Operation {
  id: string;
  idempotencyKey: string;
  organizationId: string;
  proposal: PaymentProposal;
  paymentHash: `0x${string}`;
  state: OperationState;
  requiredApprovals: number;
  evaluation?: Evaluation;
  txHash?: string;
  reasons: string[];
  history: Array<{ at: number; from: OperationState | null; to: OperationState; note?: string }>;
  createdAt: number;
  updatedAt: number;
}

export interface OperationStore {
  getByKey(key: string): Promise<Operation | undefined>;
  get(id: string): Promise<Operation | undefined>;
  insert(op: Operation): Promise<void>;
  update(op: Operation): Promise<void>;
}

export class InMemoryOperationStore implements OperationStore {
  private byId = new Map<string, Operation>();
  private byKey = new Map<string, string>();
  async getByKey(key: string) { const id = this.byKey.get(key); return id ? structuredClone(this.byId.get(id)) : undefined; }
  async get(id: string) { const o = this.byId.get(id); return o ? structuredClone(o) : undefined; }
  async insert(op: Operation) {
    if (this.byKey.has(op.idempotencyKey)) throw new Error("duplicate idempotency key");
    this.byId.set(op.id, structuredClone(op));
    this.byKey.set(op.idempotencyKey, op.id);
  }
  async update(op: Operation) { this.byId.set(op.id, structuredClone(op)); }
}

export interface ReceiptResult {
  status: "success" | "reverted";
  /** Payment hashes found in the vault's PaymentExecuted / EscrowFunded events in this receipt. */
  executedPaymentHashes: string[];
  failureReason?: string;
}

export interface PipelineDeps {
  store: OperationStore;
  now(): number;
  getPolicy(orgId: string, agent: PaymentProposal["agent"]): Promise<Policy | undefined>;
  activePolicyVersion(): Promise<number>;
  approvedRecipients(): Promise<ReadonlySet<string>>;
  spentToday(proposal: PaymentProposal): Promise<bigint>;
  /** Deterministic risk screen (duplicate invoice, changed recipient, anomaly). */
  risk(proposal: PaymentProposal): Promise<{ block: boolean; reasons: string[] }>;
  /** On-chain approvals recorded for this payment hash (TreasuryVault.approvalsOf). */
  approvalsFor(paymentHash: string): Promise<number>;
  /** eth_call / eth_estimateGas against the vault. Must not send a transaction. */
  simulate(proposal: PaymentProposal): Promise<{ ok: boolean; error?: string }>;
  submit(proposal: PaymentProposal): Promise<{ txHash: string }>;
  waitForReceipt(txHash: string): Promise<ReceiptResult>;
  audit(event: { organizationId: string; action: string; subject: string; detail: Record<string, unknown> }): void;
}

export class IdempotencyConflict extends Error {
  constructor() { super("Idempotency key already used with different payment details"); this.name = "IdempotencyConflict"; }
}

export class PaymentPipeline {
  constructor(private readonly d: PipelineDeps) {}

  /** Idempotent: the same key with the same details returns the existing operation without re-submitting. */
  async propose(raw: unknown): Promise<Operation> {
    const proposal = PaymentProposalSchema.parse(raw);
    const hash = computePaymentHash(proposal);
    const existing = await this.d.store.getByKey(proposal.idempotencyKey);
    if (existing) {
      if (existing.paymentHash !== hash) throw new IdempotencyConflict();
      return this.advance(existing.id);
    }
    const t = this.d.now();
    const op: Operation = {
      id: randomUUID(), idempotencyKey: proposal.idempotencyKey, organizationId: proposal.organizationId, proposal,
      paymentHash: hash, state: "PROPOSED", requiredApprovals: 0, reasons: [], history: [{ at: t, from: null, to: "PROPOSED" }],
      createdAt: t, updatedAt: t,
    };
    await this.d.store.insert(op);
    this.d.audit({ organizationId: op.organizationId, action: "payment.proposed", subject: op.id, detail: { paymentHash: hash, to: proposal.to, amount: proposal.amount, agent: proposal.agent } });
    return this.advance(op.id);
  }

  /** Moves an operation as far as it can go without human input. Safe to call repeatedly (e.g. after an approval). */
  async advance(id: string): Promise<Operation> {
    let op = await this.mustGet(id);
    for (let guard = 0; guard < 12; guard += 1) {
      switch (op.state) {
        case "PROPOSED":
          op = await this.move(op, "VALIDATING");
          break;
        case "VALIDATING":
          op = await this.validate(op);
          break;
        case "AWAITING_APPROVAL": {
          const have = await this.d.approvalsFor(op.paymentHash);
          if (have < op.requiredApprovals) return op; // waiting for humans; nothing else to do
          if (this.d.now() > op.proposal.expiry) return this.move(op, "REJECTED", "Expired while awaiting approval");
          op = await this.move(op, "APPROVED", `${have}/${op.requiredApprovals} approvals`);
          break;
        }
        case "APPROVED":
          op = await this.move(op, "SIMULATING");
          break;
        case "SIMULATING":
          op = await this.simulate(op);
          break;
        case "READY":
          op = await this.submit(op);
          break;
        case "SUBMITTED":
          op = await this.confirm(op);
          break;
        default:
          return op; // terminal
      }
    }
    return op;
  }

  async cancel(id: string, by: string): Promise<Operation> {
    const op = await this.mustGet(id);
    const updated = await this.move(op, "CANCELLED", `cancelled by ${by}`);
    return updated;
  }

  // ------------------------------------------------------------------ steps
  private async validate(op: Operation): Promise<Operation> {
    const p = op.proposal;
    const policy = await this.d.getPolicy(op.organizationId, p.agent);
    if (!policy) return this.reject(op, ["No approved policy exists for this agent."]);

    const [activeVersion, approvedRecipients, spent, risk] = await Promise.all([
      this.d.activePolicyVersion(), this.d.approvedRecipients(), this.d.spentToday(p), this.d.risk(p),
    ]);
    const evaluation = evaluatePayment(policy, p, { now: this.d.now(), approvedRecipients, spentToday: spent, activePolicyVersion: activeVersion });
    op = { ...op, evaluation };
    if (risk.block) return this.reject(op, ["Risk screen blocked this payment.", ...risk.reasons]);
    if (evaluation.decision === "REJECT") return this.reject(op, evaluation.reasons);
    if (evaluation.decision === "REQUIRE_APPROVAL") {
      op = { ...op, requiredApprovals: evaluation.requiredApprovals };
      return this.move(op, "AWAITING_APPROVAL", evaluation.reasons.join(" "));
    }
    return this.move(op, "APPROVED", "Within automatic limits");
  }

  private async simulate(op: Operation): Promise<Operation> {
    const sim = await this.d.simulate(op.proposal);
    if (!sim.ok) return this.reject(op, [`Simulation failed: ${sim.error ?? "unknown"}`]);
    return this.move(op, "READY", "Simulation passed");
  }

  private async submit(op: Operation): Promise<Operation> {
    if (this.d.now() > op.proposal.expiry) return this.reject(op, ["Expired before submission."]);
    // If the worker crashes after the node accepts the tx but before we record SUBMITTED, a restart may call
    // submit again. That cannot double-pay: TreasuryVault marks each payment hash executed and reverts a repeat
    // (AlreadyExecuted), and the idempotency key above prevents a second operation for the same invoice.
    try {
      const { txHash } = await this.d.submit(op.proposal);
      op = { ...op, txHash };
      return this.move(op, "SUBMITTED", `tx ${txHash}`);
    } catch (e) {
      return this.fail(op, `Submission error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async confirm(op: Operation): Promise<Operation> {
    if (!op.txHash) return this.fail(op, "Missing transaction hash while SUBMITTED.");
    const r = await this.d.waitForReceipt(op.txHash);
    if (r.status !== "success") return this.fail(op, `Transaction reverted${r.failureReason ? `: ${r.failureReason}` : ""}`);
    if (!r.executedPaymentHashes.map((h) => h.toLowerCase()).includes(op.paymentHash.toLowerCase())) {
      return this.fail(op, "Receipt succeeded but no matching payment event was found; refusing to mark as paid.");
    }
    return this.move(op, "CONFIRMED", `tx ${op.txHash}`);
  }

  // ------------------------------------------------------------------ plumbing
  private async mustGet(id: string): Promise<Operation> {
    const op = await this.d.store.get(id);
    if (!op) throw new Error(`operation ${id} not found`);
    return op;
  }
  private reject(op: Operation, reasons: string[]): Promise<Operation> {
    return this.move({ ...op, reasons: [...op.reasons, ...reasons] }, "REJECTED", reasons.join(" "));
  }
  private fail(op: Operation, reason: string): Promise<Operation> {
    return this.move({ ...op, reasons: [...op.reasons, reason] }, "FAILED", reason);
  }
  private async move(op: Operation, to: OperationState, note?: string): Promise<Operation> {
    assertTransition(op.state, to);
    const t = this.d.now();
    const next: Operation = { ...op, state: to, updatedAt: t, history: [...op.history, { at: t, from: op.state, to, ...(note ? { note } : {}) }] };
    await this.d.store.update(next);
    this.d.audit({ organizationId: op.organizationId, action: `payment.${to.toLowerCase()}`, subject: op.id, detail: { from: op.state, ...(note ? { note } : {}), paymentHash: op.paymentHash, ...(op.txHash ? { txHash: op.txHash } : {}) } });
    return next;
  }
}
