import { loadAiConfig } from "@qoreops/ai-provider";
import { QoreReader } from "@qoreops/qorechain";
import deployment from "../../../deployments/diana-testnet.json";

export function reader(): QoreReader {
  return new QoreReader();
}

/** Never returns the key; only whether AI is usable and with which models. */
export function aiStatus() {
  const r = loadAiConfig(process.env);
  if (r.status === "configured") {
    const c = r.config;
    return { status: "configured" as const, model: c.model, fallbackModel: c.fallbackModel ?? null, freeTierOnly: c.freeTierOnly, rpm: c.requestsPerMinute, rpd: c.requestsPerDay, concurrency: c.maxConcurrency };
  }
  return { status: r.status, message: r.message };
}

export interface ChainSnapshot {
  ok: boolean;
  error?: string;
  chainId?: number;
  block?: string;
  evmLimits?: unknown;
  aa?: { enabled: boolean; maxSessionKeys: number; maxSpendingRules: number };
}

export async function chainSnapshot(): Promise<ChainSnapshot> {
  try {
    const q = reader();
    const chainId = await q.assertConnectedToTestnet();
    const [block, limits, aa] = await Promise.allSettled([q.evm.getBlockNumber(), q.evmLimits(), q.abstractAccountConfig()]);
    return {
      ok: true, chainId,
      ...(block.status === "fulfilled" ? { block: block.value.toString() } : {}),
      ...(limits.status === "fulfilled" ? { evmLimits: limits.value } : {}),
      ...(aa.status === "fulfilled" ? { aa: aa.value } : {}),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface ContractRow { name: string; address: string; hasCode: boolean | null; balanceQor: string | null }

/** Live check of each deployed contract: is there bytecode at the address, and what is its native balance. */
export async function contractSnapshot(): Promise<{ rows: ContractRow[]; error?: string }> {
  const entries = Object.entries(deployment.contracts) as Array<[string, { address: string }]>;
  try {
    const q = reader();
    const rows = await Promise.all(entries.map(async ([name, c]) => {
      const address = c.address as `0x${string}`;
      const [code, bal] = await Promise.allSettled([q.evm.getCode({ address }), q.evm.getBalance({ address })]);
      return {
        name, address,
        hasCode: code.status === "fulfilled" ? !!code.value && code.value !== "0x" : null,
        balanceQor: bal.status === "fulfilled" ? (Number(bal.value / 10n ** 12n) / 1e6).toString() : null,
      };
    }));
    return { rows };
  } catch (e) {
    return { rows: entries.map(([name, c]) => ({ name, address: c.address, hasCode: null, balanceQor: null })), error: e instanceof Error ? e.message : String(e) };
  }
}
