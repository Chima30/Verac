import { describe, expect, it } from "vitest";
import { DEPLOYED } from "./contracts";
import { windowIsSufficient } from "./window";

const ok = { live: true, remainingTxs: 3n, remainingBlocks: 100n, allowedTargets: [DEPLOYED.TreasuryVault] };
describe("windowIsSufficient", () => {
  it("accepts a live window scoped to exactly the vault", () => expect(windowIsSufficient(ok)).toBe(true));
  it("rejects a closed, exhausted or nearly expired window", () => {
    expect(windowIsSufficient({ ...ok, live: false })).toBe(false);
    expect(windowIsSufficient({ ...ok, remainingTxs: 0n })).toBe(false);
    expect(windowIsSufficient({ ...ok, remainingBlocks: 2n })).toBe(false);
    expect(windowIsSufficient(ok, 4)).toBe(false);
  });
  it("rejects a window that is not restricted to the vault (an open-ended one admits any contract)", () => {
    expect(windowIsSufficient({ ...ok, allowedTargets: [] })).toBe(false);
    expect(windowIsSufficient({ ...ok, allowedTargets: [DEPLOYED.TreasuryVault, "0x" + "1".repeat(40)] })).toBe(false);
    expect(windowIsSufficient({ ...ok, allowedTargets: ["0x" + "1".repeat(40)] })).toBe(false);
  });
  it("matches the vault address case-insensitively", () => expect(windowIsSufficient({ ...ok, allowedTargets: [DEPLOYED.TreasuryVault.toLowerCase()] })).toBe(true));
});
