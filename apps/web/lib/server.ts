import { loadAiConfig } from "@qoreops/ai-provider";
import { QoreReader } from "@qoreops/qorechain";

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
