/**
 * Questions about a round answered from stored records (deterministic; no model involved). Each answer cites what it used.
 */
export type QueryKind = "incomplete_budgets" | "verified_deployments" | "shortlist" | "compare" | "milestones" | null;
export function classify(q: string): QueryKind {
  if (/incomplete budget|budget breakdown|missing budget/i.test(q)) return "incomplete_budgets";
  if (/qorechain deployment|on-?chain|deployed contract|verifiable deployment/i.test(q)) return "verified_deployments";
  if (/shortlist|within (our |the )?(remaining )?budget|allocat/i.test(q)) return "shortlist";
  if (/compare/i.test(q)) return "compare";
  if (/milestone|funded project/i.test(q)) return "milestones";
  return null;
}
