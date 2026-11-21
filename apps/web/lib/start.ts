/**
 * Recorded evidence for the "Start here" replays. Nothing here is generated or estimated: the V2 attack run and the grants
 * dry run are the JSON records the scripts wrote; the invoice workflow is copied from docs/LIVE_WORKFLOW_2026-11-16.md.
 * Every transaction hash is re-checked against Diana weekly by `pnpm proof:check`.
 */
import v2Run from "../../../deployments/v2-live-results.json";
import grantsRun from "../../../deployments/grants-sample-dryrun.json";

export const EXPLORER = "https://explore.qore.network";
export const txUrl = (h: string) => `${EXPLORER}/tx/${h.startsWith("0x") ? h : h.toUpperCase()}`;

// ---------------------------------------------------------------- 1. invoice workflow, 16 November 2026
export const INVOICE_RUN = {
  date: "16 November 2026",
  instruction: "Review our three outstanding contractor invoices, check whether their milestones were approved, flag anything suspicious, and prepare eligible payments.",
  invoices: [
    { number: "DEMO-A-101", amount: "1.25", outcome: "ELIGIBLE" as const, why: "Vendor record matches, milestone approved, within the cap, today's allowance and the vault balance." },
    { number: "DEMO-B-102", amount: "2", outcome: "ON HOLD" as const, why: "The milestone it bills for is not approved." },
    { number: "DEMO-C-7", amount: "1.5", outcome: "ON HOLD" as const, why: "Payout address differs from the vendor record, the invoice text contains an instruction to the AI, and the recipient is not approved on the vault." },
  ],
  steps: [
    { who: "A finance manager", what: "Typed one instruction. Gemini turned it into an allow-listed intent; fixed rules checked the result." },
    { who: "Invoice, Milestone, Security and Treasury agents", what: "Read the organisation's invoices, vendors, milestones and the vault's live limits, and reported findings." },
    { who: "Policy agent (fixed code, no AI)", what: "Decided one invoice eligible and two on hold." },
    { who: "Payment agent", what: "Prepared the exact payment request for DEMO-A-101. Nothing was paid yet." },
    { who: "A different administrator", what: "Approved exactly that payment." },
    { who: "QoreChain", what: "The vault paid 1.25 QOR within the agent's caps and emitted PaymentExecuted with the approved payment hash." },
  ],
  approvalTx: "0xc58c67a3cb9c83b8d9d58240cc32d89b0cb45e33ca224c95a7acc7d75cdd691e",
  approvalBlock: 10202336,
  paymentTx: "0x5007c5d6bbde27022f38958d4b6d1a7d78bf48d825e665be7ba04daeeb0a8dd6",
  paymentBlock: 10202342,
  recipient: "0x200caD3c9De63D3613A33fc20b1ef31CB4dbF5AF",
};

// ---------------------------------------------------------------- 2. TreasuryVault V2 attack run, 19 November 2026
export interface V2Result { id: string; scenario: string; attacker?: string; expected: string; outcome: "executed" | "rejected-by-contract" | "rejected-by-chain" | "simulated-only"; error?: string; txHash?: string; block?: string; at: string }
const v2 = v2Run as unknown as { checkedAt: string; vault: string; vaultBalanceBefore: number; vaultBalanceAfter: number; results: V2Result[] };
export const V2_RUN = {
  vault: v2.vault,
  before: v2.vaultBalanceBefore,
  after: v2.vaultBalanceAfter,
  attacks: v2.results.filter((r) => r.id.startsWith("A")),
  payments: v2.results.filter((r) => r.id.startsWith("L")),
  guardian: v2.results.filter((r) => r.id.startsWith("G")),
};

// ---------------------------------------------------------------- 3. grants investigation, sample programme
export interface GrantEvidence { ref: string; source: string; subject: string; claim: string; status: string; reason: string; url: string | null }
export interface GrantScore { key: string; label: string; max: number; score: number | null; state: string; explanation: string; by: string }
export interface GrantResult {
  app: string; recommendation: { recommendation: string; why: string }; evidence: GrantEvidence[]; scores: GrantScore[];
  flags: Array<{ code: string; severity: string; message: string }>; questions: Array<{ about: string; question: string }>;
  ai: { model?: string; strengths?: string[]; concerns?: string[] };
}
const g = grantsRun as unknown as { ranAt: string; results: GrantResult[] };
export const GRANTS_RUN = { ranAt: g.ranAt, results: g.results };
