import type { PublicClient } from "viem";
import { reader } from "./server";
import { vaultSnapshot, type VaultSnapshot } from "./vault";

/**
 * Post-quantum and operational posture checks over live testnet data. Every finding comes from a fixed rule applied to
 * something read from the chain. Nothing is estimated and nothing is simulated.
 */
export type Severity = "high" | "medium" | "low" | "ok";
export interface Finding { id: string; severity: Severity; subject: string; title: string; detail: string }

export interface AccountFacts {
  label: string;
  address: string;
  nativeAddress: string;
  pqcRegistered?: boolean;
  possessionProven?: boolean;
  windowLive?: boolean;
  windowRemainingBlocks?: bigint;
  windowRemainingTxs?: bigint;
  windowRemainingValue?: bigint;
  kemRegistered?: boolean;
  hasAccountSpendingRules?: boolean;
  isContract?: boolean;
  errors: string[];
}

export interface Facts {
  accounts: AccountFacts[];
  vault: { paused?: boolean; approverCount?: number; approvalThreshold?: number; balance?: bigint; owner?: string; rules: Array<{ agent: string; active: boolean; perTxCap: bigint; validUntil: number }> };
  nowSeconds: number;
}

const QOR = 10n ** 18n;
const q = (v: bigint) => { const w = v / QOR; const f = (v % QOR).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, ""); return f ? `${w}.${f}` : `${w}`; };

export function assessPosture(f: Facts): Finding[] {
  const out: Finding[] = [];
  const add = (id: string, severity: Severity, subject: string, title: string, detail: string) => out.push({ id, severity, subject, title, detail });

  for (const a of f.accounts) {
    const s = a.label;
    if (a.errors.length) add("read-error", "low", s, "Some checks could not be read", `${a.errors.join("; ")}. The findings below for this account may be incomplete.`);
    if (a.pqcRegistered === false) add("no-pqc", "high", s, "No post-quantum key registered", "Only the classical key protects this account. Anyone who can recover that key, including a future quantum attacker, controls it.");
    else if (a.pqcRegistered) {
      add("pqc-ok", "ok", s, "Post-quantum key registered", "Native transactions from this account must also carry an ML-DSA-87 signature.");
      if (a.possessionProven === false) add("pqc-no-proof", "medium", s, "Key registered without proof of possession", "The chain has no proof that the registrant holds the matching private key.");
    }
    if (a.windowLive) {
      add("window-open", "medium", s, "An EVM authorisation window is open", `While it is open the chain accepts EVM transactions from this account signed with the classical key alone (${a.windowRemainingBlocks ?? "?"} blocks, ${a.windowRemainingTxs ?? "?"} transactions and ${a.windowRemainingValue !== undefined ? q(a.windowRemainingValue) + " QOR" : "an unknown value"} remain). Close it as soon as the work is done.`);
    } else if (a.windowLive === false) {
      add("window-closed", "ok", s, "No EVM window is open", "The chain admits no classical-only EVM transactions from this account right now. Opening a window needs a hybrid-signed message.");
    }
    if (a.kemRegistered === false) add("no-kem", "low", s, "No QoreSeal encryption key registered on chain", "Others cannot look up this account's key to seal data to it. Reading keys in this app work without it.");
    if (a.hasAccountSpendingRules === false) add("no-account-rules", "low", s, "No account-level spending rules on chain", "The chain itself does not cap this account's outflow. Limits come only from contracts such as the TreasuryVault.");
    if (a.isContract === false && a.label.startsWith("Vault owner")) add("owner-single-key", "medium", s, "The vault owner is a single key", "One key can change limits, approvers and recipients. A multi-signature or contract owner removes that single point of failure. Acceptable on testnet, not for real funds.");
  }

  const v = f.vault;
  if (v.paused) add("vault-paused", "medium", "TreasuryVault", "The vault is paused", "All payments are frozen until the owner resumes it.");
  if (v.approverCount !== undefined && v.approverCount < 2) add("one-approver", "medium", "TreasuryVault", `Only ${v.approverCount} human approver on chain`, "With a single approver there is no second person to catch a bad payment at the contract level. Add approvers and raise the threshold.");
  for (const r of v.rules) {
    if (!r.active) continue;
    if (r.validUntil !== 0 && r.validUntil < f.nowSeconds) add("rule-expired", "low", `Agent ${r.agent.slice(0, 8)}…`, "Agent permission has expired", "The agent cannot pay until the owner renews its limits.");
    if (v.balance !== undefined && v.balance > 0n && r.perTxCap * 4n > v.balance) add("cap-vs-balance", "medium", `Agent ${r.agent.slice(0, 8)}…`, "One payment could move over a quarter of the vault", `The per-payment limit is ${q(r.perTxCap)} QOR against a vault balance of ${q(v.balance)} QOR.`);
  }
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2, ok: 3 };
  return out.sort((x, y) => order[x.severity] - order[y.severity]);
}

