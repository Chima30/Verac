import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { AdminOp } from "../../src/v2";
import { adminSubject, buildAdminOp, describeAdminOp } from "./v2-admin-ops";

const A = getAddress("0x00000000000000000000000000000000000000aa");
describe("V2 administrative changes", () => {
  it("builds and describes add, remove and recipient changes from their data", () => {
    for (const [cmd, op, words] of [["add-admin", AdminOp.AddAdmin, "Add administrator"], ["remove-admin", AdminOp.RemoveAdmin, "Remove administrator"], ["recipient", AdminOp.SetRecipient, "Approve payment recipient"]] as const) {
      const b = buildAdminOp(cmd, A);
      expect(b.op).toBe(op);
      expect(describeAdminOp(b.op, b.data)).toBe(`${words} ${A}`);
      expect(b.summary).toBe(describeAdminOp(b.op, b.data));
    }
    expect(describeAdminOp(AdminOp.SetRecipient, buildAdminOp("recipient", A, true).data)).toBe(`Remove payment recipient ${A}`);
  });
  it("names the administrator an add or remove is about, and nothing for other changes", () => {
    expect(adminSubject(AdminOp.RemoveAdmin, buildAdminOp("remove-admin", A).data)).toBe(A);
    expect(adminSubject(AdminOp.SetRecipient, buildAdminOp("recipient", A).data)).toBeNull();
  });
  it("refuses unknown changes and bad addresses", () => {
    expect(() => buildAdminOp("set-threshold", A)).toThrow(/unknown change/);
    expect(() => buildAdminOp("add-admin", "0x1234")).toThrow(/needs a 0x address/);
    expect(() => describeAdminOp(99, "0x")).toThrow(/unknown administrative operation/);
  });
});
