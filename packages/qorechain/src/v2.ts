/**
 * TreasuryVault V2: digests and encodings shared by the administrator's signing tool, the server's relay and the tests.
 * They must match contracts/src/TreasuryVaultV2.sol byte for byte (fixed vectors in v2.test.ts and TreasuryVaultV2.t.sol).
 *
 * Nothing here holds or loads a key. `signApprovalV2` takes a secret key as an argument and is meant for the
 * administrator's own computer (scripts/v2-admin.ts), never for the website server.
 */
import { pqcSign, pqcVerify } from "@qorechain/sdk";
import { concat, encodeAbiParameters, keccak256, parseAbi, toBytes, toHex, type Hex } from "viem";

export const PQC_VERIFY_PRECOMPILE = "0x0000000000000000000000000000000000000a01" as const;
export const PQC_STATUS_PRECOMPILE = "0x0000000000000000000000000000000000000a02" as const;
export const V2_PAYMENT_TAG = keccak256(toBytes("Verac.TreasuryVaultV2.Payment.v1"));
export const V2_ADMIN_TAG = keccak256(toBytes("Verac.TreasuryVaultV2.Admin.v1"));
export const V2_SIGNING_PREFIX = toHex(toBytes("verac-v2-approval|"));

export interface V2Payment { token: Hex; to: Hex; amount: bigint; purposeHash: Hex; policyVersion: bigint; expiry: bigint; nonce: bigint }
export interface V2AdminSig { signer: Hex; signature: Hex }

export enum AdminOp { SetAgentLimits = 0, RevokeAgent = 1, SetRecipient = 2, SetToken = 3, AddAdmin = 4, RemoveAdmin = 5, SetThreshold = 6, SetPolicy = 7, SetGuardian = 8, Unpause = 9 }

const PAYMENT_TUPLE = "(address token, address to, uint256 amount, bytes32 purposeHash, uint64 policyVersion, uint64 expiry, uint256 nonce)";
const SIG_TUPLE = "(address signer, bytes signature)[]";
export const treasuryVaultV2Abi = parseAbi([
  "constructor(address[] admins, uint8 threshold_, bytes32 policyHash_)",
  `function executePayment(${PAYMENT_TUPLE} p, ${SIG_TUPLE} sigs) returns (bytes32)`,
  `function executeAdminAction(uint8 op, bytes data, uint256 nonce, uint64 expiry, ${SIG_TUPLE} sigs)`,
  `function paymentDigest(address agent, ${PAYMENT_TUPLE} p) view returns (bytes32)`,
  "function adminDigest(uint8 op, bytes data, uint256 nonce, uint64 expiry) view returns (bytes32)",
  "function signingBytes(bytes32 digest) pure returns (bytes)",
  "function isAdmin(address) view returns (bool)",
  "function adminCount() view returns (uint8)",
  "function threshold() view returns (uint8)",
  "function adminNonce() view returns (uint256)",
  "function policyVersion() view returns (uint64)",
  "function policyHash() view returns (bytes32)",
  "function paused() view returns (bool)",
  "function isGuardian(address) view returns (bool)",
  "function approvedRecipient(address) view returns (bool)",
  "function allowedToken(address) view returns (bool)",
  "function limits(address agent, address token) view returns (bool active, uint64 validUntil, uint128 perTxCap, uint128 dailyCap)",
  "function remainingDaily(address agent, address token) view returns (uint256)",
  "function executed(bytes32) view returns (bool)",
  "function pause()",
  "function guardianRevokeAgent(address agent, address token)",
  "event PaymentExecuted(bytes32 indexed paymentDigest, address indexed agent, address indexed to, address token, uint256 amount, bytes32 purposeHash, uint64 policyVersion, address[] signers)",
  "event AdminActionExecuted(uint256 indexed nonce, uint8 indexed op, bytes32 dataHash, address[] signers)",
  "event Deposited(address indexed token, address indexed from, uint256 amount)",
  "event AdminSet(address indexed admin, bool enabled)",
  "event ThresholdSet(uint8 threshold)",
  "event AgentLimitsSet(address indexed agent, address indexed token, uint128 perTxCap, uint128 dailyCap, uint64 validUntil)",
  "event AgentRevoked(address indexed agent, address indexed token, address by)",
  "event RecipientSet(address indexed recipient, bool approved)",
  "event TokenSet(address indexed token, bool allowed)",
  "event PolicySet(uint64 version, bytes32 policyHash)",
  "event GuardianSet(address indexed guardian, bool enabled)",
  "event Paused(address by)",
  "event Unpaused()",
  "error BadConfig()", "error NotAdmin(address signer)", "error SignersNotSorted()", "error AdminKeyNotProven(address signer)",
  "error BadSignature(address signer)", "error NotEnoughSignatures(uint256 have, uint256 need)", "error Expired()", "error LifetimeTooLong()",
  "error AlreadyExecuted()", "error BadNonce(uint256 expected)", "error PolicyMismatch()", "error AgentNotActive()", "error ExceedsPerTxCap()",
  "error ExceedsDailyCap()", "error RecipientNotApproved()", "error TokenNotAllowed()", "error InvalidPayment()", "error IsPaused()",
  "error NotGuardian()", "error AgentCannotBeAdmin()", "error TransferFailed()",
]);

