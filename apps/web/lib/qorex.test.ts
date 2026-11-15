import { describe, expect, it } from "vitest";
import { checkNetwork, explainQorexError, isEvmAddress, isQorexAnnouncement, parseChainId } from "./qorex";

describe("QoreX helpers", () => {
  it("selects only the real QoreX announcement", () => {
    expect(isQorexAnnouncement({ info: { rdns: "network.qore.qorex" } })).toBe(true);
    expect(isQorexAnnouncement({ info: { rdns: "network.qore.qorex.mock" } })).toBe(false);
    expect(isQorexAnnouncement({ info: { rdns: "io.metamask" } })).toBe(false);
    expect(isQorexAnnouncement(undefined)).toBe(false);
  });
  it("parses chain ids from hex, decimal and numbers", () => {
    expect(parseChainId("0x2648")).toBe(9800);
    expect(parseChainId("9800")).toBe(9800);
    expect(parseChainId(9800)).toBe(9800);
    expect(parseChainId("nope")).toBeNull();
    expect(parseChainId(undefined)).toBeNull();
  });
  it("accepts only Diana testnet", () => {
    expect(checkNetwork(9800)).toEqual({ ok: true });
    const mainnet = checkNetwork(9801);
    expect(mainnet.ok).toBe(false);
    expect(mainnet.ok === false && mainnet.reason).toMatch(/mainnet is disabled/);
    expect(checkNetwork(null).ok).toBe(false);
  });
  it("explains the documented QoreX failures in plain words", () => {
    expect(explainQorexError(new Error("QoreX: connection rejected"))).toMatch(/declined/);
    expect(explainQorexError(new Error("QoreX: wallet is locked"))).toMatch(/locked/);
    expect(explainQorexError(new Error("QoreX: unsupported chain 1"))).toMatch(/Diana testnet/);
    expect(explainQorexError(new Error("QoreX: EVM method eth_sendTransaction not yet supported"))).toMatch(/server instead/);
    expect(explainQorexError({ message: "boom" })).toMatch(/Could not talk to QoreX: boom/);
    expect(explainQorexError(undefined)).toBe("Could not talk to QoreX.");
  });
  it("validates addresses", () => {
    expect(isEvmAddress("0x" + "a".repeat(40))).toBe(true);
    expect(isEvmAddress("0x123")).toBe(false);
    expect(isEvmAddress(null)).toBe(false);
  });
});
