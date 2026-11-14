import { createHash } from "node:crypto";

/** Same fingerprint as the browser computes: first 16 hex chars of SHA-256(mlkemPublic || x25519Public), in groups of four. */
export function keyFingerprint(mlkemHex: string, x25519Hex: string): string {
  return createHash("sha256").update(Buffer.from(mlkemHex + x25519Hex, "hex")).digest("hex").slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ");
}

export const REVIEWER_ROLES = ["owner", "administrator", "procurement_manager"];
