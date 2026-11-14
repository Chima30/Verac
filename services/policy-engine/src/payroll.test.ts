import { describe, expect, it } from "vitest";
import { checkPayroll, payrollBatchHash, payrollTotalWei, type PayrollItem } from "./index";

const A = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const prev: PayrollItem[] = [{ name: "Ada", address: A(1), amountQor: 100 }, { name: "Bob", address: A(2), amountQor: 200 }];
const codes = (items: PayrollItem[], ctx = {}) => checkPayroll(items, ctx).findings.map((f) => f.code);

describe("payroll checks", () => {
  it("a normal batch is clean and totals correctly", () => {
    const r = checkPayroll([{ name: "Ada", address: A(1), amountQor: 100 }, { name: "Bob", address: A(2), amountQor: 210.5 }], { previous: prev });
    expect(r).toMatchObject({ verdict: "clean", totalQor: 310.5, lines: 2 });
  });
  it("blocks empty batches, bad amounts, bad addresses and a repeated address", () => {
    expect(checkPayroll([]).verdict).toBe("block");
    expect(codes([{ name: "A", address: A(1), amountQor: 0 }])).toContain("INVALID_AMOUNT");
    expect(codes([{ name: "A", address: A(1), amountQor: 1.1234567 }])).toContain("INVALID_AMOUNT");
    expect(codes([{ name: "A", address: "0x12", amountQor: 1 }])).toContain("INVALID_ADDRESS");
    const dup = checkPayroll([{ name: "A", address: A(1), amountQor: 1 }, { name: "B", address: A(1).toUpperCase().replace("0X", "0x"), amountQor: 1 }]);
    expect(dup.verdict).toBe("block");
    expect(dup.findings.map((f) => f.code)).toContain("DUPLICATE_ADDRESS");
  });
  it("flags a repeated name, case and spacing aside", () => {
    expect(codes([{ name: "Ada Lovelace", address: A(1), amountQor: 1 }, { name: "ada  lovelace", address: A(2), amountQor: 1 }])).toContain("DUPLICATE_NAME");
  });
  it("compares with the previous period: changed address, new payee, big jump", () => {
    const r = checkPayroll([{ name: "Ada", address: A(9), amountQor: 100 }, { name: "Bob", address: A(2), amountQor: 400 }, { name: "Cy", address: A(3), amountQor: 5 }], { previous: prev });
    const c = r.findings.map((f) => `${f.code}@${f.line}`);
    expect(c).toContain("ADDRESS_CHANGED@1");
    expect(c).toContain("AMOUNT_JUMP@2");
    expect(c).toContain("NEW_PAYEE@3");
    expect(r.verdict).toBe("review");
  });
  it("does not call everyone a new payee when there is no previous period", () => {
    expect(codes([{ name: "Ada", address: A(1), amountQor: 1 }])).not.toContain("NEW_PAYEE");
  });
  it("applies the per-line and total limits", () => {
    expect(codes([{ name: "A", address: A(1), amountQor: 500 }], { perLineCapQor: 100 })).toContain("OVER_LINE_CAP");
    expect(codes([{ name: "A", address: A(1), amountQor: 60 }, { name: "B", address: A(2), amountQor: 60 }], { totalCapQor: 100 })).toContain("OVER_TOTAL_CAP");
  });
});

describe("batch hash", () => {
  const items: PayrollItem[] = [{ name: "Ada", address: A(1), amountQor: 100 }, { name: "Bob", address: A(2), amountQor: 200.5 }];
  const ORG = "6f9619ff-8b86-d011-b42d-00c04fc964ff";
  it("does not depend on line order or names, but binds every address, amount, period and organisation", () => {
    const h = payrollBatchHash(ORG, "2026-11", items);
    expect(payrollBatchHash(ORG, "2026-11", [...items].reverse())).toBe(h);
    expect(payrollBatchHash(ORG, "2026-11", items.map((i) => ({ ...i, name: "x" + i.name })))).toBe(h);
    expect(payrollBatchHash(ORG, "2026-12", items)).not.toBe(h);
    expect(payrollBatchHash(ORG.replace("6", "7"), "2026-11", items)).not.toBe(h);
    expect(payrollBatchHash(ORG, "2026-11", [{ ...items[0]!, amountQor: 100.000001 }, items[1]!])).not.toBe(h);
    expect(payrollBatchHash(ORG, "2026-11", [{ ...items[0]!, address: A(7) }, items[1]!])).not.toBe(h);
  });
  it("totals in base units without floating point error", () => {
    expect(payrollTotalWei([{ name: "a", address: A(1), amountQor: 0.1 }, { name: "b", address: A(2), amountQor: 0.2 }])).toBe("300000000000000000");
  });
});
