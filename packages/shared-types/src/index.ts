import { z } from "zod";

// ------------------------------------------------------------------ chain constants
/** Mainnet is intentionally unsupported. Anything other than Diana testnet is refused. */
export const QORE_NETWORK = {
  nativeChainId: "qorechain-diana",
  evmChainId: 9800,
  evmRpc: "https://evm-testnet.qore.host",
  rest: "https://api-testnet.qore.host",
  rpc: "https://rpc-testnet.qore.host",
  explorer: "https://explore.qore.network",
  uqorPerQor: 1_000_000n,
} as const;

export function assertTestnet(chain: { nativeChainId?: string; evmChainId?: number }): void {
  if (chain.nativeChainId !== undefined && chain.nativeChainId !== QORE_NETWORK.nativeChainId) {
    throw new Error(`Refusing non-testnet native chain id: ${chain.nativeChainId}`);
  }
  if (chain.evmChainId !== undefined && chain.evmChainId !== QORE_NETWORK.evmChainId) {
    throw new Error(`Refusing non-testnet EVM chain id: ${chain.evmChainId}`);
  }
}

// ------------------------------------------------------------------ primitives
export const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address");
export type Address = z.infer<typeof AddressSchema>;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const NATIVE_TOKEN = ZERO_ADDRESS;

/** Non-negative integer in base units, as a decimal string (JSON-safe bigint). */
export const UintStringSchema = z.string().regex(/^(0|[1-9][0-9]{0,77})$/, "must be a base-10 unsigned integer string");
export type UintString = z.infer<typeof UintStringSchema>;

export const Bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const UuidSchema = z.string().uuid();

// ------------------------------------------------------------------ roles & agents
export const ROLES = [
  "owner",
  "administrator",
  "finance_manager",
  "procurement_manager",
  "security_reviewer",
  "employee",
  "vendor",
  "grant_applicant",
  "dao_member",
  "auditor",
] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const AGENT_IDS = [
  "TreasuryAgent",
  "PaymentAgent",
  "InvoiceFraudAgent",
  "ProcurementAgent",
  "GrantAgent",
  "MilestoneAgent",
  "DocumentAgent",
  "PolicyAgent",
  "SecurityAgent",
  "PayrollAgent",
  "RevenueAgent",
  "GovernanceAgent",
  "StrategyAgent",
  "ArbitrageAgent",
  "DisputeAgent",
] as const;
export const AgentIdSchema = z.enum(AGENT_IDS);
export type AgentId = z.infer<typeof AgentIdSchema>;

// ------------------------------------------------------------------ operation state machine
export const OPERATION_STATES = [
  "PROPOSED",
  "VALIDATING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "SIMULATING",
  "READY",
  "SUBMITTED",
  "CONFIRMED",
  "REJECTED",
  "FAILED",
  "CANCELLED",
] as const;
export const OperationStateSchema = z.enum(OPERATION_STATES);
export type OperationState = z.infer<typeof OperationStateSchema>;

const TRANSITIONS: Record<OperationState, readonly OperationState[]> = {
  PROPOSED: ["VALIDATING", "CANCELLED"],
  VALIDATING: ["AWAITING_APPROVAL", "APPROVED", "REJECTED", "FAILED"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["SIMULATING", "CANCELLED"],
  SIMULATING: ["READY", "REJECTED", "FAILED"],
  READY: ["SUBMITTED", "FAILED", "CANCELLED"],
  SUBMITTED: ["CONFIRMED", "FAILED"],
  CONFIRMED: [],
  REJECTED: [],
  FAILED: [], // terminal: a retry is a NEW operation with a new idempotency key, never a resurrection
  CANCELLED: [],
};

export function canTransition(from: OperationState, to: OperationState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OperationState, to: OperationState): void {
  if (!canTransition(from, to)) throw new Error(`Illegal operation state transition ${from} -> ${to}`);
}

export const isTerminal = (s: OperationState): boolean => TRANSITIONS[s].length === 0;

// ------------------------------------------------------------------ payments
export const PaymentProposalSchema = z
  .object({
    organizationId: UuidSchema,
    agent: AgentIdSchema,
    /** Account that signs the on-chain call (the delegated agent key). */
    agentAccount: AddressSchema,
    chainId: z.literal(QORE_NETWORK.evmChainId),
    vault: AddressSchema,
    token: AddressSchema, // 0x000..0 = native QOR
    to: AddressSchema,
    amount: UintStringSchema,
    purposeHash: Bytes32Schema,
    policyVersion: z.number().int().positive(),
    nonce: UintStringSchema,
    expiry: z.number().int().positive(), // unix seconds
    /** Same key => same operation. Prevents double payment on retries/restarts. */
    idempotencyKey: z.string().min(8).max(128),
    /** Free-text reference for humans; never used for authorisation. */
    memo: z.string().max(280).optional(),
  })
  .strict();
export type PaymentProposal = z.infer<typeof PaymentProposalSchema>;

// ------------------------------------------------------------------ policy (structured form of natural-language policies)
export const PolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1).max(120),
    agent: AgentIdSchema,
    token: AddressSchema,
    tokenDecimals: z.number().int().min(0).max(36),
    perTxCap: UintStringSchema,
    dailyCap: UintStringSchema,
    /** Payments to already-approved recipients at or below this need no human approval. */
    autoApproveCap: UintStringSchema,
    approvalThreshold: z.number().int().min(1).max(10),
    requireApprovalForNewRecipients: z.boolean().default(true),
    allowedRecipients: z.array(AddressSchema).max(256).optional(),
    validForSeconds: z.number().int().min(60).max(31_536_000),
  })
  .strict();
export type Policy = z.infer<typeof PolicySchema>;

// ------------------------------------------------------------------ audit
export const AuditEventSchema = z.object({
  organizationId: UuidSchema,
  actor: z.string().min(1),
  action: z.string().min(1),
  subject: z.string().optional(),
  detail: z.record(z.unknown()).default({}),
  at: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/** Labels the UI must show; used so demo data can never look like live chain data. */
export const DATA_SOURCES = ["LIVE_TESTNET", "SIMULATION", "SAMPLE_DATA", "UNAVAILABLE"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];
