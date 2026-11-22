/**
 * Every state machine in Verac, made explicit.
 *
 * Each table with a status or state column is a state machine: the database lists its allowed values, SQL functions
 * move rows between them, and pages show them. This registry is the one place that names all three, so that:
 *   - people see the same words and colours for a state everywhere (UX);
 *   - developers have one file to read, and tests fail when the database, the code and this file disagree (DX):
 *     tests/state/state-machines.test.ts replays every migration and scans every write;
 *   - agents and tools can read the rules as data from /api/state-machines and docs/STATE_MACHINES.md (AX).
 *
 * It describes; it does not enforce. Enforcement stays where it is: in the SQL functions and row-level security.
 * Pure data and helpers only: no database access, safe in the browser.
 */

/** How a state is shown. Matches the website's badge tones. */
export type StateTone = "live" | "sim" | "pending" | "approval" | "failed" | "unavailable" | "neutral" | "info";

export interface StateDef {
  label: string;
  tone: StateTone;
  /** One sentence a person or an agent can rely on. */
  meaning: string;
  /** No move leaves this state. */
  terminal?: boolean;
  /** A resting state: rows normally stay here, and no code moves them on today (say what would). */
  steady?: string;
  /** Allowed by the database but never written by any code today. Kept so existing rows stay valid; say why. */
  reserved?: string;
}

export interface TransitionDef {
  /** States the row must be in; "new" means the row is created in `to`. */
  from: readonly string[] | "new";
  to: string;
  /** The function or code path that makes the move (SQL function, server action or agent step). */
  via: string;
  /** Who can cause it, in words. */
  who: string;
}

export interface MachineDef {
  id: string;
  title: string;
  table: string;
  column: "status" | "state";
  /** "lifecycle" moves through states; "classification" labels a fact and never moves. */
  kind: "lifecycle" | "classification";
  states: Record<string, StateDef>;
  transitions: readonly TransitionDef[];
}

const M = <T extends MachineDef>(m: T) => m;

// ------------------------------------------------------------------------------------------------------------ money
const payment = M({
  id: "payment", title: "Payment request", table: "transactions", column: "state", kind: "lifecycle",
  states: {
    PROPOSED: { label: "Proposed", tone: "pending", meaning: "An agent drafted the payment inside the agent pipeline; nothing is recorded for approval yet." },
    VALIDATING: { label: "Checking", tone: "pending", meaning: "Fixed rules are checking the amount, recipient and limits (agent pipeline)." },
    AWAITING_APPROVAL: { label: "Awaiting approval", tone: "approval", meaning: "Waiting for a different person to approve exactly this payment (or two administrators to sign it on V2)." },
    APPROVED: { label: "Approved", tone: "approval", meaning: "Approved for exactly this amount and recipient; not sent yet." },
    SIMULATING: { label: "Simulating", tone: "pending", meaning: "The call is being simulated against the chain before sending (agent pipeline)." },
    READY: { label: "Sending", tone: "pending", meaning: "Claimed for execution; the transaction is being sent." },
    SUBMITTED: { label: "Sent", tone: "pending", meaning: "Sent to the chain; waiting for the receipt." },
    CONFIRMED: { label: "Confirmed on chain", tone: "live", meaning: "The chain confirmed the payment and its event matched the approved payment hash.", terminal: true },
    REJECTED: { label: "Rejected", tone: "failed", meaning: "A person or a rule refused it. Nothing moved.", terminal: true },
    FAILED: { label: "Failed", tone: "failed", meaning: "Sending or confirming failed; nothing moved. A retry is a new request.", terminal: true },
    CANCELLED: { label: "Cancelled", tone: "neutral", meaning: "Withdrawn or expired before it was sent. Nothing moved.", terminal: true },
  },
  transitions: [
    { from: "new", to: "AWAITING_APPROVAL", via: "request_payment / live_propose_payment / v2 propose", who: "finance role, or the Payment agent on its behalf" },
    { from: ["AWAITING_APPROVAL"], to: "APPROVED", via: "decide_payment (enough approvals) / set_admin_signer (enough V2 signatures)", who: "a different administrator; on V2, two administrators' ML-DSA-87 signatures" },
    { from: ["AWAITING_APPROVAL"], to: "REJECTED", via: "decide_payment", who: "an approver" },
    { from: ["AWAITING_APPROVAL", "APPROVED"], to: "CANCELLED", via: "decide_payment / live_claim_execution (expired)", who: "the system, when the approval window has passed" },
    { from: ["APPROVED"], to: "READY", via: "live_claim_execution", who: "an administrator pressing Execute" },
    { from: ["READY"], to: "SUBMITTED", via: "live_record_submitted", who: "the server, after the chain accepts the transaction" },
    { from: ["READY", "SUBMITTED"], to: "FAILED", via: "live_record_failure / live_record_receipt", who: "the server, when sending or the receipt fails" },
    { from: ["SUBMITTED"], to: "CONFIRMED", via: "live_record_receipt", who: "the server, after verifying the receipt and the vault event" },
    // The in-memory agent pipeline (services/agent-coordinator/src/pipeline.ts) walks the same states with extra checks.
    { from: "new", to: "PROPOSED", via: "agent pipeline", who: "an agent" },
    { from: ["PROPOSED"], to: "VALIDATING", via: "agent pipeline", who: "an agent" },
    { from: ["PROPOSED"], to: "CANCELLED", via: "agent pipeline", who: "an agent" },
    { from: ["VALIDATING"], to: "AWAITING_APPROVAL", via: "agent pipeline", who: "fixed rules" },
    { from: ["VALIDATING"], to: "APPROVED", via: "agent pipeline (within an auto-approve cap)", who: "fixed rules" },
    { from: ["VALIDATING", "SIMULATING"], to: "REJECTED", via: "agent pipeline", who: "fixed rules" },
    { from: ["VALIDATING", "SIMULATING"], to: "FAILED", via: "agent pipeline", who: "fixed rules" },
    { from: ["APPROVED"], to: "SIMULATING", via: "agent pipeline", who: "an agent" },
    { from: ["SIMULATING"], to: "READY", via: "agent pipeline", who: "an agent" },
    { from: ["READY"], to: "CANCELLED", via: "agent pipeline", who: "an agent" },
  ],
});

