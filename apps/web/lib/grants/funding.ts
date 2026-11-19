/**
 * SERVER ONLY. Grant milestones: the Milestone Agent's evidence check, and funding requests.
 *
 * Funding never bypasses the treasury. For an approved milestone, Verac reads the configured vault's real limits:
 *   - TreasuryVault V2 (administrators sign every payment): recipient approved, per-payment cap, remaining daily allowance,
 *     not paused. If all hold, it creates a normal V2 payment request (administrators then sign it in Approvals).
 *   - Otherwise it records "awaiting an authorised funding path" with the exact reasons. A milestone is never split to
 *     fit an agent's cap, and no unrestricted wallet is used.
 * The milestone becomes 'released' only when that payment is confirmed on chain (database trigger, migration 0021).
 */
import { chainEvidence, githubEvidence, githubGetter, githubLinkEvidence, parseRepo, type Evidence } from "@qoreops/agent-coordinator";
import { htmlToText, safeFetch } from "@qoreops/agent-coordinator/src/grants/safe-fetch";
import { webEvidence } from "@qoreops/agent-coordinator";
import { ChainExecution, treasuryVaultV2Abi } from "@qoreops/qorechain";
import { serviceClient, type RpcClient } from "@/lib/live/service";
import { proposeLivePaymentV2, v2Flags } from "@/lib/live/v2";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const fmt = (wei: bigint) => (Number(wei / 10n ** 12n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });

/** MilestoneAgent: checks the links and transactions in the latest evidence submission. Writes findings; never approves. */
export async function checkMilestoneEvidence(orgId: string, msId: string): Promise<{ ok: true; items: number } | { ok: false; error: string }> {
  const sb = serviceClient();
  const { data: m } = await sb.from("milestones").select("id,parent_id,parent_type,organization_id").eq("id", msId).eq("organization_id", orgId).maybeSingle();
  if (!m || m.parent_type !== "grant") return { ok: false, error: "Grant milestone not found." };
  const { data: sub } = await sb.from("grant_milestone_submissions").select("attempt,links,transactions").eq("milestone_id", msId).order("attempt", { ascending: false }).limit(1).maybeSingle();
  if (!sub) return { ok: false, error: "No evidence has been submitted for this milestone." };
  const { data: app } = await sb.from("grant_applications").select("version").eq("id", m.parent_id).single();
  const get = githubGetter(process.env.GITHUB_TOKEN?.trim() || undefined);
  const out: Evidence[] = [];
  for (const url of ((sub.links as string[]) ?? []).slice(0, 10)) {
    const link = await githubLinkEvidence(url, get);
    if (link) { out.push(link); continue; }
    if (parseRepo(url)) { out.push(...(await githubEvidence(url, get))); continue; }
    out.push(await webEvidence(url, safeFetch, (h) => htmlToText(h, 2000)));
  }
  const txs = ((sub.transactions as string[]) ?? []).slice(0, 10);
  if (txs.length) {
    const evm = new ChainExecution().evm;
    out.push(...(await chainEvidence({
      chainId: () => evm.getChainId(), getCode: (a) => evm.getCode({ address: a as `0x${string}` }),
      getReceipt: async (h) => { try { const r = await evm.getTransactionReceipt({ hash: h as `0x${string}` }); return { status: r.status, blockNumber: r.blockNumber, to: r.to, from: r.from }; } catch { return null; } },
    }, [], txs)));
  }
  if (out.length) {
    const { error } = await sb.from("grant_evidence").insert(out.map((e) => ({
      organization_id: orgId, application_id: m.parent_id, milestone_id: msId, application_version: (app?.version as number) || 1,
      source: e.source, subject: e.subject.slice(0, 300), claim: `Milestone evidence (attempt ${sub.attempt}): ${e.claim}`.slice(0, 300), status: e.status, reason: e.reason.slice(0, 1000), observed: e.observed, url: e.url.slice(0, 500), retrieved_at: e.retrievedAt,
    })));
    if (error) return { ok: false, error: error.message };
  }
  await sb.from("audit_events").insert({ organization_id: orgId, actor: "MilestoneAgent", action: "grant.milestone_evidence_checked", subject: msId, detail: { attempt: sub.attempt, items: out.length } });
  return { ok: true, items: out.length };
}

