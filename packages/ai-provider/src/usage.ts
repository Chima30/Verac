/**
 * Usage tracking. Records metadata ONLY: never prompts, documents or model output.
 */
export type UsageStatus = "ok" | "invalid_output" | "rate_limited" | "quota_exhausted" | "timeout" | "network" | "provider_error" | "rejected_local";

export interface UsageRecord {
  at: string; // ISO time
  agent: string;
  organizationId?: string;
  model: string;
  status: UsageStatus;
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs: number;
}

export interface UsageRecorder {
  record(r: UsageRecord): void;
}

export interface UsageSummary {
  total: number;
  ok: number;
  failed: number;
  rateLimited: number;
  tokens: { prompt: number; output: number; total: number; reportedBy: number };
  byAgent: Record<string, { requests: number; failed: number; totalTokens: number }>;
  byModel: Record<string, number>;
}

export class InMemoryUsageRecorder implements UsageRecorder {
  private rows: UsageRecord[] = [];
  constructor(private readonly cap = 5000) {}
  record(r: UsageRecord): void {
    this.rows.push(r);
    if (this.rows.length > this.cap) this.rows.shift();
  }
  all(): readonly UsageRecord[] {
    return this.rows;
  }
  summary(): UsageSummary {
    const s: UsageSummary = {
      total: 0,
      ok: 0,
      failed: 0,
      rateLimited: 0,
      tokens: { prompt: 0, output: 0, total: 0, reportedBy: 0 },
      byAgent: {},
      byModel: {},
    };
    for (const r of this.rows) {
      if (r.status === "rejected_local") continue; // never reached the provider
      s.total += 1;
      if (r.status === "ok") s.ok += 1;
      else s.failed += 1;
      if (r.status === "rate_limited" || r.status === "quota_exhausted") s.rateLimited += 1;
      const a = (s.byAgent[r.agent] ??= { requests: 0, failed: 0, totalTokens: 0 });
      a.requests += 1;
      if (r.status !== "ok") a.failed += 1;
      s.byModel[r.model] = (s.byModel[r.model] ?? 0) + 1;
      if (r.totalTokens !== undefined) {
        s.tokens.reportedBy += 1;
        s.tokens.total += r.totalTokens;
        s.tokens.prompt += r.promptTokens ?? 0;
        s.tokens.output += r.outputTokens ?? 0;
        a.totalTokens += r.totalTokens;
      }
    }
    return s;
  }
}
