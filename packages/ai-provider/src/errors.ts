export type AiErrorCode =
  | "NOT_CONFIGURED"
  | "INPUT_TOO_LARGE"
  | "SECRET_DETECTED"
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "PROVIDER_ERROR"
  | "INVALID_OUTPUT";

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly detail: { scope?: "global" | "org" | "user" | "provider"; retryAfterMs?: number; status?: number } = {},
  ) {
    super(message);
    this.name = "AiError";
  }
  /** True when queued work should be kept and retried later instead of failed. */
  get recoverable(): boolean {
    return this.code === "QUOTA_EXHAUSTED" || this.code === "RATE_LIMITED" || this.code === "TIMEOUT" || this.code === "NETWORK";
  }
}