export type FundingOutcome = { kind: "requested"; transactionId: string; route: "treasury_v2" } | { kind: "awaiting"; reasons: string[] } | { kind: "error"; error: string };

/** Asks the treasury to pay an approved milestone, only through a restricted path whose real limits allow it. */
export async function requestMilestoneFunding(userClient: RpcClient, orgId: string, userId: string, msId: string): Promise<FundingOutcome> {
  const sb = serviceClient();
  const { data: m } = await sb.from("milestones").select("id,parent_id,parent_type,idx,title,status,amount::text").eq("id", msId).eq("organization_id", orgId).maybeSingle();
  if (!m || m.parent_type !== "grant") return { kind: "error", error: "Grant milestone not found." };
  if (m.status !== "approved") return { kind: "error", error: `The milestone is ${m.status}; only an approved milestone can be funded.` };
  const { data: app } = await sb.from("grant_applications").select("id,recipient_address,applicant_name").eq("id", m.parent_id).single();
  const recipient = app?.recipient_address as Hex | null;
  const amount = BigInt(String(m.amount).split(".")[0]!);
  const reasons: string[] = [];
  if (!recipient) reasons.push("The application has no recipient address.");

  const f = v2Flags();
  if (!f.ready || !f.switchOn) reasons.push("TreasuryVault V2 (administrator-signed payments) is not configured or live execution is switched off on this deployment.");
  else if (recipient) {
    const evm = new ChainExecution().evm;
    const vault = f.vault!;
    const agent = privateKeyToAccount(process.env.V2_AGENT_EVM_PRIVATE_KEY!.trim() as Hex).address;
    const read = <T>(fn: string, args: readonly unknown[] = []) => evm.readContract({ address: vault, abi: treasuryVaultV2Abi, functionName: fn, args } as never) as Promise<T>;
    const [lim, remaining, approved, paused] = await Promise.all([
      read<readonly [boolean, bigint, bigint, bigint]>("limits", [agent, NATIVE]), read<bigint>("remainingDaily", [agent, NATIVE]),
      read<boolean>("approvedRecipient", [recipient]), read<boolean>("paused"),
    ]);
    if (paused) reasons.push("TreasuryVault V2 is paused by its guardian.");
    if (!lim[0] || lim[1] < BigInt(Math.floor(Date.now() / 1000))) reasons.push("The payment agent's rights on TreasuryVault V2 are not active.");
    if (amount > lim[2]) reasons.push(`${fmt(amount)} QOR is above the agent's ${fmt(lim[2])} QOR per-payment cap on TreasuryVault V2. Grants are not split to fit a cap; this needs an authorised funding path (two administrators raising the limit for this payment, or a treasury-funded escrow).`);
    else if (amount > remaining) reasons.push(`${fmt(amount)} QOR is above the agent's remaining daily allowance (${fmt(remaining)} QOR). Try again tomorrow, or use an authorised funding path.`);
    if (!approved) reasons.push(`The recipient ${recipient} is not an approved recipient on TreasuryVault V2. Two administrators must approve it there first.`);
  }

  if (reasons.length) {
    const { error } = await sb.rpc("record_grant_funding", { p_ms: msId, p_status: "awaiting_authorised_path", p_route: "none", p_reasons: reasons, p_transaction: null, p_by: userId });
    if (error) return { kind: "error", error: error.message };
    return { kind: "awaiting", reasons };
  }
  const amountQor = (Number(amount / 10n ** 12n) / 1e6).toString();
  const r = await proposeLivePaymentV2(userClient, orgId, { recipient, amountQor, purpose: `Grant milestone ${m.idx}: ${m.title}`.slice(0, 120), idempotencyKey: `gms-${msId}`.slice(0, 64) }, { grant_milestone_id: msId, application_id: app!.id });
  if (!r.ok) {
    const { error } = await sb.rpc("record_grant_funding", { p_ms: msId, p_status: "awaiting_authorised_path", p_route: "none", p_reasons: [r.error], p_transaction: null, p_by: userId });
    return error ? { kind: "error", error: error.message } : { kind: "awaiting", reasons: [r.error] };
  }
  const { error } = await sb.rpc("record_grant_funding", { p_ms: msId, p_status: "requested", p_route: "treasury_v2", p_reasons: [], p_transaction: r.id, p_by: userId });
  if (error) return { kind: "error", error: error.message };
  return { kind: "requested", transactionId: r.id, route: "treasury_v2" };
}
