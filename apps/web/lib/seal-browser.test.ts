import { describe, expect, it } from "vitest";
import { keysFromSeedHex, newSeedHex, openDocument, publicKeysHex, sealDocument, sha256Text } from "./seal-browser";

const reader = () => { const keys = keysFromSeedHex(newSeedHex()); return { keys, pub: publicKeysHex(keys) }; };

describe("vault document sealing", () => {
  it("round-trips for every chosen reader, and the checksum matches the envelope", async () => {
    const a = reader(), b = reader();
    const { text, sha256 } = await sealDocument("doc-1", [a.pub, b.pub], JSON.stringify({ kind: "text", text: "board minutes" }));
    expect(await sha256Text(text)).toBe(sha256);
    for (const r of [a, b]) expect(JSON.parse(openDocument("doc-1", text, r.keys))).toEqual({ kind: "text", text: "board minutes" });
    expect(text).not.toContain("board minutes");
  });
  it("cannot be opened by someone who was not chosen", async () => {
    const a = reader(), outsider = reader();
    const { text } = await sealDocument("doc-2", [a.pub], "secret");
    expect(() => openDocument("doc-2", text, outsider.keys)).toThrow();
  });
  it("is bound to its document id, so the server cannot swap it for another", async () => {
    const a = reader();
    const { text } = await sealDocument("doc-3", [a.pub], "secret");
    expect(() => openDocument("doc-4", text, a.keys)).toThrow();
  });
});
