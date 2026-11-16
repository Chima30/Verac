// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createQorexMock } from "@qorechain/qorex-wallet-mock";
import { DIANA_EVM_CHAIN_ID, checkNetwork, explainQorexError, isEvmAddress, isQorexAnnouncement, parseChainId } from "./qorex";

/**
 * Exercises Verac's QoreX helpers against the QoreChain Association's own test double of the wallet (@qorechain/qorex-wallet-mock),
 * which injects the same `window.qorex` objects QoreX injects and refuses what QoreX refuses today. Nothing here touches a network.
 */
type EvmProvider = { request(a: { method: string; params?: unknown[] }): Promise<unknown> };
const evm = () => (window as unknown as { qorex: { evm: EvmProvider } }).qorex.evm;

afterEach(() => { delete (window as unknown as { qorex?: unknown }).qorex; });

describe("Verac wallet helpers against the QoreX wallet mock (profile: current, i.e. QoreX today)", () => {
  it("connects and returns a valid EVM address on Diana testnet", async () => {
    createQorexMock({ profile: "current" }).install(window);
    const accounts = (await evm().request({ method: "eth_requestAccounts" })) as unknown[];
    expect(accounts).toHaveLength(1);
    expect(isEvmAddress(accounts[0])).toBe(true);
    const chain = parseChainId(await evm().request({ method: "eth_chainId" }));
    expect(chain).toBe(DIANA_EVM_CHAIN_ID);
    expect(checkNetwork(chain)).toEqual({ ok: true });
  });

  it("the mock announces itself as the mock, so strict QoreX detection never mistakes it for the real wallet", async () => {
    createQorexMock({ profile: "current" }).install(window);
    const seen: { info?: { rdns?: string } }[] = [];
    window.addEventListener("eip6963:announceProvider", (e) => seen.push((e as CustomEvent).detail));
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((d) => !isQorexAnnouncement(d))).toBe(true);
    expect(seen.some((d) => d.info?.rdns === "network.qore.qorex.mock")).toBe(true);
  });

  it("a user who declines in the wallet gets a plain sentence and nothing is connected", async () => {
    const mock = createQorexMock({ profile: "current", autoApprove: false });
    mock.install(window);
    const pending = evm().request({ method: "eth_requestAccounts" });
    mock.rejectNext();
    const err = await pending.then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect(explainQorexError(err)).toBe("You declined the request in QoreX. Nothing was connected.");
  });

  it("QoreX cannot send EVM transactions today, which is why Verac signs payments on the server; the error is explained, not shown raw", async () => {
    createQorexMock({ profile: "current" }).install(window);
    await evm().request({ method: "eth_requestAccounts" });
    const err = await evm().request({ method: "eth_sendTransaction", params: [{ to: "0x" + "1".repeat(40), value: "0x1" }] }).then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect(explainQorexError(err)).toMatch(/does not support that action yet/);
  });

  it("switching to another network is refused and the helper says Verac needs Diana testnet", async () => {
    createQorexMock({ profile: "current" }).install(window);
    const err = await evm().request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }).then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect(checkNetwork(1).ok).toBe(false);
  });
});
