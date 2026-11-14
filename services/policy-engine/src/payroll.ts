import { encodeAbiParameters, keccak256, parseAbiParameters, toBytes, getAddress } from "viem";
import { z } from "zod";
import { qorToWei } from "./index";

/**
 * Payroll batch checks. Fully deterministic: no AI is involved in preparing or checking a payroll.
 * The batch hash binds the exact list of recipients and amounts, so approvers approve precisely what will be paid.
 */

export const PayrollItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/, "address must be 0x followed by 40 hex characters"),
  amountQor: z.number().finite(),
});
export type PayrollItem = z.infer<typeof PayrollItemSchema>;
export const PeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must look like 2026-11");

export type PayrollCode =
  | "NO_LINES" | "TOO_MANY_LINES" | "INVALID_AMOUNT" | "INVALID_ADDRESS" | "DUPLICATE_ADDRESS" | "DUPLICATE_NAME"
  | "ADDRESS_CHANGED" | "NEW_PAYEE" | "AMOUNT_JUMP" | "OVER_LINE_CAP" | "OVER_TOTAL_CAP";
export type PayrollSeverity = "critical" | "high" | "medium";
export interface PayrollFinding { code: PayrollCode; severity: PayrollSeverity; line?: number; message: string }
export interface PayrollCheck { verdict: "block" | "review" | "clean"; findings: PayrollFinding[]; totalQor: number; lines: number }

export interface PayrollContext {
  /** The previous period's lines, to spot changed addresses and big jumps. */
  previous?: PayrollItem[];
  perLineCapQor?: number;
  totalCapQor?: number;
}

export const MAX_LINES = 200;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;

export function checkPayroll(items: PayrollItem[], ctx: PayrollContext = {}): PayrollCheck {
  const f: PayrollFinding[] = [];
  const add = (code: PayrollCode, severity: PayrollSeverity, message: string, line?: number) => f.push({ code, severity, message, ...(line === undefined ? {} : { line }) });
  if (items.length === 0) add("NO_LINES", "critical", "The batch has no lines.");
  if (items.length > MAX_LINES) add("TOO_MANY_LINES", "critical", `A batch may have at most ${MAX_LINES} lines.`);

  const prev = new Map((ctx.previous ?? []).map((p) => [norm(p.name), p]));
  const seenAddr = new Map<string, number>();
  const seenName = new Map<string, number>();
  let total = 0;
  items.forEach((it, i) => {
    const line = i + 1;
    if (!(it.amountQor > 0) || decimals(it.amountQor) > 6) add("INVALID_AMOUNT", "critical", "Amount must be above zero with at most 6 decimals.", line);
    else total += it.amountQor;
    if (!/^0x[0-9a-fA-F]{40}$/.test(it.address)) add("INVALID_ADDRESS", "critical", "Address is not a valid 0x address.", line);
    const a = it.address.toLowerCase(), n = norm(it.name);
    if (seenAddr.has(a)) add("DUPLICATE_ADDRESS", "critical", `Same address as line ${seenAddr.get(a)}. Paying one address twice in a batch is almost always a mistake or fraud.`, line);
    else seenAddr.set(a, line);
    if (seenName.has(n)) add("DUPLICATE_NAME", "high", `Same name as line ${seenName.get(n)} with a different address or amount.`, line);
    else seenName.set(n, line);

    const p = prev.get(n);
    if (!p && ctx.previous) add("NEW_PAYEE", "medium", `${it.name} was not paid last period.`, line);
    if (p) {
      if (p.address.toLowerCase() !== a) add("ADDRESS_CHANGED", "high", `${it.name}'s payout address differs from last period. Confirm the change with the person through a channel you already trust.`, line);
      if (p.amountQor > 0 && it.amountQor > p.amountQor * 1.5) add("AMOUNT_JUMP", "medium", `${it.amountQor} QOR is more than 50% above last period (${p.amountQor} QOR).`, line);
    }
    if (ctx.perLineCapQor && it.amountQor > ctx.perLineCapQor) add("OVER_LINE_CAP", "medium", `Above the ${ctx.perLineCapQor} QOR per-payment limit, so it would need extra approval.`, line);
  });
  if (ctx.totalCapQor && total > ctx.totalCapQor) add("OVER_TOTAL_CAP", "high", `Batch total ${total} QOR is above the ${ctx.totalCapQor} QOR limit.`);
  const verdict = f.some((x) => x.severity === "critical") ? "block" : f.length ? "review" : "clean";
  return { verdict, findings: f, totalQor: Math.round(total * 1e6) / 1e6, lines: items.length };
}

/**
 * keccak256(abi.encode(chainId, keccak(orgId), keccak(period), address[] recipients, uint256[] amounts)) over lines sorted by
 * address, so the same set of payments always hashes the same way. Amounts are 18-decimal base units.
 */
export function payrollBatchHash(orgId: string, period: string, items: PayrollItem[]): `0x${string}` {
  const sorted = [...items].sort((x, y) => x.address.toLowerCase().localeCompare(y.address.toLowerCase()));
  return keccak256(encodeAbiParameters(
    parseAbiParameters("uint256 chainId, bytes32 org, bytes32 period, address[] to, uint256[] amounts"),
    [9800n, keccak256(toBytes(orgId)), keccak256(toBytes(period)), sorted.map((s) => getAddress(s.address.toLowerCase())), sorted.map((s) => BigInt(qorToWei(s.amountQor)))],
  ));
}

export function payrollTotalWei(items: PayrollItem[]): string {
  return items.reduce((s, i) => s + BigInt(qorToWei(i.amountQor)), 0n).toString();
}
