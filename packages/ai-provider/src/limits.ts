/** Small, dependency-free primitives for free-tier operation. Clock is injectable for deterministic tests. */

export class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((res) => this.waiters.push(res));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
  get inFlight(): number {
    return this.active;
  }
}

/** Sliding-window requests-per-minute gate. `reserve` returns how long to wait before sending. */
export class RateWindow {
  private stamps: number[] = [];
  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}
  reserve(now: number): number {
    this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
    if (this.stamps.length < this.limit) {
      this.stamps.push(now);
      return 0;
    }
    const wait = (this.stamps[0] as number) + this.windowMs - now;
    this.stamps.push(now + wait);
    return wait;
  }
}

/** Per-UTC-day counters keyed by scope+id. In-memory; swap for a DB-backed store in the worker. */
export class DailyCounters {
  private counts = new Map<string, number>();
  private day = "";
  constructor(private readonly now: () => number) {}

  private roll(): void {
    const d = new Date(this.now()).toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.counts.clear();
    }
  }
  get(key: string): number {
    this.roll();
    return this.counts.get(key) ?? 0;
  }
  /** Increments only when under the limit. Returns false if the limit would be exceeded. */
  tryIncrement(key: string, limit: number): boolean {
    this.roll();
    const n = this.counts.get(key) ?? 0;
    if (n >= limit) return false;
    this.counts.set(key, n + 1);
    return true;
  }
  decrement(key: string): void {
    const n = this.counts.get(key) ?? 0;
    if (n > 0) this.counts.set(key, n - 1);
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
