import { beforeAll, describe, expect, it } from "vitest";
import { generatePqcKeypair } from "@qorechain/sdk";
import { toHex, type Hex } from "viem";
import { executeV2Payment, paymentFromRow, type V2Chain, type V2Db, type V2Row } from "./v2-executor";
import { paymentDigestV2, signApprovalV2, type V2AdminSig } from "./v2";

const VAULT = "0x00000000000000000000000000000000000000aa" as Hex;
const AGENT = "0x00000000000000000000000000000000000000bb" as Hex;
const A1 = "0x0000000000000000000000000000000000000001" as Hex, A2 = "0x0000000000000000000000000000000000000002" as Hex, OUTSIDER = "0x0000000000000000000000000000000000000009" as Hex;
const keys = new Map<Hex, ReturnType<typeof generatePqcKeypair>>();

function baseRow(): V2Row {
  const r: V2Row = {
    id: "tx-1", organization_id: "org-1", state: "READY", vault_version: 2, vault_address: VAULT, payment_hash: "0x" as Hex,
    token: "0x0000000000000000000000000000000000000000", recipient: "0x200caD3c9De63D3613A33fc20b1ef31CB4dbF5AF", amount: "1250000000000000000",
    purpose_hash: `0x${"11".repeat(32)}` as Hex, policy_version: 1, nonce: "123456789012345678901234567", expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    agent_account: AGENT, required_approvals: 2,
  };
  r.expires_at = new Date(Math.floor(Date.parse(r.expires_at) / 1000) * 1000).toISOString();
  r.payment_hash = paymentDigestV2(9800n, VAULT, AGENT, paymentFromRow(r));
  return r;
}
const sigOf = (who: Hex, digest: Hex): V2AdminSig => ({ signer: who, signature: signApprovalV2(keys.get(who)!.secretKey, digest) });

function harness(over: { row?: Partial<V2Row>; sigs?: (d: Hex) => V2AdminSig[]; chain?: Partial<V2Chain>; admins?: Hex[] } = {}) {
  const row = { ...baseRow(), ...over.row };
  const digest = baseRow().payment_hash;
  const log: string[] = [];
  const admins = new Set((over.admins ?? [A1, A2]).map((a) => a.toLowerCase()));
  const db: V2Db = {
    claim: async () => row,
    signatures: async () => (over.sigs ?? ((d) => [sigOf(A2, d), sigOf(A1, d)]))(digest),
    recordSubmitted: async (_id, h) => { log.push(`submitted ${h}`); },
    recordOutcome: async (_id, ok, _b, reason) => { log.push(`outcome ${ok} ${reason ?? ""}`); },
    recordFailure: async (_id, reason) => { log.push(`failure ${reason}`); },
    alert: async (_o, kind) => { log.push(`alert ${kind}`); },
  };
  const chain: V2Chain = {
    chainId: 9800n,
    vaultDigest: async (v, a, p) => paymentDigestV2(9800n, v, a, p),
    isAdmin: async (_v, who) => admins.has(who.toLowerCase()),
    provenKey: async (who) => keys.get(who)?.publicKey ?? null,
    executed: async () => false,
    simulate: async () => ({ ok: true }),
    receipt: async () => ({ status: "success", block: 42n, executedDigests: [digest] }),
    ...over.chain,
  };
  const agent = {
    address: AGENT,
    send: async (to: Hex, data: Hex) => { log.push(`send ${to} ${data.slice(0, 10)}`); return "0xfeed" as Hex; },
    windows: { ensureOpen: async () => { log.push("window open"); return null; }, close: async () => { log.push("window close"); return null; } },
  };
  return { deps: { db, chain, agent, vault: VAULT }, log, digest };
}

beforeAll(() => { for (const a of [A1, A2, OUTSIDER]) keys.set(a, generatePqcKeypair()); });

describe("executeV2Payment", () => {
  it("relays two valid administrator signatures and confirms only on the vault's event", async () => {
    const h = harness();
    const r = await executeV2Payment(h.deps, "tx-1");
    expect(r).toMatchObject({ state: "CONFIRMED", txHash: "0xfeed", block: 42n, signers: [A1, A2] });
    expect(h.log).toEqual(["window open", expect.stringMatching(/^send 0x0+aa 0x/), "submitted 0xfeed", "outcome true ", "window close"]);
  });

  it("sends nothing when the stored payment no longer matches its digest", async () => {
    const h = harness({ row: { amount: "9000000000000000000" } });
    const r = await executeV2Payment(h.deps, "tx-1");
    expect(r.state).toBe("FAILED");
    expect(h.log.some((l) => l.startsWith("send"))).toBe(false);
    expect(h.log).toContain("alert v2_digest_mismatch");
  });

  it("does not count a signature from someone who is not an administrator on the vault", async () => {
    const h = harness({ sigs: (d) => [sigOf(A1, d), sigOf(OUTSIDER, d)] });
    const r = await executeV2Payment(h.deps, "tx-1");
    expect(r).toMatchObject({ state: "FAILED", reason: expect.stringMatching(/Only 1 of the 2/) });
    expect(h.log.some((l) => l.startsWith("send"))).toBe(false);
  });

  it("does not count a forged or wrong-payment signature (as a compromised server might store)", async () => {
    const forged = (d: Hex): V2AdminSig[] => [sigOf(A1, d), { signer: A2, signature: toHex(crypto.getRandomValues(new Uint8Array(4627))) }];
    const r1 = await executeV2Payment(harness({ sigs: forged }).deps, "tx-1");
    expect(r1.state).toBe("FAILED");
    const otherPayment = (): V2AdminSig[] => { const other = paymentDigestV2(9800n, VAULT, AGENT, { ...paymentFromRow(baseRow()), amount: 1n }); return [sigOf(A1, other), sigOf(A2, other)]; };
    const r2 = await executeV2Payment(harness({ sigs: otherPayment }).deps, "tx-1");
    expect(r2.state).toBe("FAILED");
  });

  it("stops when the vault would reject, or already executed this digest, or is a different vault", async () => {
    const sim = harness({ chain: { simulate: async () => ({ ok: false, error: "RecipientNotApproved()" }) } });
    expect(await executeV2Payment(sim.deps, "tx-1")).toMatchObject({ state: "FAILED", reason: expect.stringMatching(/RecipientNotApproved/) });
    expect(sim.log.some((l) => l.startsWith("send"))).toBe(false);
    const done = harness({ chain: { executed: async () => true } });
    expect(await executeV2Payment(done.deps, "tx-1")).toMatchObject({ state: "FAILED", reason: expect.stringMatching(/already been executed/) });
    const other = harness({ row: { vault_address: "0x00000000000000000000000000000000000000cc" } });
    expect(await executeV2Payment(other.deps, "tx-1")).toMatchObject({ state: "FAILED", reason: expect.stringMatching(/different vault/) });
  });

  it("does not report a success without the vault's PaymentExecuted event for this digest", async () => {
    const h = harness({ chain: { receipt: async () => ({ status: "success", block: 7n, executedDigests: [] }) } });
    const r = await executeV2Payment(h.deps, "tx-1");
    expect(r).toMatchObject({ state: "FAILED", txHash: "0xfeed" });
    expect(h.log).toContain("window close");
  });
});