const payroll = M({
  id: "payroll", title: "Payroll batch", table: "payroll_batches", column: "status", kind: "lifecycle",
  states: {
    draft: { label: "Draft", tone: "neutral", meaning: "Being prepared.", reserved: "submit_payroll_batch creates batches directly as awaiting approval." },
    awaiting_approval: { label: "Awaiting approval", tone: "approval", meaning: "Submitted with its payment request; waiting for a different finance member." },
    approved: { label: "Approved, not paid", tone: "approval", meaning: "Its payment request was approved in Verac; payroll does not send QOR yet (Labs).", terminal: true },
    paid: { label: "Paid", tone: "live", meaning: "Paid on chain.", reserved: "Approved payroll batches do not send QOR yet (Labs)." },
    failed: { label: "Failed", tone: "failed", meaning: "Its payment request was rejected or expired.", terminal: true },
  },
  transitions: [
    { from: "new", to: "awaiting_approval", via: "submit_payroll_batch", who: "finance role" },
    { from: ["awaiting_approval"], to: "approved", via: "decide_payment", who: "a different finance member" },
    { from: ["awaiting_approval"], to: "failed", via: "decide_payment", who: "an approver, or expiry" },
  ],
});

const invoice = M({
  id: "invoice", title: "Invoice", table: "invoices", column: "status", kind: "lifecycle",
  states: {
    received: { label: "Received", tone: "neutral", meaning: "Recorded exactly as the contractor sent it; not reviewed yet." },
    held: { label: "On hold", tone: "approval", meaning: "Its payment failed or was refused; a person must look again." },
    approved: { label: "Approved", tone: "approval", meaning: "Approved for payment.", reserved: "The agent workflow records its decision on the payment request, not on the invoice." },
    paid: { label: "Paid", tone: "live", meaning: "Its payment was confirmed on chain.", terminal: true },
    rejected: { label: "Rejected", tone: "failed", meaning: "Will not be paid.", reserved: "Rejections are recorded on the workflow, not on the invoice." },
  },
  transitions: [
    { from: "new", to: "received", via: "record_invoice / load demo", who: "finance role" },
    { from: ["received", "held"], to: "paid", via: "invoice_follow_payment (trigger)", who: "the system, when the linked payment is confirmed" },
    { from: ["received"], to: "held", via: "invoice_follow_payment (trigger)", who: "the system, when the linked payment fails or is rejected" },
  ],
});

