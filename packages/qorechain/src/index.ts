import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import {
  evmToQor,
  fetchEvmLimits,
  fetchEvmWindow,
  fetchKemKey,
  fetchPqcStatus,
  fetchSpendingRules,
  fetchAuthenticators,
} from "@qorechain/sdk";
import { QORE_NETWORK, assertTestnet } from "@qoreops/shared-types";

/**
 * Read-only access to QoreChain Diana testnet. Everything here is a query; nothing signs or sends.
 * Mainnet is refused: the EVM chain id is checked against the node before any data is returned.
 */

export interface QoreEndpoints {
  rest: string;
  rpc: string;
  evmRpc: string;
  explorer: string;
}

export function endpointsFromEnv(env: Record<string, string | undefined> = process.env): QoreEndpoints {
  const chainId = Number(env.NEXT_PUBLIC_QORE_EVM_CHAIN_ID ?? QORE_NETWORK.evmChainId);
  assertTestnet({ nativeChainId: env.NEXT_PUBLIC_QORE_NATIVE_CHAIN_ID ?? QORE_NETWORK.nativeChainId, evmChainId: chainId });
  return {
    rest: env.NEXT_PUBLIC_QORE_REST ?? QORE_NETWORK.rest,
    rpc: env.NEXT_PUBLIC_QORE_RPC ?? QORE_NETWORK.rpc,
    evmRpc: env.NEXT_PUBLIC_QORE_EVM_RPC ?? QORE_NETWORK.evmRpc,
    explorer: env.NEXT_PUBLIC_QORE_EXPLORER ?? QORE_NETWORK.explorer,
  };
}

export const qoreDianaTestnet = defineChain({
  id: QORE_NETWORK.evmChainId,
  name: "QoreChain Diana Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [QORE_NETWORK.evmRpc] } },
});

export class QoreReader {
  readonly evm: PublicClient;
  constructor(readonly endpoints: QoreEndpoints = endpointsFromEnv()) {
    this.evm = createPublicClient({ chain: qoreDianaTestnet, transport: http(endpoints.evmRpc, { timeout: 20_000 }) });
  }

  /** Throws if the EVM node is not chain 9800. Call once at startup. */
  async assertConnectedToTestnet(): Promise<number> {
    const id = await this.evm.getChainId();
    assertTestnet({ evmChainId: id });
    return id;
  }

  /** EVM-side balance in wei (18 decimals). This is the REAL balance read from the node. */
  evmBalance(address: `0x${string}`): Promise<bigint> {
    return this.evm.getBalance({ address });
  }

  /** The Native/EVM address pairing used by REST routes. */
  toNativeAddress(evmAddress: string): string {
    return evmToQor(evmAddress);
  }

  /** Current EVM authorisation window for an account (REST). `found: false` accounts return live=false. */
  evmWindow(qorAddress: string) {
    return fetchEvmWindow({ rest: this.endpoints.rest, address: qorAddress });
  }
  pqcStatus(qorAddress: string) {
    return fetchPqcStatus({ rest: this.endpoints.rest, address: qorAddress });
  }
  kemKey(address: string) {
    return fetchKemKey({ rest: this.endpoints.rest, address });
  }
  spendingRules(qorAddress: string) {
    return fetchSpendingRules({ rest: this.endpoints.rest, address: qorAddress });
  }
  authenticators(qorAddress: string) {
    return fetchAuthenticators({ rest: this.endpoints.rest, address: qorAddress });
  }
  evmLimits() {
    return fetchEvmLimits({ rest: this.endpoints.rest });
  }

  /** Whether account abstraction (delegated keys) is enabled. Must be checked before building any AA feature. */
  async abstractAccountConfig(): Promise<{ enabled: boolean; maxSessionKeys: number; maxSpendingRules: number }> {
    const res = await fetch(`${this.endpoints.rest}/qorechain/abstractaccount/v1/config`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`abstractaccount config HTTP ${res.status}`);
    const j = (await res.json()) as { config?: { enabled?: boolean; max_session_keys?: number; max_spending_rules?: number } };
    return { enabled: j.config?.enabled === true, maxSessionKeys: j.config?.max_session_keys ?? 0, maxSpendingRules: j.config?.max_spending_rules ?? 0 };
  }

  txUrl(hash: string): string {
    return `${this.endpoints.explorer.replace(/\/$/, "")}/tx/${hash}`;
  }
}
export * from "./contracts";
export * from "./execution";
export * from "./signer";
export * from "./window";