export interface Posture { ok: boolean; error?: string; findings: Finding[]; facts?: Facts; readAtBlock?: string }

export async function gatherPosture(): Promise<Posture> {
  const snap: VaultSnapshot = await vaultSnapshot();
  if (!snap.ok || !snap.owner) return { ok: false, error: snap.error ?? "The vault could not be read.", findings: [] };
  const r = reader();
  const evm = r.evm as PublicClient;
  const targets = [{ label: "Vault owner", address: snap.owner }, ...snap.rules.map((x, i) => ({ label: `Agent ${i + 1}`, address: x.agent }))];
  const accounts: AccountFacts[] = await Promise.all(targets.map(async (t) => {
    const nativeAddress = r.toNativeAddress(t.address);
    const a: AccountFacts = { label: t.label, address: t.address, nativeAddress, errors: [] };
    const [pqc, win, kem, rules, code] = await Promise.allSettled([r.pqcStatus(nativeAddress), r.evmWindow(nativeAddress), r.kemKey(nativeAddress), r.spendingRules(nativeAddress), evm.getCode({ address: t.address as `0x${string}` })]);
    if (pqc.status === "fulfilled") { a.pqcRegistered = pqc.value.registered; a.possessionProven = pqc.value.possessionProven; } else a.errors.push("PQC status unavailable");
    if (win.status === "fulfilled") { a.windowLive = win.value.live; a.windowRemainingBlocks = BigInt(win.value.remainingBlocks ?? 0); a.windowRemainingTxs = BigInt(win.value.remainingTxs ?? 0); a.windowRemainingValue = BigInt(win.value.remainingValue ?? 0); } else a.errors.push("window status unavailable");
    if (kem.status === "fulfilled") a.kemRegistered = (kem.value as { found?: boolean }).found === true; else a.errors.push("KEM key status unavailable");
    if (rules.status === "fulfilled") a.hasAccountSpendingRules = rules.value.rules.length > 0 || rules.value.authenticatorRules.length > 0; else if (/HTTP 404|not found/i.test(String((rules.reason as Error)?.message ?? rules.reason))) a.hasAccountSpendingRules = false; // no abstract-account record: no account-level rules exist
    else a.errors.push("spending rules unavailable");
    if (code.status === "fulfilled") a.isContract = !!code.value && code.value !== "0x";
    return a;
  }));
  const facts: Facts = {
    accounts,
    vault: { paused: snap.paused, approverCount: snap.approverCount, approvalThreshold: snap.approvalThreshold, balance: snap.balance, owner: snap.owner, rules: snap.rules.map((x) => ({ agent: x.agent, active: x.active, perTxCap: x.perTxCap, validUntil: x.validUntil })) },
    nowSeconds: Math.floor(Date.now() / 1000),
  };
  return { ok: true, findings: assessPosture(facts), facts, readAtBlock: snap.readAtBlock };
}
