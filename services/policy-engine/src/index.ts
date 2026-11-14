import { encodeAbiParameters, keccak256, parseAbiParameters, getAddress } from "viem";
import { type Policy, type PaymentProposal, PolicySchema } from "@qoreops/shared-types";

// ------------------------------------------------------------------ payment hash (must equal TreasuryVault.paymentHash)
/**
 * keccak256(abi.encode(chainid, vault, agent, token, to, amount, purposeHash, policyVersion, expiry, nonce))
 * Identical to the Solidity implementation so human approvals are bound to the exact on-chain payment.
 */
export function computePaymentHash(p: PaymentProposal): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256 chainId, address vault, address agent, address token, address to, uint256 amount, bytes32 purposeHash, uint64 policyVersion, uint64 expiry, uint256 nonce",
      ),
      [
        BigInt(p.chainId),
        getAddress(p.vault),
        getAddress(p.agentAccount),
        getAddress(p.token),
        getAddress(p.to),
        BigInt(p.amount),
        p.purposeHash as `0x${string}`,
        BigInt(p.policyVersion),
        BigInt(p.expiry),
        BigInt(p.nonce),
      ],
    ),
  );
}

// ------------------------------------------------------------------ evaluation
export type Decision = "ALLOW" | "REQUIRE_APPROVAL" | "REJECT";

export interface EvaluationContext {
  /** Unix seconds. Injected so evaluation is deterministic and testable. */
  now: number;
  /** Recipients the org has already approved (mirrors TreasuryVault.approvedRecipient). */
  approvedRecipients: ReadonlySet<string>;
  /** Amount (base units) this agent already spent today in this token (UTC day). */
  spentToday: bigint;
  /** Policy version currently active on chain. 0 = none. */
  activePolicyVersion: number;
  /** Max lifetime of a payment request; vault enforces 7 days. */
  maxPaymentLifetimeSeconds?: number;
}

export interface Evaluation {
  decision: Decision;
  /** Approvals needed from humans before execution (0 when ALLOW). */
  requiredApprovals: number;
  reasons: string[];
  /** Machine-readable codes, stable for tests and the UI. */
  codes: EvaluationCode[];
}

export type EvaluationCode =
  | "POLICY_NOT_ACTIVE"
  | "POLICY_VERSION_MISMATCH"
  | "AGENT_MISMATCH"
  | "TOKEN_MISMATCH"
  | "EXPIRED"
  | "EXPIRY_TOO_FAR"
  | "ZERO_AMOUNT"
  | "EXCEEDS_PER_TX_CAP"
  | "EXCEEDS_DAILY_CAP"
  | "RECIPIENT_NOT_ALLOWED"
  | "NEW_RECIPIENT"
  | "ABOVE_AUTO_APPROVE"
  | "WITHIN_AUTO_LIMITS";

const lower = (a: string): string => a.toLowerCase();

/**
 * Deterministic pre-check. It mirrors the contract so a doomed transaction is never sent, but it is NOT the
 * authority: TreasuryVault re-checks everything on chain, and an LLM never participates here.
 */
export function evaluatePayment(policy: Policy, p: PaymentProposal, ctx: EvaluationContext): Evaluation {
  const reject: EvaluationCode[] = [];
  const msgs: string[] = [];
  const add = (code: EvaluationCode, msg: string): void => {
    reject.push(code);
    msgs.push(msg);
  };

  const amount = BigInt(p.amount);
  const perTx = BigInt(policy.perTxCap);
  const daily = BigInt(policy.dailyCap);
  const auto = BigInt(policy.autoApproveCap);
  const maxLife = ctx.maxPaymentLifetimeSeconds ?? 7 * 24 * 3600;

  if (ctx.activePolicyVersion === 0) add("POLICY_NOT_ACTIVE", "No active policy on chain; all payments are refused.");
  else if (p.policyVersion !== ctx.activePolicyVersion)
    add("POLICY_VERSION_MISMATCH", `Payment is bound to policy v${p.policyVersion} but v${ctx.activePolicyVersion} is active.`);
  if (p.agent !== policy.agent) add("AGENT_MISMATCH", `Policy is for ${policy.agent}, not ${p.agent}.`);
  if (lower(p.token) !== lower(policy.token)) add("TOKEN_MISMATCH", "Token differs from the token this policy governs.");
  if (amount === 0n) add("ZERO_AMOUNT", "Amount must be greater than zero.");
  if (ctx.now > p.expiry) add("EXPIRED", "Payment request has expired.");
  else if (p.expiry > ctx.now + maxLife) add("EXPIRY_TOO_FAR", "Payment expiry is beyond the maximum request lifetime.");
  if (amount > perTx) add("EXCEEDS_PER_TX_CAP", `Amount ${amount} exceeds the per-transaction cap ${perTx}.`);
  if (ctx.spentToday + amount > daily)
    add("EXCEEDS_DAILY_CAP", `Spent today ${ctx.spentToday} plus ${amount} exceeds the daily cap ${daily}.`);
  if (policy.allowedRecipients && !policy.allowedRecipients.map(lower).includes(lower(p.to)))
    add("RECIPIENT_NOT_ALLOWED", "Recipient is not in this policy's allowed list.");

  if (reject.length > 0) return { decision: "REJECT", requiredApprovals: 0, reasons: msgs, codes: reject };

  const isKnown = ctx.approvedRecipients.has(lower(p.to));
  const needs: EvaluationCode[] = [];
  if (!isKnown && policy.requireApprovalForNewRecipients) {
    needs.push("NEW_RECIPIENT");
    msgs.push("Recipient is new; human approval required.");
  }
  if (amount > auto) {
    needs.push("ABOVE_AUTO_APPROVE");
    msgs.push(`Amount ${amount} is above the auto-approve ceiling ${auto}.`);
  }
  if (needs.length > 0)
    return { decision: "REQUIRE_APPROVAL", requiredApprovals: policy.approvalThreshold, reasons: msgs, codes: needs };

  return { decision: "ALLOW", requiredApprovals: 0, reasons: ["Within the agent's automatic limits."], codes: ["WITHIN_AUTO_LIMITS"] };
}

