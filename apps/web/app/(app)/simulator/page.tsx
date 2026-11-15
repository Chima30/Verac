import { AddressLookup } from "@/components/address-lookup";
import { Scenarios, type Scenario } from "@/components/simulator/scenarios";
import { Badge, PageHeader, SectionHeading } from "@/components/ui";
import { RUN } from "@/lib/live-run";
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
  const proven = items.filter((i) => i.evidence).length;

  return (
    <>
      <PageHeader title="Quantum Simulator" eyebrow="Security"
        description="What stops a stolen key, a greedy agent or a premature release, step by step. Scenarios backed by a real refused transaction on Diana testnet say so and link to it. The rest are walkthroughs of the rules, clearly marked as not executed."
        badge={<Badge tone="neutral">{proven} OF {items.length} BACKED BY ON-CHAIN EVIDENCE</Badge>} />
      <Scenarios items={items} />

      <SectionHeading id="lookup" title="Inspect a real account" description="Live post-quantum posture of any address on Diana testnet: hybrid key status, QoreSeal key and EVM authorisation window." />
      <AddressLookup focus="pq" />
    </>
  );
}
