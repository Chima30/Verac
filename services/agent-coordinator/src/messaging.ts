import { createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AgentIdSchema, type AgentId } from "@qoreops/shared-types";
import { AGENTS } from "./agents";

/**
 * Authenticated, replay-protected agent messages.
 *
 * Each agent has its own HMAC key derived (HKDF-SHA256) from a root secret that only the coordinator process
 * holds, so one agent cannot sign as another. Payloads are JSON validated against a per-kind schema and carry
 * data only: there is no field that can hold code or a raw transaction.
 *
 * Note: HMAC gives authentication inside one trust domain (the coordinator). It is not a post-quantum signature
 * and is not presented as one. QoreChain's post-quantum guarantees apply to on-chain authorisation.
 */

export const MESSAGE_KINDS = [
  "task.handoff", // "please look at X"
  "finding.report", // analysis result (data only)
  "payment.proposal.ready", // references an operation id; the pipeline decides everything
  "security.alert",
  "approval.requested",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

const Ref = z.string().min(1).max(128);
/** sha256 hex of the full structured finding, so a short report is bound to the exact findings stored with the task. */
const Digest = z.string().regex(/^[0-9a-f]{64}$/);
export const PAYLOAD_SCHEMAS: Record<MessageKind, z.ZodTypeAny> = {
  "task.handoff": z.object({ taskId: z.string().uuid(), subject: Ref, note: z.string().max(500).optional() }).strict(),
  "finding.report": z.object({ taskId: z.string().uuid(), subject: Ref, severity: z.enum(["info", "low", "medium", "high"]), summary: z.string().max(1000), evidenceRefs: z.array(Ref).max(20), digest: Digest.optional() }).strict(),
  "payment.proposal.ready": z.object({ taskId: z.string().uuid(), operationId: z.string().uuid() }).strict(),
  "security.alert": z.object({ taskId: z.string().uuid().optional(), subject: Ref, severity: z.enum(["low", "medium", "high", "critical"]), summary: z.string().max(1000) }).strict(),
  "approval.requested": z.object({ taskId: z.string().uuid(), operationId: z.string().uuid(), requiredApprovals: z.number().int().min(1).max(10) }).strict(),
};

/** The coordinator is a party too: it hands work to agents and receives their reports. */
export const COORDINATOR = "Coordinator" as const;
export type Party = AgentId | typeof COORDINATOR;
const PartySchema = z.union([AgentIdSchema, z.literal(COORDINATOR)]);

export const EnvelopeSchema = z
  .object({
    id: z.string().uuid(),
    from: PartySchema,
    to: PartySchema,
    organizationId: z.string().uuid(),
    taskId: z.string().uuid(),
    kind: z.enum(MESSAGE_KINDS),
    issuedAt: z.number().int().positive(), // unix ms
    expiresAt: z.number().int().positive(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/),
    payload: z.unknown(),
    sig: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type Envelope = z.infer<typeof EnvelopeSchema>;

export type VerifyFailure = "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" | "NOT_YET_VALID" | "REPLAY" | "SENDER_NOT_ALLOWED" | "BAD_PAYLOAD" | "WRONG_RECIPIENT" | "WRONG_ORGANIZATION" | "WRONG_TASK";

/** What the receiver expects. Anything given here must match exactly, or the message is rejected. */
export interface Expectation { recipient?: Party; organizationId?: string; taskId?: string }

/** Where seen nonces live. The default is memory; the workflow also persists every envelope under a unique (organisation, nonce) key. */
export interface NonceStore { seen(key: string): boolean; remember(key: string, expiresAt: number): void; gc(now: number): void }
export class MemoryNonceStore implements NonceStore {
  private m = new Map<string, number>();
  seen(k: string) { return this.m.has(k); }
  remember(k: string, exp: number) { this.m.set(k, exp); }
  gc(now: number) { for (const [k, exp] of this.m) if (exp + MAX_SKEW_MS < now) this.m.delete(k); }
}

/** Who may send to whom. The coordinator may address any agent and every agent may report to it; agent-to-agent follows the registry. */
export function mayMessage(from: Party, to: Party): boolean {
  if (from === to) return false;
  if (from === COORDINATOR || to === COORDINATOR) return true;
  return (AGENTS[from].mayMessage as readonly AgentId[]).includes(to);
}
export class MessageRejected extends Error {
  constructor(public readonly reason: VerifyFailure, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "MessageRejected";
  }
}

const MAX_TTL_MS = 5 * 60_000;
const MAX_SKEW_MS = 30_000;

export class MessageBus {
  private readonly keys = new Map<Party, Buffer>();
  private readonly nonces: NonceStore;

  constructor(
    rootSecretHex: string,
    private readonly now: () => number = Date.now,
    nonces: NonceStore = new MemoryNonceStore(),
  ) {
    if (!/^[0-9a-fA-F]{64,}$/.test(rootSecretHex)) throw new Error("AGENT_MESSAGE_ROOT_SECRET must be at least 32 bytes of hex");
    const root = Buffer.from(rootSecretHex, "hex");
    for (const id of [...(Object.keys(AGENTS) as AgentId[]), COORDINATOR] as Party[]) {
      this.keys.set(id, Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), `qoreops-agent-msg-v1|${id}`, 32)));
    }
    this.nonces = nonces;
  }

  /** Only the coordinator calls this, on behalf of `from`. */
  sign(input: { from: Party; to: Party; organizationId: string; taskId: string; kind: MessageKind; payload: unknown; ttlMs?: number; id?: string }): Envelope {
    const schema = PAYLOAD_SCHEMAS[input.kind];
    const payload = schema.parse(input.payload);
    const issuedAt = this.now();
    const ttl = Math.min(input.ttlMs ?? 60_000, MAX_TTL_MS);
    const unsigned = {
      id: input.id ?? randomUUID(),
      from: input.from,
      to: input.to,
      organizationId: input.organizationId,
      taskId: input.taskId,
      kind: input.kind,
      issuedAt,
      expiresAt: issuedAt + ttl,
      nonce: randomBytes(16).toString("hex"),
      payload,
    };
    return { ...unsigned, sig: this.mac(unsigned.from, unsigned) };
  }

  /** Verifies and consumes the message (a valid envelope verifies exactly once). */
  verify(raw: unknown, expect?: Party | Expectation): Envelope & { payload: unknown } {
    const want: Expectation = typeof expect === "string" ? { recipient: expect } : expect ?? {};
    const parsed = EnvelopeSchema.safeParse(raw);
    if (!parsed.success) throw new MessageRejected("MALFORMED", parsed.error.issues[0]?.message);
    const env = parsed.data;
    const { sig, ...unsigned } = env;

    const expected = this.mac(env.from, unsigned);
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new MessageRejected("BAD_SIGNATURE");

    const t = this.now();
    if (env.issuedAt - t > MAX_SKEW_MS) throw new MessageRejected("NOT_YET_VALID");
    if (t > env.expiresAt) throw new MessageRejected("EXPIRED");
    if (env.expiresAt - env.issuedAt > MAX_TTL_MS) throw new MessageRejected("MALFORMED", "ttl too long");
    if (want.recipient && env.to !== want.recipient) throw new MessageRejected("WRONG_RECIPIENT");
    if (want.organizationId && env.organizationId !== want.organizationId) throw new MessageRejected("WRONG_ORGANIZATION");
    if (want.taskId && env.taskId !== want.taskId) throw new MessageRejected("WRONG_TASK");

    if (!mayMessage(env.from, env.to)) throw new MessageRejected("SENDER_NOT_ALLOWED", `${env.from} may not message ${env.to}`);
    const payloadCheck = PAYLOAD_SCHEMAS[env.kind].safeParse(env.payload);
    if (!payloadCheck.success) throw new MessageRejected("BAD_PAYLOAD", payloadCheck.error.issues[0]?.message);
    // A payload that names a task must name the envelope's task: a report cannot be moved to another task.
    const pt = (payloadCheck.data as { taskId?: string }).taskId;
    if (pt && pt !== env.taskId) throw new MessageRejected("WRONG_TASK", "payload task differs from envelope task");

    this.nonces.gc(t);
    const key = `${env.organizationId}|${env.nonce}`;
    if (this.nonces.seen(key)) throw new MessageRejected("REPLAY");
    this.nonces.remember(key, env.expiresAt);
    return { ...env, payload: payloadCheck.data };
  }

  private mac(from: Party, unsigned: Omit<Envelope, "sig">): string {
    const key = this.keys.get(from);
    if (!key) throw new Error(`unknown agent ${from}`);
    return createHmac("sha256", key).update(canonical(unsigned)).digest("hex");
  }
}

/** Deterministic JSON with sorted keys so both sides MAC identical bytes. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