const revenue = M({
  id: "revenue", title: "Money owed to the organisation", table: "revenue_records", column: "status", kind: "lifecycle",
  states: {
    issued: { label: "Outstanding", tone: "pending", meaning: "Owed and not yet paid." },
    overdue: { label: "Overdue", tone: "approval", meaning: "Past its due date.", reserved: "Overdue is worked out from the due date when the page is shown; it is never stored." },
    paid: { label: "Paid", tone: "live", meaning: "Marked paid; verified on chain when a transaction hash was given.", terminal: true },
    void: { label: "Void", tone: "neutral", meaning: "Cancelled with a recorded reason.", terminal: true },
  },
  transitions: [
    { from: "new", to: "issued", via: "record_revenue", who: "finance role" },
    { from: ["issued", "overdue"], to: "paid", via: "mark_revenue_paid", who: "finance role" },
    { from: ["issued", "overdue"], to: "void", via: "void_revenue_record", who: "finance role" },
  ],
});

// ------------------------------------------------------------------------------------------------------------ grants
const grantRound = M({
  id: "grant_round", title: "Grant round", table: "grants", column: "status", kind: "lifecycle",
  states: {
    draft: { label: "Draft", tone: "neutral", meaning: "Not published.", reserved: "Rounds are created open." },
    open: { label: "Open", tone: "info", meaning: "Accepting applications until its deadline." },
    closed: { label: "Closed", tone: "neutral", meaning: "No new applications; existing ones continue.", terminal: true },
  },
  transitions: [
    { from: "new", to: "open", via: "create_grant_round", who: "owner or administrator" },
    { from: ["open"], to: "closed", via: "close_grant", who: "owner or administrator" },
  ],
});

const grantApplication = M({
  id: "grant_application", title: "Grant application", table: "grant_applications", column: "status", kind: "lifecycle",
  states: {
    draft: { label: "Draft", tone: "neutral", meaning: "Private to the applicant; reviewers cannot see it." },
    submitted: { label: "Submitted", tone: "pending", meaning: "Submitted and locked as a version; waiting for review." },
    under_review: { label: "Under review", tone: "info", meaning: "Agents or reviewers are investigating it." },
    clarification_requested: { label: "Clarification requested", tone: "approval", meaning: "Reviewers asked questions; the applicant may amend once." },
    recommended: { label: "Recommended", tone: "approval", meaning: "One administrator recommended it; a different administrator must award it." },
    awarded: { label: "Awarded", tone: "live", meaning: "Awarded within the round budget; milestones decide when money moves.", terminal: true },
    rejected: { label: "Rejected", tone: "failed", meaning: "Not funded; the reason is recorded.", terminal: true },
  },
  transitions: [
    { from: "new", to: "draft", via: "save_grant_application", who: "the applicant" },
    { from: "new", to: "submitted", via: "apply_to_grant (one-step) / sample programme", who: "the applicant, or an administrator loading the sample" },
    { from: ["draft"], to: "submitted", via: "submit_grant_application", who: "the applicant" },
    { from: ["submitted"], to: "under_review", via: "grants engine / save_application_review", who: "the investigation agents" },
    { from: ["clarification_requested"], to: "under_review", via: "submit_grant_application (amendment)", who: "the applicant" },
    { from: ["submitted", "under_review"], to: "clarification_requested", via: "send_grant_clarification", who: "owner or administrator" },
    { from: ["submitted", "under_review", "clarification_requested"], to: "recommended", via: "decide_application", who: "owner or administrator" },
    { from: ["submitted", "under_review", "clarification_requested", "recommended"], to: "rejected", via: "decide_application", who: "owner or administrator" },
    { from: ["recommended"], to: "awarded", via: "award_application", who: "a different owner or administrator" },
  ],
});

