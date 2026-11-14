import { describe, expect, it } from "vitest";
import { assessPosture, type AccountFacts, type Facts } from "./threats";

const E18 = 10n ** 18n;
const acct = (o: Partial<AccountFacts> = {}): AccountFacts => ({ label: "Vault owner", address: "0x" + "1".repeat(40), nativeAddress: "qor1x", errors: [], pqcRegistered: true, possessionProven: true, windowLive: false, kemRegistered: true, hasAccountSpendingRules: true, isContract: true, ...o });
const facts = (a: AccountFacts[], v: Partial<Facts["vault"]> = {}): Facts => ({ accounts: a, vault: { approverCount: 2, balance: 100n * E18, rules: [], ...v }, nowSeconds: 1_800_000_000 });
const ids = (f: Facts, sev?: string) => assessPosture(f).filter((x) => !sev || x.severity === sev).map((x) => x.id);

describe("posture findings", () => {
  it("a well-configured setup has no high or medium findings", () => {
    const r = assessPosture(facts([acct()]));
    expect(r.filter((x) => x.severity === "high" || x.severity === "medium")).toEqual([]);
    expect(r.map((x) => x.id)).toEqual(expect.arrayContaining(["pqc-ok", "window-closed"]));
  });
  it("flags a missing PQC key as high and an unproven one as medium", () => {
    expect(ids(facts([acct({ pqcRegistered: false })]), "high")).toEqual(["no-pqc"]);
    expect(ids(facts([acct({ possessionProven: false })]), "medium")).toEqual(["pqc-no-proof"]);
  });
  it("flags an open EVM window with what remains", () => {
    const r = assessPosture(facts([acct({ windowLive: true, windowRemainingBlocks: 500n, windowRemainingTxs: 10n, windowRemainingValue: 3n * E18 })]));
    const w = r.find((x) => x.id === "window-open")!;
    expect(w.severity).toBe("medium");
    expect(w.detail).toContain("500 blocks");
    expect(w.detail).toContain("3 QOR");
  });
  it("does not claim anything when the chain could not be read", () => {
    const r = assessPosture(facts([acct({ pqcRegistered: undefined, windowLive: undefined, errors: ["PQC status unavailable"] })]));
    expect(r.map((x) => x.id)).toContain("read-error");
    expect(r.map((x) => x.id)).not.toContain("no-pqc");
    expect(r.map((x) => x.id)).not.toContain("window-closed");
  });
  it("flags a single-key owner, a single approver and a paused vault", () => {
    const r = ids(facts([acct({ isContract: false })], { approverCount: 1, paused: true }));
    expect(r).toEqual(expect.arrayContaining(["owner-single-key", "one-approver", "vault-paused"]));
  });
  it("flags an agent whose per-payment limit is over a quarter of the balance, and expired permissions", () => {
    const rules = [{ agent: "0x" + "2".repeat(40), active: true, perTxCap: 30n * E18, validUntil: 1_000 }, { agent: "0x" + "3".repeat(40), active: false, perTxCap: 90n * E18, validUntil: 0 }];
    const r = ids(facts([acct()], { rules }));
    expect(r).toContain("cap-vs-balance");
    expect(r).toContain("rule-expired");
    expect(r.filter((x) => x === "cap-vs-balance").length).toBe(1); // the revoked agent is ignored
  });
  it("orders findings from most to least serious", () => {
    const sev = assessPosture(facts([acct({ pqcRegistered: false, kemRegistered: false })], { approverCount: 1 })).map((x) => x.severity);
    const rank = { high: 0, medium: 1, low: 2, ok: 3 } as const;
    expect(sev).toEqual([...sev].sort((a, b) => rank[a] - rank[b]));
  });
});
