import { createWalletClient, encodeFunctionData, http, keccak256, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { QORE_NETWORK, assertTestnet } from "@qoreops/shared-types";
import { DEPLOYED, treasuryVaultAbi } from "./contracts";
import { qoreDianaTestnet } from "./index";
import type { PaymentTuple } from "./execution";

/**
 * RESTRICTED SIGNING. This is the only place in Verac that holds a signing key, and it is server-side only.
 *
 * What it can do is deliberately small:
 *  - it never accepts calldata. It builds the call itself from a structured payment, so Gemini or any request body
 *    cannot make it sign "something else";
 *  - an AGENT signer can only call TreasuryVault.executePayment or fundEscrow; an APPROVER signer can only call
 *    TreasuryVault.approvePayment. The two roles use different keys, so the approver key can never pay and the agent
 *    key can never approve;
 *  - the target is always the vault from the deployment list, the value is always 0, native QOR only;
 *  - no single operation may exceed SIGNER_LIMITS.maxQorPerOperation, whatever the database or the caller says.
 * The vault enforces its own caps on chain as well. These checks are a second wall, not the only one.
 *
 * Honest limit: this is server-managed signing with a throwaway testnet key. It is not production custody.
 */

export const SIGNER_LIMITS = {
  /** 10 QOR (18 decimals): the most one operation may move. */
  maxQorPerOperation: 10n * 10n ** 18n,
  /** Window sizing used by WindowManager: short and tight. */
  windowBlocks: 120,
  windowMaxTxs: 3,
  /** Maximum value plus fees the window admits, in uqor (the operations move no value from the signer; this only covers fees). */
  windowMaxUqor: 2_000_000,
} as const;

export type SignerRole = "agent" | "approver";
const NATIVE = "0x0000000000000000000000000000000000000000";

export type Operation =
  | { kind: "executePayment"; payment: PaymentTuple }
  | { kind: "fundEscrow"; payment: PaymentTuple; projectId: bigint }
  | { kind: "approvePayment"; agent: `0x${string}`; payment: PaymentTuple };

export interface PreparedCall { to: `0x${string}`; data: Hex; value: 0n; kind: Operation["kind"]; calldataHash: Hex }

const ALLOWED: Record<SignerRole, ReadonlyArray<Operation["kind"]>> = {
  agent: ["executePayment", "fundEscrow"],
  approver: ["approvePayment"],
};

export class SignerRefusal extends Error {
  constructor(readonly code: "WRONG_ROLE" | "OVER_LIMIT" | "NOT_NATIVE" | "BAD_CHAIN" | "DISABLED" | "BAD_KEY" | "EXPIRED" | "BAD_ESCROW", message: string) {
    super(message); this.name = "SignerRefusal";
  }
}

/** Builds the exact call and its hash. Used both when a request is created (to bind the approval) and again just before sending. */
export function prepareCall(op: Operation, vault: `0x${string}` = DEPLOYED.TreasuryVault): PreparedCall {
  const p = op.payment;
  if (p.token.toLowerCase() !== NATIVE) throw new SignerRefusal("NOT_NATIVE", "Only native testnet QOR can be moved by the website.");
  if (p.amount <= 0n || p.amount > SIGNER_LIMITS.maxQorPerOperation) throw new SignerRefusal("OVER_LIMIT", "An operation may move at most 10 QOR.");
  let data: Hex;
  if (op.kind === "executePayment") data = encodeFunctionData({ abi: treasuryVaultAbi, functionName: "executePayment", args: [p] });
  else if (op.kind === "fundEscrow") {
    if (p.to.toLowerCase() !== DEPLOYED.MilestoneEscrow.toLowerCase()) throw new SignerRefusal("BAD_ESCROW", "Escrow funding may only target the deployed MilestoneEscrow.");
    data = encodeFunctionData({ abi: treasuryVaultAbi, functionName: "fundEscrow", args: [p, op.projectId] });
  } else data = encodeFunctionData({ abi: treasuryVaultAbi, functionName: "approvePayment", args: [op.agent, p] });
  return { to: vault, data, value: 0n, kind: op.kind, calldataHash: keccak256(data) };
}

export interface KillSwitch { enabled(): boolean }

/** Reads the kill switch from the environment on every call, so setting LIVE_EXECUTION_ENABLED=false in Vercel stops signing without a code change. */
export const envKillSwitch = (env: Record<string, string | undefined> = process.env): KillSwitch => ({
  enabled: () => env.LIVE_EXECUTION_ENABLED === "true" && env.LIVE_EMERGENCY_STOP !== "true",
});

export class RestrictedSigner {
  readonly address: `0x${string}`;
  readonly #account;
  readonly #kill: KillSwitch;
  readonly #evm: PublicClient;
  readonly #rpcUrl: string;

  /** `privateKey` comes from a server-only environment variable. It is never logged, returned or sent anywhere but used to sign locally. */
  constructor(readonly role: SignerRole, privateKey: Hex, evm: PublicClient, kill: KillSwitch = envKillSwitch(), expectedAddress?: `0x${string}`, rpcUrl: string = QORE_NETWORK.evmRpc) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new SignerRefusal("BAD_KEY", "The signing key is not a 32-byte hex value.");
    this.#account = privateKeyToAccount(privateKey);
    this.#kill = kill; this.#evm = evm; this.#rpcUrl = rpcUrl;
    this.address = this.#account.address;
    if (expectedAddress && expectedAddress.toLowerCase() !== this.address.toLowerCase()) throw new SignerRefusal("BAD_KEY", "The configured key does not belong to the expected account.");
  }

  /** Checks everything that can be checked without sending. Throws SignerRefusal. */
  precheck(call: PreparedCall, nowSeconds: number = Math.floor(Date.now() / 1000), expiry?: bigint): void {
    if (!this.#kill.enabled()) throw new SignerRefusal("DISABLED", "Live execution is switched off (LIVE_EXECUTION_ENABLED or the emergency stop).");
    if (!ALLOWED[this.role].includes(call.kind)) throw new SignerRefusal("WRONG_ROLE", `The ${this.role} key may not sign ${call.kind}.`);
    if (call.value !== 0n) throw new SignerRefusal("OVER_LIMIT", "The signer never attaches value.");
    if (call.to.toLowerCase() !== DEPLOYED.TreasuryVault.toLowerCase()) throw new SignerRefusal("WRONG_ROLE", "The signer may only call the deployed TreasuryVault.");
    if (expiry !== undefined && BigInt(nowSeconds) > expiry) throw new SignerRefusal("EXPIRED", "The payment has expired.");
  }

  /** Signs locally and submits with eth_sendRawTransaction. QoreX is not involved: this key never leaves the server. */
  async send(call: PreparedCall, expiry?: bigint): Promise<Hex> {
    this.precheck(call, undefined, expiry);
    assertTestnet({ evmChainId: await this.#evm.getChainId() });
    const wallet = createWalletClient({ account: this.#account, chain: qoreDianaTestnet, transport: http(this.#rpcUrl) });
    const gasPrice = await this.#evm.getGasPrice();
    const gas = await this.#evm.estimateGas({ account: this.#account, to: call.to, data: call.data, value: 0n }).catch(() => 900_000n);
    return wallet.sendTransaction({ to: call.to, data: call.data, value: 0n, gas: (gas * 13n) / 10n, gasPrice, type: "legacy" });
  }
}
