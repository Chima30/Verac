import { describe, expect, it } from "vitest";
import { sumWei, wei, weiToQorInput } from "./grants";

describe("grant amounts", () => {
  it("keeps exact text amounts as they are", () => {
    expect(wei("20000000000000000000000")).toBe("20000000000000000000000");
    expect(wei("4000000000000000000000.0")).toBe("4000000000000000000000");
  });
  it("does not crash on numbers PostgREST sends as JSON (2e+22 for a 20,000 QOR budget)", () => {
    expect(wei(2e22)).toBe("20000000000000000000000");
    expect(wei("2e+22")).toBe("20000000000000000000000");
    expect(sumWei([2e22, "4000000000000000000000"])).toBe(24000n * 10n ** 18n);
    expect(weiToQorInput(2e22)).toBe("20000");
  });
});
