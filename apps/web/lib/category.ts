/**
 * The Post-Quantum AI Agents category requirements and the evidence for each, as shown on Live Proof.
 * Sources, in order of strength: a transaction re-read from the chain now; a run recorded by category-proofs.ts
 * (deployments/category-proofs.json); an automated local test; nothing yet. A requirement is never shown as verified
 * on chain without a transaction or a recorded chain response behind it.
 */
import proofs from "../../../deployments/category-proofs.json";

export type EvidenceStatus = "verified-onchain" | "local-test" | "configured" | "not-verified" | "failed";
export interface CategoryCheck {
  id: string; requirement: string; name: string; mechanism: string; subject: string;
  expected: string; status: EvidenceStatus; denial?: "on-chain" | "before-inclusion" | null;
  txHash?: string; height?: string; actual?: string; rpcError?: string; verifiedAt?: string; source: string; lane?: "evm" | "native";
}
interface Run { id: string; requirement: string; scenario: string; account: string; target?: string; txHash?: string; height?: string; expected: string; actual: string; denial: "on-chain" | "before-inclusion" | null; rpcError?: string; verifiedAt: string; source: string }

const runs = (proofs as { runs: Run[] }).runs;
/** A recorded run passes only when the outcome is the one the check expects: a refusal, or an admission. */
export function runPassed(actual: string, want: "refused" | "admitted"): boolean {
  if (/unexpected/i.test(actual)) return false;
  const refused = /^(refused|execution failed)/i.test(actual);
  const admitted = /^(admitted|execution succeeded|linked|revoked)$/i.test(actual.trim());
  return want === "refused" ? refused : admitted;
}

function fromRun(base: Omit<CategoryCheck, "status" | "source">, id: string, want: "refused" | "admitted"): CategoryCheck {
  const r = [...runs].reverse().find((x) => x.id === id);
  if (!r) return { ...base, status: "not-verified", source: "Planned: packages/qorechain/scripts/category-proofs.ts (needs owner approval to broadcast)" };
  return { ...base, status: runPassed(r.actual, want) ? "verified-onchain" : "failed", denial: r.denial, txHash: r.txHash, height: r.height, actual: r.actual, rpcError: r.rpcError, verifiedAt: r.verifiedAt, source: `Recorded run (${r.scenario}) in deployments/category-proofs.json`, lane: r.txHash?.startsWith("0x") ? "evm" : "native" };
}

