import { describe, expect, it } from "vitest";
import { flowsFrom, receivablesByMonth } from "./charts";

const day = (d: string) => Date.parse(`${d}T12:00:00Z`);

describe("vault flows", () => {
  it("turns each balance step into an inflow or outflow on its day", () => {
    const pts = [
      { date: day("2026-11-01"), value: 0 },   // reconstructed start
      { date: day("2026-11-14"), value: 20 },  // deposit 20
      { date: day("2026-11-14"), value: 15 },  // payment 5
      { date: day("2026-11-15"), value: 70 },  // deposit 55
      { date: day("2026-11-15"), value: 10 },  // escrow 60
      { date: day("2026-11-16"), value: 10 },  // now anchor, no event
    ];
    const f = flowsFrom(pts);
    expect(f.map((b) => [b.key, b.inflow, b.outflow])).toEqual([["2026-11-14", 20, 5], ["2026-11-15", 55, 60]]);
  });
  it("draws nothing without two real points", () => {
    expect(flowsFrom([{ date: 1, value: 3 }])).toEqual([]);
  });
});

describe("receivables by due month", () => {
  it("splits paid from outstanding and leaves out void records", () => {
    const rows = [
      { due_date: "2026-10-03", amount: "5000000000000000000", status: "paid" },
      { due_date: "2026-10-20", amount: "2000000000000000000", status: "issued" },
      { due_date: "2026-11-01", amount: "1000000000000000000", status: "overdue" },
      { due_date: "2026-11-02", amount: "9000000000000000000", status: "void" },
      { due_date: null, amount: "1", status: "issued" },
    ];
    const b = receivablesByMonth(rows, (w) => Number(BigInt(w) / 10n ** 15n) / 1000);
    expect(b.map((x) => [x.key, x.paid, x.outstanding])).toEqual([["2026-10", 5, 2], ["2026-11", 0, 1]]);
  });
});
