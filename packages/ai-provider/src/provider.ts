import { ApiError, GoogleGenAI } from "@google/genai";
import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type AiConfig, type AiConfigResult, loadAiConfig, VERIFIED_FREE_TIER_MODELS } from "./config";
import { AiError } from "./errors";
import { DailyCounters, RateWindow, Semaphore, sleep } from "./limits";
import { findSecret, UNTRUSTED_PREAMBLE } from "./safety";
import { InMemoryUsageRecorder, type UsageRecorder, type UsageStatus } from "./usage";

// ------------------------------------------------------------------ provider boundary
export interface GenerateRequest {
  model: string;
  system: string;
  prompt: string;
  jsonSchema: unknown;
  maxOutputTokens: number;
  signal: AbortSignal;
}
export interface GenerateResponse {
  text: string;
  usage?: { promptTokens?: number; outputTokens?: number; totalTokens?: number };
}
export interface GenerateClient {
  generate(req: GenerateRequest): Promise<GenerateResponse>;
}

/** Adapter over the official `@google/genai` SDK (not the deprecated `@google/generative-ai`). */
export class GeminiClient implements GenerateClient {
  private readonly ai: GoogleGenAI;
  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const res = await this.ai.models.generateContent({
      model: req.model,
      contents: req.prompt,
      config: {
        systemInstruction: req.system,
        responseMimeType: "application/json",
        responseJsonSchema: req.jsonSchema,
        maxOutputTokens: req.maxOutputTokens,
        temperature: 0.2,
        abortSignal: req.signal,
      },
    });
    const u = res.usageMetadata;
    const usage: NonNullable<GenerateResponse["usage"]> = {};
    if (u?.promptTokenCount !== undefined) usage.promptTokens = u.promptTokenCount;
    if (u?.candidatesTokenCount !== undefined) usage.outputTokens = u.candidatesTokenCount;
    if (u?.totalTokenCount !== undefined) usage.totalTokens = u.totalTokenCount;
    return { text: res.text ?? "", usage };
  }
}

// ------------------------------------------------------------------ public API
export interface StructuredRequest<S extends ZodTypeAny> {
  agent: string;
  organizationId?: string;
  userId?: string;
  /** Task-specific instructions written by us (trusted). */
  instructions: string;
  /** Data for the model. Wrap third-party text with `untrustedBlock` first. */
  input: string;
  schema: S;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  usage?: { promptTokens?: number; outputTokens?: number; totalTokens?: number };
  attempts: number;
}

export interface ProviderStatus {
  provider: "gemini";
  state: "ready" | "not_configured" | "invalid_config" | "quota_paused";
  message: string;
  model?: string;
  fallbackModel?: string;
  freeTierOnly?: boolean;
  quotaPausedUntil?: string;
  inFlight: number;
  requestsToday: number;
  dailyLimit?: number;
  /** The API does not report remaining quota, so we only report our own local counter. */
  note: string;
}

export interface ProviderDeps {
  client?: GenerateClient;
  usage?: UsageRecorder;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const MAX_WAIT_FOR_RPM_MS = 20_000;
const DEFAULT_QUOTA_COOLDOWN_MS = 60_000;

export class AiProvider {
  readonly usage: UsageRecorder;
  private readonly cfgResult: AiConfigResult;
  private readonly client?: GenerateClient;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly sem?: Semaphore;
  private readonly rpm?: RateWindow;
  private readonly counters: DailyCounters;
  private quotaPausedUntil = 0;

  constructor(cfg: AiConfigResult, deps: ProviderDeps = {}) {
    this.cfgResult = cfg;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? sleep;
    this.random = deps.random ?? Math.random;
    this.usage = deps.usage ?? new InMemoryUsageRecorder();
    this.counters = new DailyCounters(this.now);
    if (cfg.status === "configured") {
      this.client = deps.client ?? new GeminiClient(cfg.config.apiKey);
      this.sem = new Semaphore(cfg.config.maxConcurrency);
      this.rpm = new RateWindow(cfg.config.requestsPerMinute);
    }
  }

  static fromEnv(env: Record<string, string | undefined>, deps: ProviderDeps = {}): AiProvider {
    return new AiProvider(loadAiConfig(env), deps);
  }

  status(): ProviderStatus {
    const base = { provider: "gemini" as const, inFlight: this.sem?.inFlight ?? 0, requestsToday: this.counters.get("global"), note: "Remaining provider quota is not exposed by the API; counts below are this app's own local counters." };
    const c = this.cfgResult;
    if (c.status === "unconfigured") return { ...base, state: "not_configured", message: c.message };
    if (c.status === "invalid") return { ...base, state: "invalid_config", message: c.message };
    const cfg = c.config;
    const common = { ...base, model: cfg.model, ...(cfg.fallbackModel ? { fallbackModel: cfg.fallbackModel } : {}), freeTierOnly: cfg.freeTierOnly, dailyLimit: cfg.requestsPerDay };
    if (this.now() < this.quotaPausedUntil)
      return { ...common, state: "quota_paused", message: "The provider reported a rate/quota limit. AI jobs are paused and will be retried.", quotaPausedUntil: new Date(this.quotaPausedUntil).toISOString() };
    return { ...common, state: "ready", message: "Gemini is configured. Connectivity is only verified by a real request." };
  }