const grantClarification = M({
  id: "grant_clarification", title: "Clarification request", table: "grant_clarifications", column: "status", kind: "lifecycle",
  states: {
    draft: { label: "Draft", tone: "neutral", meaning: "Drafted by the agents; not sent." },
    sent: { label: "Sent", tone: "approval", meaning: "Sent to the applicant; waiting for an answer." },
    answered: { label: "Answered", tone: "info", meaning: "The applicant answered.", terminal: true },
    cancelled: { label: "Cancelled", tone: "neutral", meaning: "Withdrawn before sending.", terminal: true },
  },
  transitions: [
    { from: "new", to: "draft", via: "grants engine", who: "the investigation agents" },
    { from: ["draft"], to: "sent", via: "send_grant_clarification", who: "owner or administrator" },
    { from: ["draft"], to: "cancelled", via: "cancel_grant_clarification", who: "owner or administrator" },
    { from: ["sent"], to: "answered", via: "answer_grant_clarification", who: "the applicant" },
  ],
});

const grantRiskFlag = M({
  id: "grant_risk_flag", title: "Risk flag", table: "grant_risk_flags", column: "status", kind: "lifecycle",
  states: {
    open: { label: "Open", tone: "approval", meaning: "Raised by the agents; a person must decide." },
    dismissed: { label: "Dismissed", tone: "neutral", meaning: "A person judged it not a problem, with a reason.", terminal: true },
    confirmed: { label: "Confirmed", tone: "failed", meaning: "A person confirmed the risk, with a reason.", terminal: true },
  },
  transitions: [
    { from: "new", to: "open", via: "grants engine", who: "the risk agent" },
    { from: ["open"], to: "dismissed", via: "decide_risk_flag", who: "owner, administrator or security reviewer" },
    { from: ["open"], to: "confirmed", via: "decide_risk_flag", who: "owner, administrator or security reviewer" },
  ],
});

const grantFunding = M({
  id: "grant_funding", title: "Grant milestone funding", table: "grant_funding_records", column: "status", kind: "lifecycle",
  states: {
    awaiting_authorised_path: { label: "Awaiting a funding path", tone: "approval", meaning: "Approved, but no vault can pay this amount within its limits yet.", terminal: true },
    requested: { label: "Requested", tone: "approval", meaning: "A payment request exists in Approvals." },
    confirmed: { label: "Paid", tone: "live", meaning: "The payment was confirmed on chain and the milestone released.", terminal: true },
    failed: { label: "Failed", tone: "failed", meaning: "The payment failed; nothing moved.", terminal: true },
    cancelled: { label: "Cancelled", tone: "neutral", meaning: "The payment was rejected or expired; nothing moved.", terminal: true },
  },
  transitions: [
    { from: "new", to: "requested", via: "request_grant_milestone_payment", who: "finance role" },
    { from: "new", to: "awaiting_authorised_path", via: "request_grant_milestone_payment", who: "finance role, when no vault can pay it" },
    { from: ["requested"], to: "confirmed", via: "grant_follow_payment (trigger)", who: "the system, on chain confirmation" },
    { from: ["requested"], to: "failed", via: "grant_follow_payment (trigger)", who: "the system" },
    { from: ["requested"], to: "cancelled", via: "grant_follow_payment (trigger)", who: "the system" },
  ],
});

const grantEvidence = M({
  id: "grant_evidence", title: "Evidence check", table: "grant_evidence", column: "status", kind: "classification",
  states: {
    VERIFIED: { label: "Verified", tone: "live", meaning: "The source confirms the claim.", terminal: true },
    PARTIALLY_VERIFIED: { label: "Partly verified", tone: "info", meaning: "The source confirms part of the claim.", terminal: true },
    UNVERIFIED: { label: "Unverified", tone: "pending", meaning: "Nothing was found that confirms or contradicts it.", terminal: true },
    CONTRADICTED: { label: "Contradicted", tone: "failed", meaning: "The source says otherwise.", terminal: true },
    UNAVAILABLE: { label: "Unavailable", tone: "unavailable", meaning: "The source could not be read (private, missing or rate limited). Not a negative finding.", terminal: true },
  },
  transitions: [
    { from: "new", to: "VERIFIED", via: "research agents", who: "the research agent" },
    { from: "new", to: "PARTIALLY_VERIFIED", via: "research agents", who: "the research agent" },
    { from: "new", to: "UNVERIFIED", via: "research agents", who: "the research agent" },
    { from: "new", to: "CONTRADICTED", via: "research agents", who: "the research agent" },
    { from: "new", to: "UNAVAILABLE", via: "research agents", who: "the research agent" },
  ],
});