export function categoryChecks(): CategoryCheck[] {
  return [
    // A. Scoped EVM authorisation: real windows opened and closed by hybrid-signed native transactions.
    { id: "A-1", requirement: "A Scoped EVM authorisation", name: "Owner opens a vault-only EVM window", mechanism: "QoreChain native MsgOpenEVMWindow, hybrid signed (secp256k1 + ML-DSA-87), allowedTargets = [TreasuryVault]", subject: "Vault owner account", expected: "Window opened", status: "verified-onchain", txHash: "01FFA4EB67E7104C47442C4463D850ED95F813EBB779BC3674F93D776582E533", source: "Live execution setup, 2026-11-15 (docs/LIVE_SETUP_2026-11-15.md)", lane: "native" },
    { id: "A-2", requirement: "A Scoped EVM authorisation", name: "Owner closes the window after use", mechanism: "QoreChain native MsgCloseEVMWindow", subject: "Vault owner account", expected: "Window closed", status: "verified-onchain", txHash: "DF0770056DF9D618AE2F9517C4F3CF899901024029847D7015D0D4A32E2B9456", source: "Live execution setup, 2026-11-15", lane: "native" },
    fromRun({ id: "B-2", requirement: "B Transaction-count limits", name: "A second transaction in a 1-transaction window", mechanism: "QoreChain native window maxTxs", subject: "Dedicated test account", expected: "Refused before inclusion" }, "B-2", "refused"),
    fromRun({ id: "C1-1", requirement: "C Value limits (native window)", name: "0.5 QOR in a 0.05 QOR window", mechanism: "QoreChain native window maxValue (value plus max fee, in uqor)", subject: "Dedicated test account", expected: "Refused before inclusion" }, "C1-1", "refused"),
    { id: "C2-1", requirement: "C Value limits (contract)", name: "Agent pays 15 QOR with a 10 QOR cap", mechanism: "TreasuryVault perTxCap, enforced by the contract", subject: "TreasuryVault", expected: "Reverted ExceedsPerTxCap()", status: "verified-onchain", denial: "on-chain", txHash: "0xbeb8d5639e5b3fa9e811fd773988cf519b15243a094de535c4e0dc4ec688171e", source: "2026-11-14 run (docs/LIVE_RUN_2026-11-14.md)", lane: "evm" },
    { id: "C2-2", requirement: "C Value limits (contract)", name: "Agent pays an unapproved recipient", mechanism: "TreasuryVault approved-recipient list", subject: "TreasuryVault", expected: "Reverted InsufficientApprovals(0, 1)", status: "verified-onchain", denial: "on-chain", txHash: "0x05e7c3faa29365753c310fec1a36a54bd9b7443bb046305255ea614b63f42e16", source: "2026-11-14 run", lane: "evm" },
    fromRun({ id: "D-1", requirement: "D Duration limits", name: "A transaction after the window's expiry height", mechanism: "QoreChain native window blocks (expiry height, not wall-clock)", subject: "Dedicated test account", expected: "Refused before inclusion" }, "D-1", "refused"),
    fromRun({ id: "E-2", requirement: "E Target restrictions", name: "Transfer to 0x…dEaD from a vault-only window", mechanism: "QoreChain native window allowedTargets", subject: "Dedicated test account", expected: "Refused before inclusion" }, "E-2", "refused"),
    fromRun({ id: "F-1", requirement: "F Native smart-account spending rules", name: "Link a delegated ed25519 key with a spending rule", mechanism: "x/abstractaccount MsgUpdateSpendingRules + MsgRegisterAuthenticator (possession proof, expiry, send only, uqor only)", subject: "Dedicated test account", expected: "Linked" }, "F-1", "admitted"),
    fromRun({ id: "F-3", requirement: "F Native smart-account spending rules", name: "Delegated key exceeds the per-transaction limit", mechanism: "x/abstractaccount spending rule perTxLimit", subject: "Dedicated test account", expected: "Execution failed on chain (code 0 envelope, success = false)" }, "F-3", "refused"),
    fromRun({ id: "F-4.2", requirement: "F Native smart-account spending rules", name: "Delegated key exceeds the daily limit", mechanism: "x/abstractaccount spending rule dailyLimit", subject: "Dedicated test account", expected: "Second execution failed on chain" }, "F-4.2", "refused"),
    fromRun({ id: "F-7", requirement: "F Native smart-account spending rules", name: "Revoked key tries to spend", mechanism: "x/abstractaccount MsgRevokeAuthenticator", subject: "Dedicated test account", expected: "Refused" }, "F-7", "refused"),
    { id: "G-1", requirement: "G Authenticated messaging", name: "Spoofed sender, altered payload, forged tag, foreign secret", mechanism: "HMAC-SHA256 per agent (HKDF from one root secret); not a post-quantum signature", subject: "Verac coordinator", expected: "Rejected BAD_SIGNATURE", status: "local-test", source: "services/agent-coordinator/src/messaging-attacks.test.ts" },
    { id: "G-2", requirement: "G Authenticated messaging", name: "Replayed, expired, wrong organisation, wrong task, wrong recipient, unauthorised sender", mechanism: "Nonce memory + unique (organisation, nonce) in agent_messages; expiry; envelope binding; sender allow-list", subject: "Verac coordinator", expected: "Rejected REPLAY / EXPIRED / WRONG_ORGANIZATION / WRONG_TASK / WRONG_RECIPIENT / SENDER_NOT_ALLOWED", status: "local-test", source: "services/agent-coordinator/src/messaging-attacks.test.ts" },
  ];
}

export const STATUS_TEXT: Record<EvidenceStatus, string> = {
  "verified-onchain": "VERIFIED ON-CHAIN", "local-test": "VERIFIED BY LOCAL TEST", configured: "CONFIGURED", "not-verified": "NOT YET VERIFIED", failed: "FAILED",
};