// ------------------------------------------------------------------ policy validation (conflicts & consequences)
export interface PolicyFinding {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

/**
 * Validates an LLM-produced (or hand-written) policy object. The model's JSON is untrusted: it must pass the
 * strict schema first, then these consistency checks, then a human must approve before anything is applied.
 */
export function validatePolicy(input: unknown): { ok: boolean; policy?: Policy; findings: PolicyFinding[] } {
  const findings: PolicyFinding[] = [];
  const parsed = PolicySchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      findings.push({ severity: "error", code: "SCHEMA", message: `${issue.path.join(".") || "(root)"}: ${issue.message}` });
    return { ok: false, findings };
  }
  const p = parsed.data;
  const perTx = BigInt(p.perTxCap);
  const daily = BigInt(p.dailyCap);
  const auto = BigInt(p.autoApproveCap);

  if (perTx === 0n) findings.push({ severity: "error", code: "ZERO_CAP", message: "Per-transaction cap is zero; the agent could never pay." });
  if (daily < perTx)
    findings.push({ severity: "error", code: "DAILY_LT_PERTX", message: "Daily cap is below the per-transaction cap (contradiction)." });
  if (auto > perTx)
    findings.push({ severity: "error", code: "AUTO_GT_PERTX", message: "Auto-approve ceiling exceeds the per-transaction cap; it could never apply." });
  if (auto === 0n)
    findings.push({ severity: "info", code: "NO_AUTO", message: "Auto-approve ceiling is zero: every payment needs human approval." });
  if (!p.requireApprovalForNewRecipients)
    findings.push({
      severity: "warning",
      code: "NEW_RECIPIENT_OPEN",
      message: "New recipients would not need approval by policy; the vault still requires approval for unlisted recipients.",
    });
  if (p.approvalThreshold === 1)
    findings.push({ severity: "warning", code: "SINGLE_APPROVER", message: "A single approver is enough; a compromised approver could approve alone." });
  if (daily > perTx * 20n)
    findings.push({ severity: "warning", code: "LARGE_DAILY_MULTIPLE", message: "Daily cap is more than 20x the per-transaction cap." });
  if (p.validForSeconds > 90 * 24 * 3600)
    findings.push({ severity: "warning", code: "LONG_LIVED_AGENT", message: "Agent permission lasts more than 90 days; prefer shorter, renewable permissions." });

  const ok = !findings.some((f) => f.severity === "error");
  return ok ? { ok, policy: p, findings } : { ok, findings };
}

/** Human-readable consequence summary shown next to the approval button. */
export function describePolicy(p: Policy): string[] {
  const d = p.tokenDecimals;
  const fmt = (v: string): string => {
    const n = BigInt(v);
    const base = 10n ** BigInt(d);
    const whole = n / base;
    const frac = (n % base).toString().padStart(d, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : `${whole}`;
  };
  const sym = p.token === "0x0000000000000000000000000000000000000000" ? "QOR" : `token ${p.token}`;
  return [
    `${p.agent} may send at most ${fmt(p.perTxCap)} ${sym} per transaction and ${fmt(p.dailyCap)} ${sym} per UTC day.`,
    `Payments up to ${fmt(p.autoApproveCap)} ${sym} to already-approved recipients need no human approval.`,
    `Everything above that${p.requireApprovalForNewRecipients ? ", and any payment to a new recipient," : ""} needs ${p.approvalThreshold} approval(s).`,
    `Permission expires after ${Math.round(p.validForSeconds / 3600)} hour(s) and can be revoked at any time.`,
  ];
}
