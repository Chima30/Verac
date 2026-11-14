import { z } from "zod";

/**
 * Deterministic invoice checks. These rules decide the verdict. An AI model may only explain the result;
 * it can never change it, and the verdict never approves or pays anything.
 */

const NUM = z.number().finite();
export const InvoiceSchema = z.object({
  vendor: z.string().trim().min(1).max(120),
  invoiceNumber: z.string().trim().min(1).max(60),
  amountQor: NUM,
  payoutAddress: z.string().trim().max(100),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(1000).optional(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const HistoryItemSchema = z.object({
  vendor: z.string().trim().min(1).max(120),
  invoiceNumber: z.string().trim().min(1).max(60),
  amountQor: NUM,
  payoutAddress: z.string().trim().max(100),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type HistoryItem = z.infer<typeof HistoryItemSchema>;

export type Severity = "critical" | "high" | "medium" | "low";
export interface InvoiceFinding { code: InvoiceCode; severity: Severity; message: string }
export type InvoiceCode =
  | "INVALID_AMOUNT" | "INVALID_ADDRESS" | "DUPLICATE_INVOICE" | "PAYOUT_CHANGED" | "NEW_VENDOR"
  | "LOOKALIKE_VENDOR" | "SAME_AMOUNT_DIFFERENT_NUMBER" | "AMOUNT_OUTLIER" | "JUST_BELOW_LIMIT"
  | "FUTURE_DATED" | "DUE_BEFORE_INVOICE" | "STALE_INVOICE" | "PRESSURE_LANGUAGE" | "INSTRUCTION_IN_INVOICE";

export type InvoiceVerdict = "block" | "hold" | "pass";
export interface InvoiceCheck { verdict: InvoiceVerdict; findings: InvoiceFinding[]; checkedAgainst: number }

const normVendor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// "INV-0001", "inv 1" and "Inv_001" are the same invoice number.
const normNumber = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^([a-z]*)0+(?=\d)/, "$1");
const normAddr = (s: string) => s.trim().toLowerCase();

const EVM = /^0x[0-9a-fA-F]{40}$/;
const QOR = /^qor1[02-9ac-hj-np-z]{38}$/; // format only: the bech32 checksum is not verified here
export const isPayoutAddress = (s: string) => EVM.test(s) || QOR.test(s.toLowerCase());

const PRESSURE = /\b(urgent|urgently|immediately|asap|today only|final notice|do not (verify|call|check)|keep (this )?confidential|(new|changed|updated) (bank|account|wallet|address|payout)|wire (it )?now)\b/i;

export const INJECTION = /\b(ignore|disregard|override|bypass)\b.{0,30}\b(rules|instructions|policy|checks?)\b|\b(system|assistant|admin)\s*:|\bmark (this|it|the invoice)\b.{0,20}\b(safe|approved|paid|clean)\b|\bapprove (this|the) (invoice|payment)\b|\brank (this|it|our|my)\b.{0,25}\b(first|highest|top|best|number one)\b|\b(give|score) (this|it|us|me)\b.{0,15}\b(10|ten|full marks|highest)\b/i;

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

const days = (from: string, to: string) => (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000;

export interface InvoiceContext {
  /** Today as YYYY-MM-DD (passed in so the rules are deterministic and testable). */
  today: string;
  /** The agent's per-payment cap in QOR, if known, to spot amounts sitting just under it. */
  perTxCapQor?: number;
}

export function checkInvoice(inv: Invoice, history: HistoryItem[], ctx: InvoiceContext): InvoiceCheck {
  const f: InvoiceFinding[] = [];
  const add = (code: InvoiceCode, severity: Severity, message: string) => f.push({ code, severity, message });

  const decimals = (String(inv.amountQor).split(".")[1] ?? "").length;
  if (!(inv.amountQor > 0) || decimals > 6) add("INVALID_AMOUNT", "critical", "The amount must be above zero and have at most 6 decimal places.");
  if (!isPayoutAddress(inv.payoutAddress)) add("INVALID_ADDRESS", "critical", "The payout address is not a valid 0x or qor1 address format.");

  const v = normVendor(inv.vendor);
  const mine = history.filter((h) => normVendor(h.vendor) === v);

  const dup = mine.find((h) => normNumber(h.invoiceNumber) === normNumber(inv.invoiceNumber));
  if (dup) add("DUPLICATE_INVOICE", "critical", `This vendor already has invoice ${dup.invoiceNumber} dated ${dup.invoiceDate} on record. Paying again would be a duplicate payment.`);

  if (mine.length === 0) {
    add("NEW_VENDOR", "medium", "No payment history for this vendor, so nothing can be compared.");
    const near = [...new Set(history.map((h) => h.vendor))].find((name) => {
      const n = normVendor(name);
      return n !== v && Math.abs(n.length - v.length) <= 2 && levenshtein(n, v) <= 2;
    });
    if (near) add("LOOKALIKE_VENDOR", "high", `The vendor name is almost identical to an existing vendor ("${near}"). Check it is not an impersonation.`);
  } else {
    const known = new Set(mine.map((h) => normAddr(h.payoutAddress)));
    if (isPayoutAddress(inv.payoutAddress) && !known.has(normAddr(inv.payoutAddress)))
      add("PAYOUT_CHANGED", "high", "The payout address differs from every address used for this vendor before (compared as text). A changed address is the most common invoice-fraud pattern; confirm it with the vendor through a channel you already trust.");

    const same = mine.find((h) => h.amountQor === inv.amountQor && normNumber(h.invoiceNumber) !== normNumber(inv.invoiceNumber) && Math.abs(days(h.invoiceDate, inv.invoiceDate)) <= 30);
    if (same) add("SAME_AMOUNT_DIFFERENT_NUMBER", "high", `Same amount as invoice ${same.invoiceNumber} (${same.invoiceDate}) but a different number, within 30 days. Possible re-billing.`);

    if (mine.length >= 2) {
      const mean = mine.reduce((s, h) => s + h.amountQor, 0) / mine.length;
      if (inv.amountQor > mean * 3) add("AMOUNT_OUTLIER", "medium", `The amount is more than 3 times this vendor's average of ${mean.toFixed(2)} QOR over ${mine.length} invoices.`);
    }
  }

  if (ctx.perTxCapQor && inv.amountQor <= ctx.perTxCapQor && inv.amountQor >= ctx.perTxCapQor * 0.9)
    add("JUST_BELOW_LIMIT", "medium", `The amount sits within 10% under the agent's ${ctx.perTxCapQor} QOR per-payment limit, a pattern used to avoid extra review.`);

  if (days(ctx.today, inv.invoiceDate) > 1) add("FUTURE_DATED", "medium", "The invoice is dated in the future.");
  if (inv.dueDate && days(inv.invoiceDate, inv.dueDate) < 0) add("DUE_BEFORE_INVOICE", "medium", "The due date is before the invoice date.");
  if (days(inv.invoiceDate, ctx.today) > 365) add("STALE_INVOICE", "low", "The invoice is more than a year old.");
  if (inv.notes && PRESSURE.test(inv.notes)) add("PRESSURE_LANGUAGE", "medium", "The notes use urgency or secrecy wording, or announce changed payment details. Treat it as a social-engineering signal.");

  if (inv.notes && INJECTION.test(inv.notes)) add("INSTRUCTION_IN_INVOICE", "high", "The invoice text contains instructions aimed at an automated reviewer (for example to ignore rules or approve payment). Genuine vendors do not write these; treat it as an attack.");

  const verdict: InvoiceVerdict = f.some((x) => x.severity === "critical") ? "block" : f.some((x) => x.severity === "high" || x.severity === "medium") ? "hold" : "pass";
  return { verdict, findings: f, checkedAgainst: mine.length };
}

/** Schema the model fills in. It explains; it has no field that could change the verdict. */
export const InvoiceExplainSchema = z.object({
  explanation: z.string().min(1).max(700),
  reviewerQuestions: z.array(z.string().min(1).max(200)).max(4),
});
export type InvoiceExplain = z.infer<typeof InvoiceExplainSchema>;