// ------------------------------------------------------------------------------------------------------------ work
const milestone = M({
  id: "milestone", title: "Milestone", table: "milestones", column: "status", kind: "lifecycle",
  states: {
    pending: { label: "Waiting for evidence", tone: "pending", meaning: "Waiting for the vendor or grantee to submit evidence (in order)." },
    evidence_submitted: { label: "Evidence submitted", tone: "approval", meaning: "Evidence is in; a reviewer must accept or reject it." },
    approved: { label: "Accepted", tone: "approval", meaning: "Evidence accepted; finance may request the payment." },
    released: { label: "Paid", tone: "live", meaning: "The payment was confirmed on chain.", terminal: true },
    disputed: { label: "Disputed", tone: "failed", meaning: "Frozen until an administrator resolves the dispute." },
  },
  transitions: [
    { from: "new", to: "pending", via: "award_procurement / award_application", who: "the award" },
    { from: "new", to: "approved", via: "load demo", who: "demo data only" },
    { from: "new", to: "evidence_submitted", via: "load demo", who: "demo data only" },
    { from: ["pending"], to: "evidence_submitted", via: "submit_milestone_evidence / submit_grant_milestone_evidence", who: "the vendor or grantee" },
    { from: ["evidence_submitted"], to: "approved", via: "decide_milestone / decide_grant_milestone", who: "a reviewer" },
    { from: ["evidence_submitted"], to: "pending", via: "decide_milestone / decide_grant_milestone (rejected)", who: "a reviewer" },
    { from: ["pending", "evidence_submitted", "approved"], to: "disputed", via: "open_dispute", who: "a party to the milestone" },
    { from: ["disputed"], to: "approved", via: "resolve_dispute (accept work)", who: "an administrator who did not open the dispute" },
    { from: ["disputed"], to: "pending", via: "resolve_dispute (reject work)", who: "an administrator who did not open the dispute" },
    { from: ["approved"], to: "released", via: "grant_follow_payment (trigger) / escrow release", who: "the system, on chain confirmation" },
  ],
});

const tender = M({
  id: "tender", title: "Tender", table: "procurements", column: "status", kind: "lifecycle",
  states: {
    draft: { label: "Draft", tone: "neutral", meaning: "Not visible to vendors." },
    open: { label: "Open for bids", tone: "info", meaning: "Vendors submit sealed bids until bidding closes." },
    review: { label: "Reviewing bids", tone: "approval", meaning: "Bids are opened by reviewers and checked by fixed rules." },
    awarded: { label: "Awarded", tone: "live", meaning: "A person chose the winner; milestones were created.", steady: "Work continues on its milestones; closing an awarded tender is not built yet." },
    closed: { label: "Closed", tone: "neutral", meaning: "Finished.", terminal: true, reserved: "No code closes an awarded tender yet." },
  },
  transitions: [
    { from: "new", to: "draft", via: "createTender", who: "procurement role" },
    { from: "new", to: "awarded", via: "load demo", who: "demo data only" },
    { from: ["draft"], to: "open", via: "open_tender", who: "procurement role" },
    { from: ["open"], to: "review", via: "close_bidding", who: "procurement role" },
    { from: ["review"], to: "awarded", via: "award_procurement", who: "procurement role" },
  ],
});

const dispute = M({
  id: "dispute", title: "Dispute", table: "disputes", column: "status", kind: "lifecycle",
  states: {
    open: { label: "Open", tone: "approval", meaning: "The milestone is frozen; statements are being collected." },
    under_review: { label: "Under review", tone: "info", meaning: "Being reviewed.", reserved: "Disputes go straight from open to resolved." },
    resolved: { label: "Resolved", tone: "neutral", meaning: "Decided by an administrator who did not open it, with a reason.", terminal: true },
  },
  transitions: [
    { from: "new", to: "open", via: "open_dispute", who: "a party to the milestone" },
    { from: ["open"], to: "resolved", via: "resolve_dispute", who: "an administrator who did not open it" },
  ],
});

