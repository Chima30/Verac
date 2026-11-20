/**
 * TreasuryVault V2 administrative changes as data: build one from a command, describe one in plain words, and the
 * signing-request format administrators sign on their own computers. Pure: no keys, no network.
 */
import { decodeAbiParameters, getAddress, type Hex } from "viem";
import { AdminOp, adminData } from "../../src/v2";

export const ADMIN_REQUEST_FORMAT = "verac-v2-admin-request/1";
export interface AdminRequest {
  format: typeof ADMIN_REQUEST_FORMAT; chainId: 9800; vault: Hex; op: number; opName: string; data: Hex; nonce: string; expiry: string;
  digest: Hex; summary: string; createdAt: string;
}

export interface BuiltOp { op: AdminOp; data: Hex; summary: string }

/** Builds the change named by a command: recipient <addr> [--remove], add-admin <addr>, remove-admin <addr>. */
export function buildAdminOp(cmd: string, target: string | undefined, remove = false): BuiltOp {
  if (!target || !/^0x[0-9a-fA-F]{40}$/.test(target)) throw new Error(`${cmd} needs a 0x address`);
  const a = getAddress(target);
  switch (cmd) {
    case "recipient": return { op: AdminOp.SetRecipient, data: adminData.setRecipient(a, !remove), summary: `${remove ? "Remove" : "Approve"} payment recipient ${a}` };
    case "add-admin": return { op: AdminOp.AddAdmin, data: adminData.addAdmin(a), summary: `Add administrator ${a}` };
    case "remove-admin": return { op: AdminOp.RemoveAdmin, data: adminData.removeAdmin(a), summary: `Remove administrator ${a}` };
    default: throw new Error(`unknown change "${cmd}"`);
  }
}

const addr = (d: Hex) => decodeAbiParameters([{ type: "address" }], d)[0];
/** Plain-words description of a change, decoded from its data (never trusted from a request's own summary). */
export function describeAdminOp(op: number, data: Hex): string {
  switch (op) {
    case AdminOp.SetAgentLimits: { const [agent, token, perTx, daily, until] = decodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint128" }, { type: "uint128" }, { type: "uint64" }], data); return `Set agent ${agent} limits: ${Number(perTx / 10n ** 12n) / 1e6} per payment, ${Number(daily / 10n ** 12n) / 1e6} per day of token ${token}, until ${new Date(Number(until) * 1000).toISOString()}`; }
    case AdminOp.RevokeAgent: { const [agent] = decodeAbiParameters([{ type: "address" }, { type: "address" }], data); return `Revoke agent ${agent}`; }
    case AdminOp.SetRecipient: { const [r, ok] = decodeAbiParameters([{ type: "address" }, { type: "bool" }], data); return `${ok ? "Approve" : "Remove"} payment recipient ${r}`; }
    case AdminOp.SetToken: { const [t, ok] = decodeAbiParameters([{ type: "address" }, { type: "bool" }], data); return `${ok ? "Allow" : "Disallow"} token ${t}`; }
    case AdminOp.AddAdmin: return `Add administrator ${addr(data)}`;
    case AdminOp.RemoveAdmin: return `Remove administrator ${addr(data)}`;
    case AdminOp.SetThreshold: return `Set the signature threshold to ${decodeAbiParameters([{ type: "uint8" }], data)[0]}`;
    case AdminOp.SetPolicy: return `Set the policy hash to ${decodeAbiParameters([{ type: "bytes32" }], data)[0]}`;
    case AdminOp.SetGuardian: { const [g, ok] = decodeAbiParameters([{ type: "address" }, { type: "bool" }], data); return `${ok ? "Add" : "Remove"} guardian ${g}`; }
    case AdminOp.Unpause: return "Resume payments (unpause)";
    default: throw new Error(`unknown administrative operation ${op}`);
  }
}

/** The address an AddAdmin or RemoveAdmin change is about. */
export const adminSubject = (op: number, data: Hex): Hex | null => (op === AdminOp.AddAdmin || op === AdminOp.RemoveAdmin ? addr(data) : null);
