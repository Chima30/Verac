import { describe, expect, it } from "vitest";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { computePaymentHash } from "../../../services/policy-engine/src/index";
import { ChainExecution, toPaymentTuple } from "./execution";

// Read-only checks against the real Diana testnet. No keys, no transactions. Excluded from the default run:
//   npx vitest run --config /dev/null packages/qorechain/src/execution.live.test.ts
const AGENT = "0x7615DAb4651b47f69F80305f89F39B211F829dd7" as const;
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const x = new ChainExecution();

describe("Diana testnet, read only", () => {
  it("is chain 9800 and every Verac contract has code", async () => {
    const r = await x.verifyDeployment();
    expect(r).toEqual({ PolicyManager: true, TreasuryVault: true, MilestoneEscrow: true, AuditAnchor: true, OrganizationRegistry: true });
  }, 60_000);

  it("the TypeScript payment hash equals TreasuryVault.paymentHash", async () => {
    const proposal = {
      organizationId: "11111111-1111-4111-8111-111111111111", agent: "PaymentAgent" as const, agentAccount: AGENT, chainId: QORE_NETWORK.evmChainId as 9800,
      vault: x.contracts.TreasuryVault, token: NATIVE, to: "0x200cad3c9de63d3613a33fc20b1ef31cb4dbf5af", amount: "5000000000000000000",
      purposeHash: ("0x" + "22".repeat(32)) as `0x${string}`, policyVersion: 1, nonce: "42", expiry: 2_000_000_000, idempotencyKey: "live-test-0001",
    };
    const onChain = await x.vaultPaymentHash(AGENT, toPaymentTuple(proposal));
    expect(onChain.toLowerCase()).toBe(computePaymentHash(proposal as never).toLowerCase());
  }, 60_000);

  it("reads the agent's real limits and the vault balance", async () => {
    const s = await x.agentState(AGENT, NATIVE);
    expect(typeof s.active).toBe("boolean");
    expect(typeof (await x.vaultBalance())).toBe("bigint");
  }, 60_000);

  it("simulation reports the contract's real rejection for an over-cap payment (no transaction sent)", async () => {
    const s = await x.agentState(AGENT, NATIVE);
    const tooBig = toPaymentTuple({ token: NATIVE, to: "0x200cad3c9de63d3613a33fc20b1ef31cb4dbf5af", amount: String((s.perTxCap + 10n ** 18n)), purposeHash: ("0x" + "33".repeat(32)), policyVersion: 1, expiry: Math.floor(Date.now() / 1000) + 3600, nonce: String(Date.now()) });
    const r = await x.simulateExecutePayment(AGENT, tooBig);
    expect(r.ok).toBe(false);
    console.log("simulated rejection:", r.errorName ?? r.message);
  }, 60_000);
});
