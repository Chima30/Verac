import { AddressLookup } from "@/components/address-lookup";
import { Scenarios, type Scenario } from "@/components/simulator/scenarios";
import { Badge, PageHeader, SectionHeading } from "@/components/ui";
import { RUN } from "@/lib/live-run";
import categoryRuns from "../../../../../deployments/category-proofs.json";
import { reader } from "@/lib/server";

export const revalidate = 300;
export const metadata = { title: "Quantum Simulator" };

/** Finds a recorded refusal and re-reads its block from the chain. Returns null if the chain does not confirm the revert. */
async function refusal(labelStart: string, q: ReturnType<typeof reader>, explorer: string): Promise<Scenario["evidence"]> {
  const t = RUN.find((r) => r.expect === "reverted" && r.label.startsWith(labelStart));
  if (!t || t.lane !== "evm") return null;
  try {
    const r = await q.evm.getTransactionReceipt({ hash: t.hash as `0x${string}` });
    if (r.status !== "reverted") return null; // the chain does not back the claim, so it is not shown as evidence
    return { hash: t.hash, reason: t.reason ?? "reverted", block: r.blockNumber.toString(), url: `${explorer}/tx/${t.hash}` };
  } catch {
    return null;
  }
}

export default async function Simulator() {
  const q = reader();
  const explorer = q.endpoints.explorer.replace(/\/$/, "");
  const [cap, recipient, approval, release] = await Promise.all([
    refusal("DENIED: agent tries 15 QOR", q, explorer),
    refusal("DENIED: agent pays an unapproved recipient", q, explorer),
    refusal("DENIED: agent funds escrow 60 QOR without approval", q, explorer),
    refusal("DENIED: release before reviewer approval", q, explorer),
  ]);

  const items: Scenario[] = [
    {
      id: "key", title: "Compromised classical key", evidence: null,
      summary: "An attacker steals an agent's secp256k1 private key, or breaks it with a future quantum computer.",
      steps: [
        { label: "Attacker signs a native transaction with the stolen key", detail: "Native transactions also need the ML-DSA-87 post-quantum signature, which the attacker does not have.", state: "todo" },
        { label: "Chain rejects the native transaction", detail: "Hybrid signature check fails at the ante handler.", state: "blocked" },
        { label: "Attacker tries an EVM transaction instead", detail: "EVM transactions are only admitted inside an authorisation window opened by a hybrid-signed message.", state: "todo" },
        { label: "Rejected while no window is open", detail: "Windows are opened for a deploy or a payment and closed straight after. See the Threat Center for which windows are open now.", state: "blocked" },
        { label: "If a window happens to be open", detail: "The vault still caps each payment and each day, and only approved recipients can be paid.", state: "todo" },
      ],
      next: "Close any open EVM window, pause the vault, revoke the agent's limits, then register a new post-quantum key. The Threat Center lists these steps.",
    },
    {
      id: "cap", title: "Exceeded spending allowance", evidence: cap,
      summary: "An agent with a 10 QOR per-payment cap tries to send 15 QOR.",
      steps: [
        { label: "Agent submits a 15 QOR payment", detail: "Signed by the agent key, inside an authorisation window.", state: "done" },
        { label: "TreasuryVault checks the per-payment cap", detail: "The cap is stored in the contract, so no off-chain check can be skipped.", state: "done" },
        { label: "Contract reverts", detail: "ExceedsPerTxCap(). No QOR moved.", state: cap ? "failed" : "todo" },
      ],
      next: "Nothing to undo. If the payment was legitimate, a person raises the cap or approves the amount explicitly.",
    },
    {
      id: "recipient", title: "Unapproved recipient", evidence: recipient,
      summary: "An agent tries to pay an address that is not on the vault's approved list.",
      steps: [
        { label: "Agent submits a payment to an unknown address", detail: "Amount is within its limits.", state: "done" },
        { label: "Vault requires human approval for unlisted recipients", detail: "No approval exists for this exact payment.", state: "done" },
        { label: "Contract reverts", detail: "InsufficientApprovals(0, 1). No QOR moved.", state: recipient ? "failed" : "todo" },
      ],
      next: "Check why the agent proposed this address (an invoice with a changed payout address is a common sign of fraud).",
    },
    {
      id: "approval", title: "Payment without human approval", evidence: approval,
      summary: "An agent tries to fund a 60 QOR escrow, above its auto-approve amount, before anyone has approved it.",
      steps: [
        { label: "Agent calls the vault to fund escrow", detail: "60 QOR, within its raised cap.", state: "done" },
        { label: "Above auto-approve, so one human approval is required", detail: "The approval must name this exact payment hash.", state: "done" },
        { label: "Contract reverts", detail: "InsufficientApprovals(0, 1).", state: approval ? "failed" : "todo" },
        { label: "A person approves that exact payment, and it then succeeds", detail: "Both transactions are on Live Proof.", state: approval ? "done" : "todo" },
      ],
      next: "None needed; this is the normal path. An agent can never approve its own payment.",
    },
    {
      id: "release", title: "Release before review", evidence: release,
      summary: "Someone tries to release a milestone payment before the reviewer has approved the evidence.",
      steps: [
        { label: "Release is called on MilestoneEscrow", detail: "Milestone is funded but not yet approved.", state: "done" },
        { label: "Escrow checks reviewer approval", detail: "Stored on chain per milestone.", state: "done" },
        { label: "Contract reverts", detail: "NotApproved(). Funds stay in escrow.", state: release ? "failed" : "todo" },
      ],
      next: "Review the evidence on the Milestones page; if it is disputed, open a dispute instead of releasing.",
    },
    {
      id: "expired", title: "Expired authorisation", evidence: null,
      summary: "An agent's spending rule has passed its validUntil time, or a payment approval has expired.",
      steps: [
        { label: "Agent submits a payment after its rule expired", detail: "Each rule has a validUntil timestamp in the vault.", state: "todo" },
        { label: "Vault treats the agent as having no limits", detail: "An expired rule allows nothing.", state: "todo" },
        { label: "Expected: contract reverts", detail: "Not staged on testnet yet. Approvals in Verac also expire and are cancelled.", state: "blocked" },
      ],
      next: "Renew the rule only if the agent still needs it. Rules expiring within 7 days are flagged on the dashboard.",
    },
    {
      id: "revoked", title: "Revoked agent", evidence: null,
      summary: "An administrator has revoked an agent, and something still tries to use it.",
      steps: [
        { label: "Owner calls revokeAgent", detail: "Recorded as an AgentRevoked event on the vault.", state: "todo" },
        { label: "Agent tries to pay", detail: "Its rule is inactive.", state: "todo" },
        { label: "Expected: contract reverts", detail: "Not staged on testnet yet. Revoked rules show on the Treasury page.", state: "blocked" },
      ],
      next: "Find out why the agent was still being called; rotate its key before reinstating it.",
    },
  ];
  // Category scenarios: their evidence comes from runs recorded by category-proofs.ts, or from automated tests here.
  const run = (id: string) => [...(categoryRuns as { runs: Array<{ id: string; txHash?: string; height?: string; actual: string; denial: string | null; rpcError?: string; verifiedAt: string }> }).runs].reverse().find((r) => r.id === id);
  const evidenceOf = (id: string): Pick<Scenario, "evidence" | "rpcRefusal"> => {
    const r = run(id);
    if (!r || /unexpected/i.test(r.actual)) return { evidence: null, rpcRefusal: null };
    if (r.denial === "before-inclusion") return { evidence: null, rpcRefusal: { error: (r.rpcError ?? r.actual).slice(0, 400), recordedAt: r.verifiedAt } };
    if (r.txHash && r.denial === "on-chain") return { evidence: { hash: r.txHash, reason: r.actual, block: r.height ?? null, url: `${explorer}/tx/${r.txHash}` }, rpcRefusal: null };
    return { evidence: null, rpcRefusal: null };
  };
  const planned = "Not yet run on Diana testnet. The proof is scripted (packages/qorechain/scripts/category-proofs.ts) and waits for the owner's approval to broadcast from a dedicated test account.";
  items.push(
    { id: "window-count", title: "Exceeded transaction limit", ...evidenceOf("B-2"),
      summary: "A key that holds a window for one transaction tries to send a second.",
      steps: [
        { label: "Owner opens a window: 60 blocks, 1 transaction", detail: "Hybrid-signed native message; the classical key alone cannot open it.", state: "step" },
        { label: "First EVM transaction is admitted", detail: "The window's remaining count drops to 0.", state: "step" },
        { label: "Second transaction is refused at admission", detail: run("B-2") ? "Recorded below." : planned, state: run("B-2") ? "failed" : "blocked" },
      ], next: "A refused transaction moves nothing. Open a new window only for a new, approved operation." },
    { id: "window-expiry", title: "Expired EVM window", ...evidenceOf("D-1"),
      summary: "A transaction arrives after the window's expiry height. Duration is counted in blocks by the chain, not by a timer in Verac.",
      steps: [
        { label: "Window opened for 3 blocks", detail: "The chain stores the expiry height.", state: "step" },
        { label: "Five blocks pass", detail: "No transaction is sent.", state: "step" },
        { label: "Late transaction is refused", detail: run("D-1") ? "Recorded below." : planned, state: run("D-1") ? "failed" : "blocked" },
      ], next: "Nothing to undo. This is why Verac opens windows only right before an approved payment." },
    { id: "window-target", title: "Unapproved target", ...evidenceOf("E-2"),
      summary: "Inside a window narrowed to the TreasuryVault, the key tries to send to another address.",
      steps: [
        { label: "Window opened with allowedTargets = [TreasuryVault]", detail: "Exactly how Verac's payment agent window is opened.", state: "step" },
        { label: "A call to the vault is admitted", detail: "A harmless read-only call.", state: "step" },
        { label: "A transfer to 0x…dEaD is refused", detail: run("E-2") ? "Recorded below." : planned, state: run("E-2") ? "failed" : "blocked" },
      ], next: "A stolen agent key inside an open window can still only reach the vault, where the contract's own caps apply." },
    { id: "aa-limit", title: "Delegated key over its limit", ...evidenceOf("F-3"),
      summary: "A delegated (abstract-account) key with a 0.1 QOR per-transaction rule tries to send 0.15 QOR.",
      steps: [
        { label: "Owner links an ed25519 key with proof of possession", detail: "Permissions: send only. Rule: 0.1 QOR per transaction, 0.2 QOR per day, uqor only, expires in 24 hours.", state: "step" },
        { label: "Key sends 0.05 QOR: succeeds", detail: "Within the rule.", state: "step" },
        { label: "Key sends 0.15 QOR: execution fails on chain", detail: run("F-3") ? "Recorded below. The envelope can be code 0; the execution result says it failed." : planned, state: run("F-3") ? "failed" : "blocked" },
      ], next: "Revoke the key if it was not expected to try this." },
    { id: "aa-revoked", title: "Revoked authenticator", ...evidenceOf("F-7"),
      summary: "The owner revokes a delegated key; the key then tries to spend.",
      steps: [
        { label: "Owner sends MsgRevokeAuthenticator", detail: "Takes effect at once.", state: "step" },
        { label: "Revoked key tries to send", detail: run("F-7") ? "Recorded below." : planned, state: run("F-7") ? "failed" : "blocked" },
      ], next: "Link a fresh key only after finding out how the old one was used." },
    { id: "duplicate", title: "Duplicate payment", evidence: null,
      localTest: { file: "services/agent-coordinator/src/workflows/invoice-review.test.ts, apps/web/lib/workflows/engine.test.ts", cases: ["duplicate invoice number from the same vendor is rejected", "an invoice that already has a payment request is rejected", "a retried workflow never prepares the same invoice twice"] },
      summary: "The same invoice is submitted twice, or a workflow is retried after a crash.",
      steps: [
        { label: "Security Agent finds an existing request for the invoice", detail: "Or the same amount to the same address within 30 days.", state: "step" },
        { label: "Policy rejects the invoice", detail: "Fixed rule; a model cannot change it.", state: "step" },
        { label: "Database refuses a second request with the same idempotency key", detail: "Unique (organisation, idempotency key).", state: "step" },
      ], next: "Check where the duplicate came from (a resent invoice or a vendor-side error)." },
    { id: "recipient-change", title: "Changed payment recipient", evidence: null,
      localTest: { file: "services/agent-coordinator/src/workflows/invoice-review.test.ts, tests/security/live-execution.test.ts", cases: ["an invoice whose payout differs from the vendor record is held", "an approval is bound to the exact payment hash; a changed recipient is a different payment that needs its own approvals"] },
      summary: "An invoice asks to be paid to a new address, or someone edits a request after it was approved.",
      steps: [
        { label: "Invoice Agent compares with the vendor's approved payout address", detail: "A mismatch is held for review.", state: "step" },
        { label: "Approvals are bound to the payment hash", detail: "Recipient, amount, token, purpose, nonce and expiry are all inside the hash.", state: "step" },
        { label: "The vault checks the recipient again on chain", detail: "Unapproved recipients revert (see the on-chain scenario above).", state: "step" },
      ], next: "Confirm any payout change with the vendor through a channel already on file." },
  );
  const proven = items.filter((i) => i.evidence || i.rpcRefusal).length;

  return (
    <>
      <PageHeader title="Quantum Simulator" eyebrow="Security"
        description="What stops a stolen key, a greedy agent or a premature release, step by step. Scenarios backed by a real refused transaction on Diana testnet say so and link to it. The rest are walkthroughs of the rules, clearly marked as not executed."
        badge={<Badge tone="neutral">{proven} OF {items.length} BACKED BY CHAIN EVIDENCE</Badge>} />
      <Scenarios items={items} />

      <SectionHeading id="lookup" title="Inspect a real account" description="Live post-quantum posture of any address on Diana testnet: hybrid key status, QoreSeal key and EVM authorisation window." />
      <AddressLookup focus="pq" />
    </>
  );
}
