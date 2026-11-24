/** Shared types and small helpers for the Grants pages. Pure: no database access here. */
import type { Tone } from "@/components/ui";
import { labelMap, toneMap } from "@/lib/states";

export const CATEGORY_LABEL: Record<string, string> = { software: "Software", research: "Research", education: "Developer education", community: "Community / public goods", other: "Other" };
/** Grant application states: from the shared state-machine registry, so every page says the same thing. */
export const STATUS_TONE: Record<string, Tone> = toneMap("grant_application");
export const STATUS_TEXT: Record<string, string> = labelMap("grant_application");

export interface RoundRow {
  id: string; title: string; budget: string; status: string; description: string | null; requirements: string | null;
  categories: string[] | null; deadline: string | null; max_request: string | null; created_at?: string;
}
export interface RubricCriterion { key: string; label: string; max: number; guidance?: string; applies_to?: string[] }
export interface RubricRow { id: string; version: number; criteria: RubricCriterion[]; locked_at: string | null; created_at: string }
export interface AppContent {
  overview?: string; problem?: string; solution?: string; team?: string; experience?: string; technical?: string; metrics?: string; timeline?: string;
  links?: { website?: string; docs?: string; demo?: string; repos?: string[] };
  contracts?: string[]; transactions?: string[];
  budget?: Array<{ item: string; amount: string }>;
  milestones?: Array<{ title: string; deliverable: string; verification: string; due: string; amount: string }>;
  declarations?: { accurate?: boolean; rights?: boolean; conflicts_disclosed?: boolean };
}
export interface AppRow {
  id: string; grant_id: string; applicant_user_id: string; applicant_name: string; requested_amount: string; status: string; category: string | null;
  content: AppContent | null; recipient_address: string | null; version: number; submitted_at: string | null; amendment_open: boolean;
  recommended_by: string | null; pitch: string | null; created_at: string; updated_at?: string;
  review: { decision?: string; note?: string; by?: string; at?: string; ai?: { label?: string; fit?: number; summary?: string; strengths?: string[]; concerns?: string[]; questions_for_applicant?: string[]; model?: string; at?: string } } | null;
}
export interface VersionRow { version: number; requested_amount: string; category: string; recipient_address: string; content: AppContent; reason: string | null; created_at: string; changed_by: string }

/**
 * A base-unit amount as a whole-number string. Queries read amounts as text (`::text`), which is exact. As a safeguard, a
 * JSON number such as 2e+22 (how PostgREST sends numeric, and how JavaScript prints it from 10^21 up) is converted
 * instead of crashing BigInt; such a value may already have lost precision, so always prefer reading it as text.
 */
export function wei(v: unknown): string {
  const s = String(v ?? "0");
  if (/e/i.test(s) && Number.isFinite(Number(s))) return BigInt(Math.trunc(Number(s))).toString();
  return s.split(".")[0]!;
}
/** Base units to a plain QOR decimal string (up to 6 places) for form fields. */
export function weiToQorInput(v: unknown): string {
  const n = BigInt(wei(v));
  const frac = (n % 10n ** 18n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return `${n / 10n ** 18n}${frac ? "." + frac : ""}`;
}
export const sumWei = (xs: unknown[]) => xs.reduce<bigint>((t, x) => t + BigInt(wei(x)), 0n);

/** Criteria that apply to a project category (a criterion without applies_to applies to every category). */
export const criteriaFor = (criteria: RubricCriterion[], category: string | null) => criteria.filter((c) => !c.applies_to?.length || (category ? c.applies_to.includes(category) : true));

/** Field-by-field differences between two application versions, for reviewers. */
export function diffVersions(a: VersionRow, b: VersionRow): Array<{ field: string; before: string; after: string }> {
  const out: Array<{ field: string; before: string; after: string }> = [];
  const add = (field: string, x: unknown, y: unknown) => {
    const s = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v));
    if (s(x) !== s(y)) out.push({ field, before: s(x), after: s(y) });
  };
  add("Requested amount (base units)", a.requested_amount, b.requested_amount);
  add("Category", a.category, b.category);
  add("Recipient address", a.recipient_address, b.recipient_address);
  const keys = new Set([...Object.keys(a.content ?? {}), ...Object.keys(b.content ?? {})]);
  for (const k of [...keys].sort()) add(k, (a.content as Record<string, unknown>)[k], (b.content as Record<string, unknown>)[k]);
  return out;
}

/** What the person looking at an application should do next, in one sentence. */
export function nextAction(a: Pick<AppRow, "status" | "recommended_by" | "amendment_open">, admin: boolean, me: string, observer = false): string {
  // A security reviewer or read-only auditor who is not the applicant: describe where it stands, not what an applicant must do.
  if (observer && !admin) switch (a.status) {
    case "submitted": case "under_review": return "Under review. The agents' evidence, scores and flags are below; administrators decide.";
    case "clarification_requested": return "Waiting for the applicant to answer the reviewers' questions.";
    case "recommended": return "Recommended by one administrator. A different administrator must award it.";
  }
  switch (a.status) {
    case "draft": return admin ? "Draft: not visible to reviewers until submitted." : "Finish and submit your draft. Reviewers cannot see it yet.";
    case "submitted": case "under_review": return admin ? "Investigate it, read the evidence, then recommend, request clarification or reject with a reason." : "Under review. You will see questions here if reviewers need more information.";
    case "clarification_requested": return admin ? "Waiting for the applicant to answer the clarification request." : "Reviewers asked for clarification: answer the questions and resubmit.";
    case "recommended": return admin ? (a.recommended_by === me ? "You recommended it: a different administrator must award it." : "Recommended: a second administrator can award it.") : "Recommended. Waiting for a second administrator's decision.";
    case "awarded": return "Awarded. Milestones are below; no QOR moves until each milestone's evidence is approved and funding is authorised.";
    case "rejected": return "Rejected. The reason is recorded below.";
    default: return a.status;
  }
}
