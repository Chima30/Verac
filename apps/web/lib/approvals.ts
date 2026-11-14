import { randomBytes, randomUUID } from "node:crypto";
import { keccak256, toBytes } from "viem";
import { computePaymentHash, qorToWei } from "@qoreops/policy-engine";
import { NATIVE_TOKEN, type PaymentProposal } from "@qoreops/shared-types";
import deployment from "../../../deployments/diana-testnet.json";

export const STATE_TONE: Record<string, "approval" | "live" | "failed" | "pending" | "neutral"> = {
  AWAITING_APPROVAL: "approval", APPROVED: "live", REJECTED: "failed", CANCELLED: "failed", FAILED: "failed",
};

/** Builds the exact payment the approvers will be shown and that the hash binds. Simulation only: nothing is sent to chain. */
export function buildProposal(orgId: string, input: { to: string; amountQor: number; purpose: string; validHours: number }): { proposal: PaymentProposal; hash: `0x${string}`; weiAmount: string } {
  const weiAmount = qorToWei(input.amountQor);
  const proposal: PaymentProposal = {
    organizationId: orgId,
    agent: "PaymentAgent",
    agentAccount: deployment.owner,
    chainId: 9800,
    vault: deployment.contracts.TreasuryVault.address,
    token: NATIVE_TOKEN,
    to: input.to.toLowerCase(),
    amount: weiAmount,
    purposeHash: keccak256(toBytes(input.purpose)),
    policyVersion: 1,
    nonce: BigInt("0x" + randomBytes(6).toString("hex")).toString(),
    expiry: Math.floor(Date.now() / 1000) + Math.round(input.validHours * 3600),
    idempotencyKey: `sim-${randomUUID()}`,
    memo: input.purpose.slice(0, 280),
  } as PaymentProposal;
  return { proposal, hash: computePaymentHash(proposal), weiAmount };
}

/** Recomputes the hash from the stored fields. Approvers should only trust a request whose stored hash matches. */
export function hashMatches(storedHash: string, evaluation: unknown): boolean {
  try {
    const p = (evaluation as { proposal?: PaymentProposal } | null)?.proposal;
    return !!p && computePaymentHash(p).toLowerCase() === storedHash.toLowerCase();
  } catch { return false; }
}

export function formatQor(wei: string | number): string {
  const v = BigInt(String(wei).split(".")[0]!);
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