export function paymentDigestV2(chainId: bigint, vault: Hex, agent: Hex, p: V2Payment): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint64" }, { type: "uint64" }, { type: "uint256" }],
    [V2_PAYMENT_TAG, chainId, vault, agent, p.token, p.to, p.amount, p.purposeHash, p.policyVersion, p.expiry, p.nonce],
  ));
}

export function adminDigestV2(chainId: bigint, vault: Hex, op: AdminOp, data: Hex, nonce: bigint, expiry: bigint): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint8" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
    [V2_ADMIN_TAG, chainId, vault, op, keccak256(data), nonce, expiry],
  ));
}

/** The bytes an administrator's ML-DSA-87 key signs: "verac-v2-approval|" followed by the 32-byte digest. */
export const signingBytesV2 = (digest: Hex): Uint8Array => toBytes(concat([V2_SIGNING_PREFIX, digest]));

/** Data encodings for each admin operation, matching the contract's abi.decode. */
export const adminData = {
  setAgentLimits: (agent: Hex, token: Hex, perTxCap: bigint, dailyCap: bigint, validUntil: bigint) =>
    encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint128" }, { type: "uint128" }, { type: "uint64" }], [agent, token, perTxCap, dailyCap, validUntil]),
  revokeAgent: (agent: Hex, token: Hex) => encodeAbiParameters([{ type: "address" }, { type: "address" }], [agent, token]),
  setRecipient: (r: Hex, ok: boolean) => encodeAbiParameters([{ type: "address" }, { type: "bool" }], [r, ok]),
  setToken: (t: Hex, ok: boolean) => encodeAbiParameters([{ type: "address" }, { type: "bool" }], [t, ok]),
  addAdmin: (a: Hex) => encodeAbiParameters([{ type: "address" }], [a]),
  removeAdmin: (a: Hex) => encodeAbiParameters([{ type: "address" }], [a]),
  setThreshold: (t: number) => encodeAbiParameters([{ type: "uint8" }], [t]),
  setPolicy: (h: Hex) => encodeAbiParameters([{ type: "bytes32" }], [h]),
  setGuardian: (g: Hex, ok: boolean) => encodeAbiParameters([{ type: "address" }, { type: "bool" }], [g, ok]),
  unpause: () => "0x" as Hex,
};

/** Signs a digest with an ML-DSA-87 secret key. For the administrator's own machine only. */
export function signApprovalV2(secretKey: Uint8Array, digest: Hex): Hex {
  return toHex(pqcSign(secretKey, signingBytesV2(digest)));
}

/** Local check before relaying: does `signature` verify for `publicKey` over this digest? (The vault checks again on chain.) */
export function verifyApprovalV2(publicKey: Uint8Array, digest: Hex, signature: Hex): boolean {
  try { return pqcVerify(publicKey, signingBytesV2(digest), toBytes(signature)); } catch { return false; }
}

/** The vault requires signers in strictly increasing address order, each at most once. */
export function sortSigs(sigs: V2AdminSig[]): V2AdminSig[] {
  const seen = new Set<string>();
  const out = [...sigs].sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : BigInt(a.signer) > BigInt(b.signer) ? 1 : 0));
  for (const s of out) { const k = s.signer.toLowerCase(); if (seen.has(k)) throw new Error(`duplicate signer ${s.signer}`); seen.add(k); }
  return out;
}
