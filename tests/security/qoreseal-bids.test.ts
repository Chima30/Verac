import { describe, expect, it } from "vitest";
import { envelopeFromText, envelopeToText, open, recipientOf, seal, sealKeysFromSeed } from "@qorechain/qoreseal";

/**
 * The real QoreSeal library, used the way Procurement uses it: a bid sealed to several reviewers, bound to one tender.
 * This tests our usage; it is not an audit of the library (its spec is a pre-1.0 draft pending external review).
 */
const CHAIN = "qorechain-diana";
const enc = new TextEncoder();
const dec = new TextDecoder();
const seedOf = (n: number) => new Uint8Array(32).fill(n);
const reviewer1 = sealKeysFromSeed(seedOf(1));
const reviewer2 = sealKeysFromSeed(seedOf(2));
const outsider = sealKeysFromSeed(seedOf(3));
const bid = JSON.stringify({ amountQor: 750, deliveryDays: 30, approach: "secret approach" });

const sealBid = (tender: string) => seal({ chainId: CHAIN, purpose: `bid:${tender}`, aad: enc.encode(tender), recipients: [recipientOf(reviewer1), recipientOf(reviewer2)], plaintext: enc.encode(bid) });

describe("sealed bids", () => {
  it("every reviewer can open it from the text form stored in the database", () => {
    const text = envelopeToText(sealBid("T1"));
    expect(text).not.toContain("secret approach");
    for (const keys of [reviewer1, reviewer2]) {
      expect(dec.decode(open({ chainId: CHAIN, purpose: "bid:T1", aad: enc.encode("T1"), envelope: envelopeFromText(text), keys }))).toBe(bid);
    }
  });

  it("keys regenerate from the 32-byte seed alone (what a reviewer backs up)", () => {
    const again = sealKeysFromSeed(seedOf(1));
    expect(Buffer.from(again.mlkemPublicKey).equals(Buffer.from(reviewer1.mlkemPublicKey))).toBe(true);
    expect(dec.decode(open({ chainId: CHAIN, purpose: "bid:T1", aad: enc.encode("T1"), envelope: sealBid("T1"), keys: again }))).toBe(bid);
  });

  it("a non-recipient cannot open it", () => {
    expect(() => open({ chainId: CHAIN, purpose: "bid:T1", aad: enc.encode("T1"), envelope: sealBid("T1"), keys: outsider })).toThrow();
  });

  it("is bound to its tender: it cannot be replayed under another tender", () => {
    const env = sealBid("T1");
    expect(() => open({ chainId: CHAIN, purpose: "bid:T2", aad: enc.encode("T2"), envelope: env, keys: reviewer1 })).toThrow();
    expect(() => open({ chainId: CHAIN, purpose: "bid:T1", aad: enc.encode("T2"), envelope: env, keys: reviewer1 })).toThrow();
  });

  it("is bound to the chain", () => {
    expect(() => open({ chainId: "qorechain-other", purpose: "bid:T1", aad: enc.encode("T1"), envelope: sealBid("T1"), keys: reviewer1 })).toThrow();
  });

  it("tampering with the ciphertext is detected", () => {
    const env = sealBid("T1");
    const bad = new Uint8Array(env); bad[bad.length - 5] ^= 0xff;
    expect(() => open({ chainId: CHAIN, purpose: "bid:T1", aad: enc.encode("T1"), envelope: bad, keys: reviewer1 })).toThrow();
  });
});
