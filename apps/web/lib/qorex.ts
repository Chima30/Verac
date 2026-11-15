/**
 * Small, pure helpers for the QoreX browser wallet. Everything here follows the documented behaviour
 * (docs.qorechain.io, QoreX Integrations): QoreX announces itself over EIP-6963 as `network.qore.qorex`, its EVM provider supports
 * eth_requestAccounts, eth_accounts, eth_chainId and wallet_switchEthereumChain, and it does NOT support eth_sendTransaction.
 */
export const QOREX_RDNS = "network.qore.qorex";
export const DIANA_EVM_CHAIN_ID = 9800;

/** Strict match: only the real QoreX announcement, never window.ethereum and never the mock (`network.qore.qorex.mock`). */
export const isQorexAnnouncement = (detail: { info?: { rdns?: string } } | null | undefined): boolean => detail?.info?.rdns === QOREX_RDNS;

export function parseChainId(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v)) return parseInt(v, 16);
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

export type NetworkVerdict = { ok: true } | { ok: false; reason: string };
export function checkNetwork(chainId: number | null): NetworkVerdict {
  if (chainId === DIANA_EVM_CHAIN_ID) return { ok: true };
  if (chainId === null) return { ok: false, reason: "QoreX did not report which network it is on." };
  return { ok: false, reason: `QoreX is on chain ${chainId}. Verac only works with Diana testnet (${DIANA_EVM_CHAIN_ID}); mainnet is disabled. Switch the network in QoreX.` };
}

/** Turns what QoreX throws (plain Errors whose messages start "QoreX") into one clear sentence for the page. */
export function explainQorexError(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : typeof (err as { message?: unknown })?.message === "string" ? String((err as { message: string }).message) : "";
  if (/rejected|denied|declined/i.test(msg)) return "You declined the request in QoreX. Nothing was connected.";
  if (/locked/i.test(msg)) return "QoreX is locked. Unlock it and try again.";
  if (/unsupported chain/i.test(msg)) return "QoreX is set to a network Verac does not use. Switch QoreX to Diana testnet.";
  if (/not yet supported|not supported/i.test(msg)) return "QoreX does not support that action yet. Verac sends testnet payments from its server instead, so your wallet is used here only to show your account.";
  if (/^QoreX/i.test(msg)) return msg;
  return msg ? `Could not talk to QoreX: ${msg.slice(0, 160)}` : "Could not talk to QoreX.";
}

export const isEvmAddress = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
