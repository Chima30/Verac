import { z } from "zod";
import { INJECTION } from "./invoice";

/**
 * Deterministic checks on a grant application. These produce flags for a human reviewer; they never award or reject.
 * An AI model may add an advisory fit review, but it cannot change a flag, and instruction-like text in a pitch keeps the
 * application out of AI scoring altogether.
 */

export type GrantFlagCode = "ASKS_FOR_WHOLE_BUDGET" | "OVER_REMAINING" | "INSTRUCTION_IN_PITCH" | "THIN_PITCH" | "DUPLICATE_PITCH";
export interface GrantFlag { code: GrantFlagCode; blocking: boolean; message: string }

export interface GrantApplicationInput {
  /** Whole base units as decimal strings (wei). */
  requested: string;
  pitch: string;
  name?: string;
}
export interface GrantRoundContext {
  budget: string;
  /** Already awarded in this round. */
  awarded: string;
  /** Pitches of the other applications in the round, to spot copy-paste. */
  otherPitches: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function checkApplication(a: GrantApplicationInput, round: GrantRoundContext): { flags: GrantFlag[]; aiEligible: boolean } {
  const flags: GrantFlag[] = [];
  const requested = BigInt(a.requested);
  const budget = BigInt(round.budget);
  const remaining = budget - BigInt(round.awarded);
  if (requested > remaining) flags.push({ code: "OVER_REMAINING", blocking: true, message: "The request is more than what is left in the round, so it cannot be awarded as asked." });
  else if (requested === budget) flags.push({ code: "ASKS_FOR_WHOLE_BUDGET", blocking: false, message: "The request is the entire round budget." });
  if (INJECTION.test(`${a.pitch}\n${a.name ?? ""}`)) flags.push({ code: "INSTRUCTION_IN_PITCH", blocking: true, message: "The pitch contains instructions aimed at an automated reviewer. It is kept out of AI scoring for a human to read." });
  if (a.pitch.trim().length < 200) flags.push({ code: "THIN_PITCH", blocking: false, message: "The pitch is very short." });
  const mine = norm(a.pitch);
  if (round.otherPitches.some((p) => norm(p) === mine)) flags.push({ code: "DUPLICATE_PITCH", blocking: false, message: "Another application in this round has an identical pitch." });
  return { flags, aiEligible: !flags.some((f) => f.code === "INSTRUCTION_IN_PITCH") };
}

/** Advisory only. There is no field for a decision, an award or an amount. */
export const GrantReviewSchema = z.object({
  fit: z.number().min(0).max(10),
  summary: z.string().max(900),
  strengths: z.array(z.string().max(300)).max(6),
  concerns: z.array(z.string().max(300)).max(6),
  questions_for_applicant: z.array(z.string().max(300)).max(6),
});
export type GrantReview = z.infer<typeof GrantReviewSchema>;

/** Splits an amount into n milestones that add up exactly (the last one absorbs the remainder). */
export function splitEvenly(total: string, n: number): string[] {
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error("n must be 1 to 10");
  const t = BigInt(total);
  const each = t / BigInt(n);
  const out = Array.from({ length: n }, () => each);
  out[n - 1] = t - each * BigInt(n - 1);
  return out.map(String);
}
