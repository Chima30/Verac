/**
 * AI provider configuration. Gemini is the only provider; the provider boundary (`GenerateClient`) is kept
 * narrow so another provider can be added later without touching any agent.
 */

/**
 * Free-tier allow-list. It stops a typo or stale env var from silently selecting a paid-only model.
 * Contents are limited to models that actually ANSWERED a real request with our API key on 2026-11-14
 * (one call each, scripts/probe.ts): gemini-3.5-flash-lite (2.7 s) and gemini-3.6-flash (20.7 s). gemini-3.8-flash is
 * listed as free on https://ai.google.dev/gemini-api/docs/pricing but timed out repeatedly that day, so it is allowed
 * but is not the default. These models did NOT work and are excluded: gemini-3.1-flash-lite and gemini-4-hydrogen
 * (timeouts), gemini-3-flash-preview, gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.5-pro (provider errors).
 * Availability changes; re-run the probe before relying on this. Extend with AI_EXTRA_FREE_MODELS after checking pricing.
 */
export const VERIFIED_FREE_TIER_MODELS: readonly string[] = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
];

export interface AiConfig {
  provider: "gemini";
  apiKey: string;
  model: string;
  fallbackModel?: string;
  freeTierOnly: boolean;
  maxConcurrency: number;
  requestsPerMinute: number;
  requestsPerDay: number;
  perOrgRequestsPerDay: number;
  perUserRequestsPerDay: number;
  maxOutputTokens: number;
  maxInputChars: number;
  timeoutMs: number;
  maxRetries: number;
}

export type AiConfigResult =
  | { status: "configured"; config: AiConfig }
  | { status: "unconfigured"; reason: "missing_api_key"; message: string }
  | { status: "invalid"; reason: string; message: string };

const int = (v: string | undefined, d: number, min: number, max: number): number => {
  if (v === undefined || v.trim() === "") return d;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`expected integer in [${min}, ${max}], got "${v}"`);
  return n;
};

export function loadAiConfig(env: Record<string, string | undefined>): AiConfigResult {
  if ((env.AI_PROVIDER ?? "gemini") !== "gemini") {
    return { status: "invalid", reason: "unsupported_provider", message: `AI_PROVIDER "${env.AI_PROVIDER}" is not supported; only "gemini" is implemented.` };
  }
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return {
      status: "unconfigured",
      reason: "missing_api_key",
      message: "GEMINI_API_KEY is not set. AI features are disabled; nothing is simulated. Create a free key at https://aistudio.google.com/apikey.",
    };
  }
  const freeTierOnly = (env.AI_FREE_TIER_ONLY ?? "true").toLowerCase() !== "false";
  const model = env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
  const fallbackModel = env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-3.6-flash";
  const extra = (env.AI_EXTRA_FREE_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = new Set([...VERIFIED_FREE_TIER_MODELS, ...extra]);
  if (freeTierOnly) {
    for (const m of [model, fallbackModel]) {
      if (m && !allowed.has(m)) {
        return {
          status: "invalid",
          reason: "model_not_verified_free",
          message: `Model "${m}" is not on the verified free-tier list and AI_FREE_TIER_ONLY=true. Check https://ai.google.dev/gemini-api/docs/pricing and set AI_EXTRA_FREE_MODELS if it is free.`,
        };
      }
    }
  }
  try {
    const config: AiConfig = {
      provider: "gemini",
      apiKey,
      model,
      ...(fallbackModel ? { fallbackModel } : {}),
      freeTierOnly,
      maxConcurrency: int(env.AI_MAX_CONCURRENCY, 2, 1, 16),
      requestsPerMinute: int(env.AI_REQUESTS_PER_MINUTE, 10, 1, 1000),
      requestsPerDay: int(env.AI_REQUESTS_PER_DAY, 200, 1, 100000),
      perOrgRequestsPerDay: int(env.AI_ORG_REQUESTS_PER_DAY, 120, 1, 100000),
      perUserRequestsPerDay: int(env.AI_USER_REQUESTS_PER_DAY, 60, 1, 100000),
      maxOutputTokens: int(env.AI_MAX_OUTPUT_TOKENS, 2048, 64, 65536),
      maxInputChars: int(env.AI_MAX_INPUT_CHARS, 24000, 500, 1_000_000),
      timeoutMs: int(env.AI_TIMEOUT_MS, 30000, 1000, 300000),
      maxRetries: int(env.AI_MAX_RETRIES, 3, 0, 8),
    };
    return { status: "configured", config };
  } catch (e) {
    return { status: "invalid", reason: "bad_numeric_setting", message: e instanceof Error ? e.message : String(e) };
  }
}
