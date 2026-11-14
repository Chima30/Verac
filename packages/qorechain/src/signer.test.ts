import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, keccak256, toHex, type PublicClient } from "viem";
import { DEPLOYED, treasuryVaultAbi } from "./contracts";
import { toPaymentTuple } from "./execution";
import { RestrictedSigner, SIGNER_LIMITS, SignerRefusal, envKillSwitch, prepareCall, type PreparedCall } from "./signer";

const NATIVE = "0x0000000000000000000000000000000000000000";
const pay = (amountQor: number, over: Partial<{ token: string; to: string }> = {}) =>
  toPaymentTuple({ token: over.token ?? NATIVE, to: over.to ?? "0x200cad3c9de63d3613a33fc20b1ef31cb4dbf5af", amount: String(BigInt(amountQor) * 10n ** 18n), purposeHash: keccak256(toHex("inv")), policyVersion: 1, expiry: 2_000_000_000, nonce: "1" });
const on = { enabled: () => true }, off = { enabled: () => false };
const evm = {} as PublicClient;
const agentKey = generatePrivateKey();
const agent = new RestrictedSigner("agent", agentKey, evm, on);
const approver = new RestrictedSigner("approver", generatePrivateKey(), evm, on);

describe("prepareCall (the signer builds the call itself)", () => {
  it("encodes executePayment against the deployed vault with zero value", () => {
    const c = prepareCall({ kind: "executePayment", payment: pay(5) });
    expect(c.to).toBe(DEPLOYED.TreasuryVault);
    expect(c.value).toBe(0n);
    expect(decodeFunctionData({ abi: treasuryVaultAbi, data: c.data }).functionName).toBe("executePayment");
    expect(c.calldataHash).toBe(keccak256(c.data));
  });
  it("the same payment always gives the same hash and any change gives a different one", () => {
    const a = prepareCall({ kind: "executePayment", payment: pay(5) }).calldataHash;
    expect(prepareCall({ kind: "executePayment", payment: pay(5) }).calldataHash).toBe(a);
    expect(prepareCall({ kind: "executePayment", payment: pay(6) }).calldataHash).not.toBe(a);
    expect(prepareCall({ kind: "executePayment", payment: pay(5, { to: "0x" + "9".repeat(40) }) }).calldataHash).not.toBe(a);
  });
  it("refuses more than 10 QOR, exactly 10 is allowed", () => {
    expect(() => prepareCall({ kind: "executePayment", payment: pay(11) })).toThrow(/at most 10 QOR/);
    expect(prepareCall({ kind: "executePayment", payment: pay(10) }).data).toBeTruthy();
    expect(SIGNER_LIMITS.maxQorPerOperation).toBe(10n * 10n ** 18n);
  });
  it("refuses a token other than native QOR and a zero amount", () => {
    expect(() => prepareCall({ kind: "executePayment", payment: pay(1, { token: "0x" + "5".repeat(40) }) })).toThrow(SignerRefusal);
    expect(() => prepareCall({ kind: "executePayment", payment: { ...pay(1), amount: 0n } })).toThrow(/at most 10 QOR/);
  });
  it("escrow funding may only target the deployed escrow", () => {
    expect(() => prepareCall({ kind: "fundEscrow", payment: pay(1, { to: "0x" + "7".repeat(40) }), projectId: 1n })).toThrow(/MilestoneEscrow/);
    expect(prepareCall({ kind: "fundEscrow", payment: pay(1, { to: DEPLOYED.MilestoneEscrow }), projectId: 1n }).kind).toBe("fundEscrow");
  });
});

describe("RestrictedSigner role separation", () => {
  const exec = prepareCall({ kind: "executePayment", payment: pay(5) });
  const approve = prepareCall({ kind: "approvePayment", agent: agent.address, payment: pay(5) });
  it("the agent key can pay but cannot approve", () => {
    expect(() => agent.precheck(exec)).not.toThrow();
    expect(() => agent.precheck(approve)).toThrow(/agent key may not sign approvePayment/);
  });
  it("the approver key can approve but cannot pay or fund", () => {
    expect(() => approver.precheck(approve)).not.toThrow();
    expect(() => approver.precheck(exec)).toThrow(/approver key may not sign executePayment/);
    expect(() => approver.precheck(prepareCall({ kind: "fundEscrow", payment: pay(1, { to: DEPLOYED.MilestoneEscrow }), projectId: 1n }))).toThrow(SignerRefusal);
  });
  it("refuses a call to any contract other than the vault, and any value", () => {
    expect(() => agent.precheck({ ...exec, to: "0x" + "1".repeat(40) as `0x${string}` })).toThrow(/deployed TreasuryVault/);
    expect(() => agent.precheck({ ...exec, value: 1n as unknown as 0n })).toThrow(/never attaches value/);
  });
  it("refuses an expired payment", () => {
    expect(() => agent.precheck(exec, 2_000_000_001, 2_000_000_000n)).toThrow(/expired/);
    expect(() => agent.precheck(exec, 1_999_999_999, 2_000_000_000n)).not.toThrow();
  });
  it("does nothing while the kill switch is off", () => {
    const stopped = new RestrictedSigner("agent", generatePrivateKey(), evm, off);
    expect(() => stopped.precheck(exec)).toThrow(/switched off/);
  });
  it("rejects a malformed key and a key for the wrong account without echoing the key", () => {
    expect(() => new RestrictedSigner("agent", "0x1234" as `0x${string}`, evm, on)).toThrow(/32-byte hex/);
    const k = generatePrivateKey();
    let msg = "";
    try { new RestrictedSigner("agent", k, evm, on, privateKeyToAccount(generatePrivateKey()).address); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/does not belong/);
    expect(msg).not.toContain(k.slice(2, 12));
  });
  it("exposes only the address, never the key", () => {
    expect(Object.keys(agent)).not.toContain("privateKey");
    expect(JSON.stringify(agent)).not.toContain(agentKey.slice(2));
    expect(String(agent)).not.toContain(agentKey.slice(2));
    expect(JSON.stringify(Object.entries(agent))).toBe(JSON.stringify([["role", "agent"], ["address", agent.address]]));
  });
});

describe("kill switch", () => {
  it("is on only when LIVE_EXECUTION_ENABLED is exactly true and the emergency stop is not set", () => {
    expect(envKillSwitch({}).enabled()).toBe(false);
    expect(envKillSwitch({ LIVE_EXECUTION_ENABLED: "true" }).enabled()).toBe(true);
    expect(envKillSwitch({ LIVE_EXECUTION_ENABLED: "true", LIVE_EMERGENCY_STOP: "true" }).enabled()).toBe(false);
    expect(envKillSwitch({ LIVE_EXECUTION_ENABLED: "yes" }).enabled()).toBe(false);
  });
});

void (undefined as unknown as PreparedCall);
