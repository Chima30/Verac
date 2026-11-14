import { describe as suite, expect, it } from "vitest";
import { actorLabel, describe, moduleLabel, parseFilters } from "./activity";

const ME = "11111111-1111-1111-1111-111111111111";

suite("describe", () => {
  it("explains known actions, with detail where it exists", () => {
    expect(describe({ action: "payment.approve", detail: {} })).toBe("approved a payment request");
    expect(describe({ action: "governance.vote_cast", detail: { choice: "for" } })).toBe("cast a vote: for");
    expect(describe({ action: "vault.uploaded", detail: { readers: 1 } })).toBe("uploaded a sealed document for 1 reader");
    expect(describe({ action: "dispute.resolved", detail: { outcome: "reject_work" } })).toContain("sent back");
  });
  it("shows unknown actions as recorded instead of guessing", () => {
    expect(describe({ action: "something.new", detail: null })).toBe('recorded "something.new"');
  });
});

suite("labels", () => {
  it("names modules, falling back to the raw prefix", () => {
    expect(moduleLabel("grant.awarded")).toBe("Grants");
    expect(moduleLabel("zzz.x")).toBe("zzz");
  });
  it("labels actors without inventing names", () => {
    expect(actorLabel(ME, ME)).toBe("You");
    expect(actorLabel("system", ME)).toBe("System");
    expect(actorLabel("22222222-2222-2222-2222-222222222222", ME)).toBe("Member 22222222");
  });
});

suite("parseFilters", () => {
  it("keeps valid values and drops anything else", () => {
    expect(parseFilters({ module: "grant", before: "120", mine: "1" })).toEqual({ module: "grant", before: 120, mine: true });
    expect(parseFilters({ module: "x'; drop table", before: "1e9", mine: "yes" })).toEqual({ module: undefined, before: undefined, mine: false });
  });
});