  /**
   * One structured model call. Output is validated against `schema`; anything that fails validation is an error,
   * never a silent fallback. The caller must treat the result as a recommendation, not authorisation.
   */
  async generateStructured<S extends ZodTypeAny>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
    const c = this.cfgResult;
    if (c.status !== "configured") {
      throw new AiError("NOT_CONFIGURED", c.message);
    }
    const cfg = c.config;
    const started = this.now();

    // ---- local guards (cheap, deterministic, before any network)
    const total = req.instructions.length + req.input.length;
    if (total > cfg.maxInputChars) {
      this.log(req, cfg.model, "rejected_local", started);
      throw new AiError("INPUT_TOO_LARGE", `Input is ${total} characters; the limit is ${cfg.maxInputChars}. Summarise or split it.`);
    }
    const secret = findSecret(req.instructions) ?? findSecret(req.input);
    if (secret) {
      this.log(req, cfg.model, "rejected_local", started);
      throw new AiError("SECRET_DETECTED", `Refusing to send content containing a ${secret} to an external model.`);
    }
    if (this.now() < this.quotaPausedUntil) {
      this.log(req, cfg.model, "quota_exhausted", started);
      throw new AiError("QUOTA_EXHAUSTED", "AI provider is paused after a rate/quota response.", {
        scope: "provider",
        retryAfterMs: this.quotaPausedUntil - this.now(),
      });
    }
    const reserved = this.reserveDaily(req, cfg);
    if (reserved) {
      this.log(req, cfg.model, "quota_exhausted", started);
      throw reserved;
    }

    const jsonSchema = toJsonSchema(req.schema);
    const system = `${UNTRUSTED_PREAMBLE}\n\n${req.instructions}\n\nReply with a single JSON object that matches the provided schema. No prose outside JSON.`;
    let prompt = req.input;
    let attempts = 0;
    let validationFailures = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { text, usage, model } = await this.callWithRetry(cfg, req, { system, prompt, jsonSchema });
      attempts += 1;
      const parsed = tryParse(req.schema, text);
      if (parsed.ok) {
        this.log(req, model, "ok", started, usage);
        return { data: parsed.data, model, ...(usage ? { usage } : {}), attempts };
      }
      this.log(req, model, "invalid_output", started, usage);
      validationFailures += 1;
      if (validationFailures > 1) {
        this.refund(req);
        throw new AiError("INVALID_OUTPUT", `Model output failed validation: ${parsed.error}`);
      }
      // one repair attempt: tell the model what was wrong (error text only, never echo model output as instructions)
      prompt = `${req.input}\n\nYour previous reply was rejected by the validator: ${parsed.error}. Return corrected JSON only.`;
    }
  }

  // ---------------------------------------------------------------- internals
  private reserveDaily(req: { organizationId?: string; userId?: string }, cfg: AiConfig): AiError | undefined {
    const keys: Array<[string, number, "global" | "org" | "user"]> = [["global", cfg.requestsPerDay, "global"]];
    if (req.organizationId) keys.push([`org:${req.organizationId}`, cfg.perOrgRequestsPerDay, "org"]);
    if (req.userId) keys.push([`user:${req.userId}`, cfg.perUserRequestsPerDay, "user"]);
    const taken: string[] = [];
    for (const [k, limit, scope] of keys) {
      if (!this.counters.tryIncrement(k, limit)) {
        taken.forEach((t) => this.counters.decrement(t));
        return new AiError("QUOTA_EXHAUSTED", `Daily AI request limit reached for ${scope}. Queued AI jobs stay pending until the next UTC day or a higher local limit.`, { scope });
      }
      taken.push(k);
    }
    return undefined;
  }

  private refund(req: { organizationId?: string; userId?: string }): void {
    // a call that produced unusable output still consumed provider quota; do not refund. Hook kept for clarity.
    void req;
  }

  private async callWithRetry(
    cfg: AiConfig,
    req: StructuredRequest<ZodTypeAny>,
    body: { system: string; prompt: string; jsonSchema: unknown },
  ): Promise<{ text: string; usage?: GenerateResponse["usage"]; model: string }> {
    let model = cfg.model;
    let triedFallback = false;
    let lastErr: AiError | undefined;

    for (let attempt = 0; attempt <= cfg.maxRetries; attempt += 1) {
      const waitRpm = this.rpm!.reserve(this.now());
      if (waitRpm > MAX_WAIT_FOR_RPM_MS) {
        throw new AiError("RATE_LIMITED", "Local requests-per-minute limit reached; job should be retried shortly.", { scope: "global", retryAfterMs: waitRpm });
      }
      if (waitRpm > 0) await this.sleep(waitRpm);

      const started = this.now();
      try {
        const out = await this.sem!.run(async () => {
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
          try {
            return await this.client!.generate({ model, system: body.system, prompt: body.prompt, jsonSchema: body.jsonSchema, maxOutputTokens: cfg.maxOutputTokens, signal: ac.signal });
          } finally {
            clearTimeout(timer);
          }
        });
        return { ...out, model };
      } catch (e) {
        const err = classify(e);
        lastErr = err;
        const status: UsageStatus = err.code === "RATE_LIMITED" ? "rate_limited" : err.code === "TIMEOUT" ? "timeout" : err.code === "NETWORK" ? "network" : "provider_error";
        this.log(req, model, status, started);

        if (err.code === "RATE_LIMITED") {
          // 429: try the (free) fallback model once, else pause the provider so queued jobs stay recoverable.
          if (cfg.fallbackModel && !triedFallback && cfg.fallbackModel !== model && isAllowedModel(cfg, cfg.fallbackModel)) {
            triedFallback = true;
            model = cfg.fallbackModel;
            continue;
          }
          const cooldown = err.detail.retryAfterMs ?? DEFAULT_QUOTA_COOLDOWN_MS;
          if (attempt >= cfg.maxRetries || cooldown > 15_000) {
            this.quotaPausedUntil = this.now() + Math.max(cooldown, DEFAULT_QUOTA_COOLDOWN_MS);
            throw new AiError("QUOTA_EXHAUSTED", "The provider returned HTTP 429. AI jobs are paused and queued work stays pending.", {
              scope: "provider",
              retryAfterMs: this.quotaPausedUntil - this.now(),
              status: 429,
            });
          }
          await this.sleep(cooldown);
          continue;
        }
        if (err.code === "TIMEOUT" || err.code === "NETWORK" || (err.code === "PROVIDER_ERROR" && (err.detail.status ?? 0) >= 500)) {
          if (attempt >= cfg.maxRetries) throw err;
          await this.sleep(backoff(attempt, this.random));
          continue;
        }
        throw err; // 4xx other than 429: do not retry
      }
    }
    throw lastErr ?? new AiError("PROVIDER_ERROR", "Unknown provider failure");
  }

  private log(req: StructuredRequest<ZodTypeAny>, model: string, status: UsageStatus, started: number, usage?: GenerateResponse["usage"]): void {
    this.usage.record({
      at: new Date(this.now()).toISOString(),
      agent: req.agent,
      ...(req.organizationId ? { organizationId: req.organizationId } : {}),
      model,
      status,
      ...(usage?.promptTokens !== undefined ? { promptTokens: usage.promptTokens } : {}),
      ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
      ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
      latencyMs: Math.max(0, this.now() - started),
    });
  }
}

