import { describe, expect, it } from "vitest";
import { generatePqcKeypair } from "@qorechain/sdk";
import { toHex } from "viem";
import { AdminOp, adminData, adminDigestV2, paymentDigestV2, signApprovalV2, signingBytesV2, sortSigs, verifyApprovalV2 } from "./v2";

// The same fixed inputs as test_digest_vector_matches_typescript in contracts/test/TreasuryVaultV2.t.sol.
const VAULT = "0x7ce4667EAB18072123AD28eD8E76aA89B70e2e6C" as const;
const AGENT = "0x7615DAb4651b47f69F80305f89F39B211F829dd7" as const;
const TO = "0x200caD3c9De63D3613A33fc20b1ef31CB4dbF5AF" as const;
const p = { token: "0x0000000000000000000000000000000000000000" as const, to: TO, amount: 1_250_000_000_000_000_000n, purposeHash: `0x${"11".repeat(32)}` as const, policyVersion: 1n, expiry: 1_800_000_000n, nonce: 42n };
export const VECTOR_PAYMENT_DIGEST = "0x5c664ba292698ce63dd870a6487908e7f98efe950838ef9248bd67402b7624e4";
export const VECTOR_ADMIN_DIGEST = "0x0471feeb0de794f323b40f537e712edb2855cc563fa2ad60d0a27a973318b3d1";

describe("TreasuryVault V2 digests", () => {
  it("match the fixed vectors shared with the Solidity test", () => {
    expect(paymentDigestV2(9800n, VAULT, AGENT, p)).toBe(VECTOR_PAYMENT_DIGEST);
    expect(adminDigestV2(9800n, VAULT, AdminOp.SetRecipient, adminData.setRecipient(TO, true), 0n, 1_800_000_000n)).toBe(VECTOR_ADMIN_DIGEST);
  });

  it("change with every bound field: chain, vault, agent, amount, recipient, nonce", () => {
    const base = paymentDigestV2(9800n, VAULT, AGENT, p);
    expect(paymentDigestV2(9801n, VAULT, AGENT, p)).not.toBe(base);
    expect(paymentDigestV2(9800n, TO, AGENT, p)).not.toBe(base);
    expect(paymentDigestV2(9800n, VAULT, TO, p)).not.toBe(base);
    expect(paymentDigestV2(9800n, VAULT, AGENT, { ...p, amount: p.amount + 1n })).not.toBe(base);
    expect(paymentDigestV2(9800n, VAULT, AGENT, { ...p, to: AGENT })).not.toBe(base);
    expect(paymentDigestV2(9800n, VAULT, AGENT, { ...p, nonce: 43n })).not.toBe(base);
    expect(paymentDigestV2(9800n, VAULT, AGENT, { ...p, expiry: p.expiry + 1n })).not.toBe(base);
  });

  it("payment and admin digests never collide in form: different tags", () => {
    const pay = paymentDigestV2(9800n, VAULT, AGENT, p);
    const adm = adminDigestV2(9800n, VAULT, AdminOp.SetRecipient, adminData.setRecipient(TO, true), 0n, 1_800_000_000n);
    expect(pay).not.toBe(adm);
  });

  it("signs the prefixed digest with ML-DSA-87 and verifies only for the same key and digest", () => {
    const k = generatePqcKeypair(), other = generatePqcKeypair();
    const d = paymentDigestV2(9800n, VAULT, AGENT, p);
    const sig = signApprovalV2(k.secretKey, d);
    expect(verifyApprovalV2(k.publicKey, d, sig)).toBe(true);
    expect(verifyApprovalV2(other.publicKey, d, sig)).toBe(false);
    expect(verifyApprovalV2(k.publicKey, paymentDigestV2(9800n, VAULT, AGENT, { ...p, amount: 1n }), sig)).toBe(false);
    expect(toHex(signingBytesV2(d)).startsWith(toHex(new TextEncoder().encode("verac-v2-approval|")))).toBe(true);
  });

  it("sorts signers and refuses duplicates", () => {
    const a = { signer: "0x00000000000000000000000000000000000000b2" as const, signature: "0x01" as const };
    const b = { signer: "0x00000000000000000000000000000000000000a1" as const, signature: "0x02" as const };
    expect(sortSigs([a, b]).map((s) => s.signer)).toEqual([b.signer, a.signer]);
    expect(() => sortSigs([a, { ...a }])).toThrow(/duplicate/);
  });
});
