import { describe, expect, it } from "vitest";
import { windowed } from "./dashboard";

describe("windowed balance series", () => {
  const pts = [{ date: 0, value: 0 }, { date: 100, value: 20 }, { date: 500, value: 15 }, { date: 1000, value: 9 }];
  it("starts the window at the last real value before it", () => {
    expect(windowed(pts, 600, 1000)).toEqual([{ date: 400, value: 20 }, { date: 500, value: 15 }, { date: 1000, value: 9 }]);
  });
  it("returns the whole series when the window is longer than the history", () => {
    expect(windowed(pts, 5000, 1000)).toEqual(pts);
  });
  it("draws nothing from fewer than two real points", () => {
    expect(windowed([{ date: 1, value: 1 }], 10, 5)).toEqual([]);
  });
});