const proposal = M({
  id: "proposal", title: "Governance proposal", table: "governance_proposals", column: "status", kind: "lifecycle",
  states: {
    discussion: { label: "Discussion", tone: "neutral", meaning: "Being discussed; voting has not opened." },
    voting: { label: "Voting", tone: "info", meaning: "Members vote until the deadline." },
    passed: { label: "Passed", tone: "live", meaning: "Quorum met and the pass line reached. Executes nothing by itself.", terminal: true },
    failed: { label: "Failed", tone: "failed", meaning: "Quorum missed or the pass line not reached.", terminal: true },
    executed: { label: "Executed", tone: "live", meaning: "Carried out.", reserved: "Proposals execute nothing; spending goes through Approvals." },
  },
  transitions: [
    { from: "new", to: "discussion", via: "create_proposal", who: "owner or administrator" },
    { from: ["discussion"], to: "voting", via: "open_voting", who: "owner or administrator" },
    { from: ["voting"], to: "passed", via: "finalize_proposal", who: "any member, after the deadline" },
    { from: ["voting"], to: "failed", via: "finalize_proposal", who: "any member, after the deadline" },
  ],
});

// ------------------------------------------------------------------------------------------------------------ agents
const workflow = M({
  id: "workflow", title: "Agent workflow", table: "agent_tasks", column: "state", kind: "lifecycle",
  states: {
    QUEUED: { label: "Queued", tone: "pending", meaning: "Waiting for a worker to claim it." },
    RUNNING: { label: "Running", tone: "info", meaning: "Agents are working through the steps; each step is saved." },
    AWAITING_HUMAN: { label: "Waiting for a person", tone: "approval", meaning: "Agents finished their part; a person must decide." },
    PAUSED_AI_UNAVAILABLE: { label: "Paused: AI unavailable", tone: "unavailable", meaning: "The AI quota or service is unavailable; it resumes when it returns." },
    COMPLETED: { label: "Completed", tone: "live", meaning: "Finished; the receipt is available.", terminal: true },
    FAILED: { label: "Failed", tone: "failed", meaning: "Stopped with a recorded error.", terminal: true },
    CANCELLED: { label: "Cancelled", tone: "neutral", meaning: "Cancelled by a person; anything it prepared was withdrawn.", terminal: true },
  },
  transitions: [
    { from: "new", to: "QUEUED", via: "start_invoice_workflow / start_grant_workflow", who: "finance role or administrator" },
    { from: "new", to: "AWAITING_HUMAN", via: "agent payment task", who: "the Payment agent" },
    { from: ["QUEUED", "PAUSED_AI_UNAVAILABLE"], to: "RUNNING", via: "claim_workflow / claim_grant_workflow", who: "a worker holding the lease" },
    { from: ["RUNNING"], to: "AWAITING_HUMAN", via: "workflow engines", who: "the coordinator" },
    { from: ["RUNNING"], to: "PAUSED_AI_UNAVAILABLE", via: "workflow engines", who: "the coordinator" },
    { from: ["RUNNING", "AWAITING_HUMAN"], to: "COMPLETED", via: "workflow engines / decide_payment", who: "the coordinator, or a person's decision" },
    { from: ["RUNNING", "AWAITING_HUMAN"], to: "FAILED", via: "workflow engines / decide_payment", who: "the coordinator, or a person's decision" },
    { from: ["QUEUED", "RUNNING", "AWAITING_HUMAN", "PAUSED_AI_UNAVAILABLE"], to: "CANCELLED", via: "cancel_invoice_workflow / cancel_grant_workflow", who: "the person who started it, or an administrator" },
  ],
});

const strategy = M({
  id: "strategy", title: "Saved strategy", table: "strategies", column: "status", kind: "lifecycle",
  states: {
    active: { label: "Active", tone: "info", meaning: "Would run on a schedule.", reserved: "Strategies are simulations; nothing ever runs on a schedule." },
    paused: { label: "Paused", tone: "sim", meaning: "Saved numbers only; never runs." },
    cancelled: { label: "Cancelled", tone: "neutral", meaning: "Removed from the list.", terminal: true },
  },
  transitions: [
    { from: "new", to: "paused", via: "save_strategy", who: "finance role" },
    { from: ["paused", "active"], to: "cancelled", via: "cancel_strategy", who: "finance role" },
  ],
});

