import { parseAbi } from "viem";

/**
 * ABIs for the five deployed Verac contracts, written from the Solidity sources in contracts/src (not guessed).
 * A test (contracts.test.ts) checks the addresses here against deployments/diana-testnet.json and, when LIVE_CHAIN=1,
 * checks the vault's paymentHash against the TypeScript implementation and that code exists at every address.
 */

export const DEPLOYED = {
  PolicyManager: "0xE4ba9fBfB11Bb947284D7e08acec871Ad42a0ab1",
  TreasuryVault: "0xa343930CE94b1d1629791823A75fb14a1D7C7Ab8",
  MilestoneEscrow: "0xd577FFB031358d46B369E9fE293c5a21a1C1FA90",
  AuditAnchor: "0x4D1dc4ff95dc9443552c3A8Efa7d1a21B4Bdc1C2",
  OrganizationRegistry: "0x0FDDFFf7a39FFa5C0cA401D7d4cd7B8C492ec55E",
} as const satisfies Record<string, `0x${string}`>;

export type ContractName = keyof typeof DEPLOYED;

const PAYMENT = "(address token, address to, uint256 amount, bytes32 purposeHash, uint64 policyVersion, uint64 expiry, uint256 nonce)";

export const treasuryVaultAbi = parseAbi([
  `function executePayment(${PAYMENT} p) returns (bytes32 h)`,
  `function fundEscrow(${PAYMENT} p, uint256 projectId) returns (bytes32 h)`,
  `function approvePayment(address agent, ${PAYMENT} p) returns (bytes32 h)`,
  `function paymentHash(address agent, ${PAYMENT} p) view returns (bytes32)`,
  "function approvalsOf(bytes32) view returns (uint32)",
  "function approvedBy(bytes32, address) view returns (bool)",
  "function executed(bytes32) view returns (bool)",
  "function remainingDaily(address agent, address token) view returns (uint256)",
  "function approvalsRequired(address agent, address token, address to, uint256 amount) view returns (uint32)",
  "function limits(address agent, address token) view returns (bool active, uint64 validUntil, uint128 perTxCap, uint128 dailyCap, uint128 autoApproveCap)",
  "function approvedRecipient(address) view returns (bool)",
  "function isApprover(address) view returns (bool)",
  "function isEscrow(address) view returns (bool)",
  "function approvalThreshold() view returns (uint8)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function setAgentLimits(address agent, address token, uint128 perTxCap, uint128 dailyCap, uint128 autoApproveCap, uint64 validUntil)",
  "function revokeAgent(address agent, address token)",
  "function setApprover(address approver, bool enabled)",
  "function approverCount() view returns (uint32)",
  "function setApprovedRecipient(address recipient, bool approved)",
  "event AgentLimitsSet(address indexed agent, address indexed token, uint128 perTxCap, uint128 dailyCap, uint128 autoApproveCap, uint64 validUntil)",
  "event AgentRevoked(address indexed agent, address indexed token)",
  "event PaymentApproved(bytes32 indexed paymentHash, address indexed approver, uint32 approvals)",
  "event PaymentExecuted(bytes32 indexed paymentHash, address indexed agent, address indexed to, address token, uint256 amount, bytes32 purposeHash, uint64 policyVersion)",
  "event EscrowFunded(bytes32 indexed paymentHash, address indexed escrow, uint256 indexed projectId, address token, uint256 amount)",
  "error NotGuardianOrOwner()",
  "error NotApprover()",
  "error InvalidPayment()",
  "error PolicyMismatch()",
  "error Expired()",
  "error AlreadyExecuted()",
  "error AgentNotActive()",
  "error TokenNotAllowed()",
  "error ExceedsPerTxCap()",
  "error ExceedsDailyCap()",
  "error InsufficientApprovals(uint32 have, uint32 need)",
  "error AlreadyApproved()",
  "error InvalidThreshold()",
  "error NotEscrow()",
  "error EscrowProjectMismatch()",
  "error TransferFailed()",
  "error CapTooLarge()",
]);

export const milestoneEscrowAbi = parseAbi([
  "function approveMilestone(uint256 projectId, uint256 index)",
  "function releaseMilestone(uint256 projectId, uint256 index)",
  "function nextProjectId() view returns (uint256)",
  "function projectPayer(uint256 projectId) view returns (address)",
  "function projectToken(uint256 projectId) view returns (address)",
  "function milestoneAmount(uint256 projectId, uint256 index) view returns (uint256)",
  "function milestoneState(uint256 projectId, uint256 index) view returns (uint8)",
  "function remaining(uint256 projectId) view returns (uint256)",
  "function getProject(uint256 projectId) view returns ((address payer, address payee, address reviewer, address token, uint8 kind, uint8 state, uint64 deadline, uint32 milestoneCount, uint32 approvedUnreleased, bool payeeConsentsCancel, uint256 total, uint256 funded, uint256 released, uint256 refunded, bytes32 metadataHash))",
  "event ProjectCreated(uint256 indexed projectId, address indexed payer, address indexed payee, address token, uint8 kind, uint256 total)",
  "event ProjectFunded(uint256 indexed projectId, uint256 amount, uint256 fundedTotal)",
  "event MilestoneApproved(uint256 indexed projectId, uint256 indexed index, address indexed reviewer)",
  "event MilestoneReleased(uint256 indexed projectId, uint256 indexed index, address indexed payee, uint256 amount)",
  "event ProjectCompleted(uint256 indexed projectId)",
  "error NotAuthorized()",
  "error InvalidParams()",
  "error InvalidState()",
  "error AmountMismatch()",
  "error Overfunded()",
  "error NotApproved()",
  "error InsufficientFunded()",
  "error RefundNotAllowed()",
  "error TransferFailed()",
]);

export const policyManagerAbi = parseAbi(["function activeVersion() view returns (uint64)"]);

export const auditAnchorAbi = parseAbi([
  "function anchor(bytes32 orgRef, bytes32 kind, bytes32 contentHash, bytes32 metaHash)",
  "function isAnchored(bytes32 orgRef, bytes32 kind, bytes32 contentHash) view returns (bool)",
]);

export const organizationRegistryAbi = parseAbi([
  "function ownerOf(uint256 orgId) view returns (address)",
  "function isAdmin(uint256 orgId, address account) view returns (bool)",
]);

/** The vault and escrow errors together, so a revert from either contract decodes to a name. */
export const allErrorsAbi = [...treasuryVaultAbi, ...milestoneEscrowAbi].filter((x) => x.type === "error");
