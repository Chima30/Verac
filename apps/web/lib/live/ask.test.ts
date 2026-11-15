import { describe, expect, it } from "vitest";
import { checkAskDraft, type AskDraft } from "./ask";

const ADDR = "0x200cad3c9de63d3613a33fc20b1ef31cb4dbf5af";
const draft = (o: Partial<AskDraft> = {}): AskDraft => ({ understood: true, recipient: ADDR, amountQor: "2.5", purpose: "October design work", note: "ok", ...o });
const TEXT = `Pay ${ADDR} 2.5 QOR for October design work`;

describe("checkAskDraft: the model's draft is checked against the user's own words", () => {
  it("accepts a faithful draft", () => {
    const r = checkAskDraft(draft(), TEXT);
    expect(r).toMatchObject({ ok: true, draft: { recipient: ADDR, amountQor: "2.5", purpose: "October design work" } });
  });
  it("accepts the address in a different letter case", () => {
    expect(checkAskDraft(draft({ recipient: ADDR.toUpperCase().replace("0X", "0x") }), TEXT).ok).toBe(true);
  });
  it("discards an address the user never wrote (invented or swapped by injected text)", () => {
    const swapped = "0x" + "9".repeat(40);
    const r = checkAskDraft(draft({ recipient: swapped }), TEXT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/does not appear in what you wrote/);
  });
  it("discards an amount the user never wrote", () => {
    const r = checkAskDraft(draft({ amountQor: "9" }), TEXT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/amount does not appear/);
  });
  it("does not match an amount that is only part of a longer number", () => {
    expect(checkAskDraft(draft({ amountQor: "2" }), TEXT).ok).toBe(false); // "2" is inside "2.5"
    expect(checkAskDraft(draft({ amountQor: "5" }), TEXT).ok).toBe(false);
  });
  it("refuses more than 10 QOR through the same schema the form uses", () => {
    const text = `send ${ADDR} 25 QOR`;
    const r = checkAskDraft(draft({ amountQor: "25" }), text);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/limited to 10 QOR/);
    expect(checkAskDraft(draft({ amountQor: "10" }), `send ${ADDR} 10 QOR`).ok).toBe(true);
    expect(checkAskDraft(draft({ amountQor: "10.000001" }), `send ${ADDR} 10.000001 QOR`).ok).toBe(false);
    expect(checkAskDraft(draft({ amountQor: "0" }), `send ${ADDR} 0 QOR`).ok).toBe(false);
  });
  it("rejects a malformed address even if the user wrote it", () => {
    const bad = "0x1234";
    const r = checkAskDraft(draft({ recipient: bad }), `pay ${bad} 2.5`);
    expect(r.ok).toBe(false);
  });
  it("passes through the model's own 'could not understand'", () => {
    const r = checkAskDraft(draft({ understood: false, note: "No address was given." }), "pay someone");
    expect(r).toEqual({ ok: false, error: "No address was given." });
  });
  it("uses a neutral purpose when the model left it empty", () => {
    const r = checkAskDraft(draft({ purpose: "" }), TEXT);
    expect(r.ok && r.draft.purpose).toBe("Payment request");
  });
});