// ------------------------------------------------------------------------------------------------------------ accounts
const membership = M({
  id: "membership", title: "Membership", table: "memberships", column: "status", kind: "lifecycle",
  states: {
    active: { label: "Active", tone: "live", meaning: "Can use the organisation within their role.", steady: "Removing a member deletes the row." },
    invited: { label: "Invited", tone: "pending", meaning: "Invited, not joined.", reserved: "Members are added directly by user id." },
    revoked: { label: "Revoked", tone: "neutral", meaning: "No longer a member.", terminal: true, reserved: "Removal deletes the membership today." },
  },
  transitions: [
    { from: "new", to: "active", via: "createOrganisation / add member / join demo", who: "owner or administrator, or the visitor joining the read-only demo" },
  ],
});

const organization = M({
  id: "organization", title: "Organisation", table: "organizations", column: "status", kind: "lifecycle",
  states: {
    active: { label: "Active", tone: "live", meaning: "In use.", steady: "Organisations are not suspended or closed in the app." },
    suspended: { label: "Suspended", tone: "failed", meaning: "Blocked.", reserved: "No code suspends an organisation." },
  },
  transitions: [{ from: "new", to: "active", via: "createOrganisation", who: "any signed-in user" }],
});

const agent = M({
  id: "agent", title: "Agent registration", table: "agents", column: "status", kind: "lifecycle",
  states: {
    active: { label: "Active", tone: "live", meaning: "Registered and allowed its listed tools.", steady: "Agents are stopped on chain (revoked spending rules), not by this record." },
    suspended: { label: "Suspended", tone: "approval", meaning: "Temporarily disabled.", reserved: "Agents are switched off on chain (revoked spending rules), not here." },
    revoked: { label: "Revoked", tone: "failed", meaning: "Permanently disabled.", terminal: true, reserved: "Agents are switched off on chain (revoked spending rules), not here." },
  },
  transitions: [{ from: "new", to: "active", via: "agent registry seed", who: "the system" }],
});

const policy = M({
  id: "policy", title: "Spending policy", table: "policies", column: "status", kind: "lifecycle",
  states: {
    draft: { label: "Draft", tone: "neutral", meaning: "Being written.", steady: "Policies are drafted and checked in the Policies tool; the vault holds the enforced limits." },
    pending_approval: { label: "Awaiting approval", tone: "approval", meaning: "Waiting for approval.", reserved: "Policies are drafted and checked in the Policies tool; the vault holds the enforced limits." },
    active: { label: "Active", tone: "live", meaning: "In force.", reserved: "Policies are drafted and checked in the Policies tool; the vault holds the enforced limits." },
    revoked: { label: "Revoked", tone: "failed", meaning: "Withdrawn.", terminal: true, reserved: "Policies are drafted and checked in the Policies tool; the vault holds the enforced limits." },
    superseded: { label: "Superseded", tone: "neutral", meaning: "Replaced by a newer version.", terminal: true, reserved: "Policies are drafted and checked in the Policies tool; the vault holds the enforced limits." },
  },
  transitions: [{ from: "new", to: "draft", via: "policy records", who: "owner or administrator" }],
});

/** Every state machine, keyed by id. */
export const STATE_MACHINES = {
  payment, payroll, invoice, revenue,
  grant_round: grantRound, grant_application: grantApplication, grant_clarification: grantClarification, grant_risk_flag: grantRiskFlag, grant_funding: grantFunding, grant_evidence: grantEvidence,
  milestone, tender, dispute, proposal,
  workflow, strategy,
  membership, organization, agent, policy,
} as const satisfies Record<string, MachineDef>;
export type MachineId = keyof typeof STATE_MACHINES;

// ------------------------------------------------------------------------------------------------------------ helpers
export const machine = (id: MachineId): MachineDef => STATE_MACHINES[id];
export const machineFor = (table: string, column = "status"): MachineDef | undefined => Object.values(STATE_MACHINES).find((m) => m.table === table && m.column === column);

