import { z } from "zod";

/** The only fields a person (or an AI draft) can supply for a live payment. Kept free of server imports so it is easy to test. */
export const ProposeSchema = z.object({
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amountQor: z.string().regex(/^\d{1,2}(\.\d{1,6})?$/, "Use a plain number such as 2.5"),
  purpose: z.string().trim().min(3).max(120),
  idempotencyKey: z.string().min(8).max(64),
});

export function parseQor(s: string): bigint {
  const [w, f = ""] = s.split(".");
  return BigInt(w!) * 10n ** 18n + BigInt(f.padEnd(18, "0").slice(0, 18));
}

/** The website never proposes more than this in one live operation (the vault enforces its own limits as well). */
export const MAX_LIVE_QOR = 10n * 10n ** 18n;
