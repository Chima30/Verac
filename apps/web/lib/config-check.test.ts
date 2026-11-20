import { describe, expect, it } from "vitest";
import { checkConfig, configWarnings } from "./config-check";

const hex = (bytes: number, c = "a") => "0x" + c.repeat(bytes * 2);
const v2 = { V2_VAULT_ADDRESS: "0xAbd8CB36dd17b7aC35432c4A04f44f2d197504E2", V2_AGENT_EVM_PRIVATE_KEY: hex(32), V2_AGENT_MLDSA_PUBLIC_KEY: hex(2592).slice(2), V2_AGENT_MLDSA_SECRET_KEY: hex(4896).slice(2) };

describe("server settings check", () => {
  it("with nothing set, every group is off and the site is still ok (public, read-only)", () => {
    const r = checkConfig({});
    expect(r.ok).toBe(true);
    expect(r.groups.every((g) => g.state === "off")).toBe(true);
  });
  it("a group that is switched on must be complete", () => {
    const r = checkConfig({ V2_VAULT_ADDRESS: v2.V2_VAULT_ADDRESS });
    expect(r.ok).toBe(false);
    expect(r.groups.find((g) => g.id === "v2")).toMatchObject({ state: "incomplete" });
    expect(r.groups.find((g) => g.id === "v2")!.problems.map((p) => p.name)).toEqual(["V2_AGENT_EVM_PRIVATE_KEY", "V2_AGENT_MLDSA_PUBLIC_KEY", "V2_AGENT_MLDSA_SECRET_KEY"]);
    expect(checkConfig(v2).groups.find((g) => g.id === "v2")!.state).toBe("ready");
  });
  it("catches malformed values: a truncated key, a pasted address with a typo, an http URL", () => {
    const r = checkConfig({ ...v2, V2_AGENT_EVM_PRIVATE_KEY: hex(31), V2_VAULT_ADDRESS: "0xAbd8CB36dd17b7aC35432c4A04f44f2d197504E", NEXT_PUBLIC_SUPABASE_URL: "http://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value" });
    const states = Object.fromEntries(r.groups.flatMap((g) => g.problems.map((p) => [p.name, p.state])));
    expect(states).toEqual({ V2_VAULT_ADDRESS: "malformed", V2_AGENT_EVM_PRIVATE_KEY: "malformed", NEXT_PUBLIC_SUPABASE_URL: "malformed" });
  });
  it("live payments count as on only when LIVE_EXECUTION_ENABLED is true", () => {
    expect(checkConfig({ AGENT_EVM_PRIVATE_KEY: hex(32) }).groups.find((g) => g.id === "live")!.state).toBe("off");
    expect(checkConfig({ LIVE_EXECUTION_ENABLED: "true" }).groups.find((g) => g.id === "live")!.state).toBe("incomplete");
  });
  it("warnings name settings but never include their values", () => {
    const secret = hex(31, "7");
    const w = configWarnings({ ...v2, V2_AGENT_EVM_PRIVATE_KEY: secret });
    expect(w).toEqual(["[config] TreasuryVault V2 (post-quantum approvals): V2_AGENT_EVM_PRIVATE_KEY is malformed"]);
    expect(w.join(" ")).not.toContain("7777");
  });
});