/** The definition of one state, or a neutral fallback that never throws on an unexpected value. */
export function stateOf(id: MachineId, state: string | null | undefined): StateDef & { known: boolean } {
  const s = state ? (STATE_MACHINES[id].states as Record<string, StateDef>)[state] : undefined;
  return s ? { ...s, known: true } : { label: state ? state.replaceAll("_", " ") : "Unknown", tone: "neutral", meaning: "Not a state this version of Verac knows.", known: false };
}

/** Can a row move from `from` to `to` by some declared path? */
export function canMove(id: MachineId, from: string, to: string): boolean {
  return STATE_MACHINES[id].transitions.some((t) => t.to === to && t.from !== "new" && t.from.includes(from));
}

/** Every move available from a state, with who can make it: what happens next. */
export function nextMoves(id: MachineId, from: string): TransitionDef[] {
  return STATE_MACHINES[id].transitions.filter((t) => t.from !== "new" && t.from.includes(from));
}

/** Plain JSON for tools and agents (no functions). */
export function describeMachines() {
  return Object.values(STATE_MACHINES).map((m) => ({
    id: m.id, title: m.title, table: m.table, column: m.column, kind: m.kind,
    states: Object.entries(m.states).map(([key, s]) => ({ key, ...s })),
    transitions: m.transitions.map((t) => ({ ...t, from: t.from === "new" ? "new" : [...t.from] })),
  }));
}

/**
 * docs/STATE_MACHINES.md, generated from this registry (pnpm state:docs). A test fails when the file is out of date, so the
 * document an agent or a new developer reads is always the rules the code follows.
 */
export function renderStateMachinesMarkdown(): string {
  const id = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");
  const out: string[] = [
    "# State machines",
    "",
    "<!-- Generated from packages/shared-types/src/state-machines.ts by `pnpm state:docs`. Do not edit by hand. -->",
    "",
    "Every status or state column in Verac, as one explicit machine. The database allows exactly these states (tested by",
    "replaying every migration), the code writes only declared moves (tested by scanning every write), and the same labels",
    "and colours appear on every page. Agents and tools can read the same rules as JSON from `/api/state-machines`.",
    "",
    "Legend: **terminal** = nothing leaves it; **steady** = rows normally rest there; **reserved** = allowed by the database but",
    "never written by any code today.",
    "",
    "| Machine | Table | States | Moves |",
    "|---|---|---|---|",
    ...Object.values(STATE_MACHINES).map((m) => `| [${m.title}](#${m.id.replace(/_/g, "-")}) | \`${m.table}.${m.column}\` | ${Object.keys(m.states).length} | ${m.transitions.length} |`),
    "",
  ];
  for (const m of Object.values(STATE_MACHINES) as MachineDef[]) {
    out.push(`## ${m.id.replace(/_/g, "-")}`, "", `**${m.title}** · \`${m.table}.${m.column}\` · ${m.kind}`, "");
    if (m.kind === "lifecycle") {
      out.push("```mermaid", "stateDiagram-v2");
      for (const t of m.transitions) {
        if (t.from === "new") out.push(`  [*] --> ${id(t.to)}`);
        else for (const f of t.from) out.push(`  ${id(f)} --> ${id(t.to)}`);
      }
      for (const [k, s] of Object.entries(m.states)) if (s.terminal) out.push(`  ${id(k)} --> [*]`);
      out.push("```", "");
    }
    out.push("| State | Label | Meaning | Notes |", "|---|---|---|---|");
    for (const [k, s] of Object.entries(m.states)) out.push(`| \`${k}\` | ${s.label} | ${s.meaning} | ${[s.terminal ? "terminal" : "", s.steady ? `steady: ${s.steady}` : "", s.reserved ? `reserved: ${s.reserved}` : ""].filter(Boolean).join("; ")} |`);
    out.push("", "| From | To | Via | Who |", "|---|---|---|---|");
    for (const t of m.transitions) out.push(`| ${t.from === "new" ? "(new)" : t.from.map((f) => `\`${f}\``).join(", ")} | \`${t.to}\` | ${t.via} | ${t.who} |`);
    out.push("");
  }
  return out.join("\n") + "\n";
}