// ------------------------------------------------------------------ helpers
function isAllowedModel(cfg: AiConfig, model: string): boolean {
  return !cfg.freeTierOnly || VERIFIED_FREE_TIER_MODELS.includes(model) || model === cfg.model || model === cfg.fallbackModel;
}

export function backoff(attempt: number, random: () => number): number {
  const base = Math.min(8000, 500 * 2 ** attempt);
  return Math.round(base / 2 + random() * (base / 2));
}

function toJsonSchema(schema: ZodTypeAny): unknown {
  const js = zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

function tryParse<S extends ZodTypeAny>(schema: S, text: string): { ok: true; data: z.infer<S> } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(stripFence(text));
  } catch {
    return { ok: false, error: "reply was not valid JSON" };
  }
  const r = schema.safeParse(json);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}

function stripFence(t: string): string {
  const m = t.trim().match(/^```(?:json)?\s*([\s\S]*?)```$/);
  return (m ? (m[1] as string) : t).trim();
}

function parseRetryDelayMs(message: string): number | undefined {
  const m = message.match(/retry(?:Delay)?"?[:\s]+"?(\d+(?:\.\d+)?)s/i) ?? message.match(/retry in (\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
}

export function classify(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof ApiError || (typeof e === "object" && e !== null && "status" in e && typeof (e as { status: unknown }).status === "number")) {
    const status = (e as { status: number }).status;
    const msg = e instanceof Error ? e.message : String(e);
    if (status === 429) {
      const retryAfterMs = parseRetryDelayMs(msg);
      return new AiError("RATE_LIMITED", "Provider returned HTTP 429.", { status, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
    }
    return new AiError("PROVIDER_ERROR", `Provider error HTTP ${status}.`, { status });
  }
  const name = e instanceof Error ? e.name : "";
  const msg = e instanceof Error ? e.message : String(e);
  if (name === "AbortError" || /abort|timed? ?out/i.test(msg)) return new AiError("TIMEOUT", "AI request timed out.");
  return new AiError("NETWORK", "Network failure reaching the AI provider.");
}
