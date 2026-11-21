import { AGENTS } from "@qoreops/agent-coordinator";
import { Welcome } from "@/components/welcome";
import { Activity, ArrowRight, Bot, ClipboardCheck, Flag, Gauge, Landmark, Plus, ShieldAlert, ShieldCheck, Waypoints } from "lucide-react";
import Link from "next/link";
import { Suspense, cache } from "react";
import { InteractiveAreaChart } from "@/components/ui/interactive-area-chart";
import { ChartCard, ChartEmpty, ChartSkeleton } from "@/components/charts/chart-card";
import { Badge, Card, CardSkeleton, EmptyState, IconTile, Metric, Notice, ShortHash, Source, Stat, StatRow, StatusDot, type StepState, Steps, btnCls, btnSecondaryCls, fmtUtc, relTime } from "@/components/ui";
import { formatQor } from "@/lib/approvals";
import { orgData as loadOrgData, windowed, type OrgData } from "@/lib/dashboard";
import { liveStatusFlags } from "@/lib/live/config";
import { hasRole } from "@/lib/nav";
import { aiStatus, chainSnapshot, contractSnapshot } from "@/lib/server";
import { gatherPosture } from "@/lib/threats";
import { evenSteps, formatWei, vaultSnapshot as loadVault } from "@/lib/vault";

// One read per request even though several sections use the same data.
const orgData = cache(loadOrgData);
const vaultSnapshot = cache(loadVault);
const contracts = cache(contractSnapshot);

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

const DAY = 86_400_000;
const qorFmt = (s: string) => { const [w, f] = s.split("."); return `${Number(w).toLocaleString("en-US")}${f ? `.${f}` : ""}`; };

/* ---------------------------------------------------------------- 1 + 2: money */
async function Money() {
  const [v, c] = await Promise.all([vaultSnapshot(), contracts()]);
  if (!v.ok) return (
    <Card title="Funds" description="TreasuryVault on Diana testnet">
      <Notice tone="bad" title="Could not read the vault from the chain">{v.error} Nothing is shown instead of a stale number.</Notice>
    </Card>
  );
  const active = v.rules.filter((r) => r.active && r.validUntil * 1000 > Date.now());
  const agentRoom = active.reduce((t, r) => t + r.remainingToday, 0n);
  const escrow = c.rows.find((r) => r.name === "MilestoneEscrow");
  const now = Date.now();
  const hist = v.history;
  const series: Record<string, ReturnType<typeof evenSteps>> = {};
  const w7 = windowed(hist, 7 * DAY, now), w30 = windowed(hist, 30 * DAY, now);
  if (w7.length >= 2) series["7 days"] = evenSteps(w7);
  if (w30.length >= 2) series["30 days"] = evenSteps(w30);
  if (hist.length >= 2) series["All time"] = evenSteps(hist);
  const deposits = v.events.filter((e) => e.kind === "Deposited").length;
  const paid = v.events.filter((e) => e.kind === "PaymentExecuted").length;
  const escrowFunded = v.events.filter((e) => e.kind === "EscrowFunded").length;

  return (
    <>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><span className="label-mono text-muted">Funds · TreasuryVault on Diana testnet{v.paused ? " · paused" : ""}</span><Link href="/treasury" className={btnSecondaryCls}>Open treasury<ArrowRight size={14} aria-hidden /></Link></div>
    <StatRow className="!mb-3">
      <Stat tint="sky" label="Vault balance" value={qorFmt(formatWei(v.balance!))} sub={<>QOR at block {Number(v.readAtBlock).toLocaleString("en-US")}{v.paused ? " · all payments frozen" : ""}</>} />
      <Stat tint="sky" label="Agents may spend today" value={qorFmt(formatWei(agentRoom))} sub={`QOR across ${active.length} active spending rule${active.length === 1 ? "" : "s"}`} />
      <Stat tint="peach" label="Human approvals" value={`${v.approvalThreshold} of ${v.approverCount}`} sub="needed above an agent's auto-approve amount" />
      <Stat tint="mint" label="Vault events" value={String(v.events.length)} sub={`${deposits} deposits · ${paid} payments · ${escrowFunded} escrow`} />
    </StatRow>
    <ChartCard label="Treasury balance"
      footer={<><span className="mr-1.5 font-mono text-[11px] font-medium uppercase text-[#ff8a3d]">Live testnet.</span>Rebuilt from the vault's Deposited, PaymentExecuted and EscrowFunded events, dated by their block timestamps and anchored to the balance read now.</>}>
      {Object.keys(series).length ? <InteractiveAreaChart title="Treasury balance" unit="QOR" data={series} defaultRange={series["30 days"] ? "30 days" : undefined} height={230} />
        : <ChartEmpty title="Not enough history yet">The vault's events do not give two real points to draw. A chart is never filled with estimates.</ChartEmpty>}
    </ChartCard>
    </>
  );
}

/* ---------------------------------------------------------------- 4: what needs me */
function Queue({ d }: { d: OrgData }) {
  const s = d.session;
  if (!s.configured) return <Card icon={ClipboardCheck} tile="amber" title="Needs a decision"><EmptyState title="Organisation records are not connected">Approvals live in Supabase, which is not configured on this server.</EmptyState></Card>;
  if (!s.user) return <Card icon={ClipboardCheck} tile="amber" title="Needs a decision"><EmptyState title="Sign in to see your queue" action={<Link href="/login?next=/dashboard" className={btnCls}>Sign in</Link>}>Payment requests are private to your organisation.</EmptyState></Card>;
  const items = d.queue;
  return (
    <Card icon={ClipboardCheck} tile="amber" title="Needs a decision" description="Payment requests waiting for a person, oldest first."
      right={items.length ? <Badge tone="approval">{items.length} WAITING</Badge> : undefined}
      footer={<Link href="/approvals" className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline">Open the approvals queue<ArrowRight size={13} aria-hidden /></Link>}>
      {d.queueError && <Notice tone="bad" className="mb-3">{d.queueError}</Notice>}
      {items.length === 0 ? (
        <div className="py-6 text-center"><p className="text-[14px] font-medium">Nothing is waiting for you</p><p className="mt-1 text-[13px] text-muted">New payment requests appear here before any money moves.</p></div>
      ) : (
        <ul className="-mx-5 divide-y divide-line">
          {items.map((t) => {
            const expiresSoon = new Date(t.expiresAt).getTime() - Date.now() < 6 * 3600_000;
            return (
              <li key={t.id}>
                <Link href="/approvals" className="block px-5 py-3 hover:bg-surface-2/60">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold tabular-nums">{formatQor(t.amountWei)} <span className="text-[12.5px] font-medium text-muted">QOR</span></p>
                      <p className="mt-0.5 truncate text-[12.5px] text-muted">{t.payroll ? `Payroll, ${t.payroll} recipients` : <>to <ShortHash value={t.recipient} /></>}{t.purpose ? ` · ${t.purpose}` : ""}</p>
                    </div>
                    {t.live ? <Badge tone="live" /> : <Badge tone="sim" />}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                    <span className="font-mono text-[11.5px]">{t.agent}</span>
                    <span>policy v{t.policyVersion}</span>
                    <span className="tabular-nums">{t.approvals} of {t.required} approvals</span>
                    <span>{relTime(t.createdAt)}</span>
                    <span className={expiresSoon ? "text-[var(--warn)]" : ""}>expires {relTime(t.expiresAt)}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- 3: what agents are doing */
const TASK: Record<string, { word: string; tone: "approval" | "failed" | "pending" | "info" | "neutral" }> = {
  AWAITING_HUMAN: { word: "Approval required", tone: "approval" },
  COMPLETED: { word: "Completed", tone: "info" },
  FAILED: { word: "Failed", tone: "failed" },
  QUEUED: { word: "Queued", tone: "pending" },
  RUNNING: { word: "Running", tone: "neutral" },
  PAUSED_AI_UNAVAILABLE: { word: "Paused, AI unavailable", tone: "pending" },
};
function Agents({ d }: { d: OrgData }) {
  const all = Object.values(AGENTS);
  const ai = all.filter((a) => a.usesAi).length;
  const signedIn = !!d.session.org;
  return (
    <Card icon={Activity} tile="violet" title="Agent activity" description={signedIn ? "The latest work items from agents and the payment pipeline." : `${all.length} agents are registered; sign in to see their work.`}
      footer={<span className="flex flex-wrap items-center justify-between gap-2"><span>{all.length} agents · {ai} use Gemini · only PaymentAgent can move funds, through the pipeline</span><Link href="/command-center" className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline">AI workforce<ArrowRight size={13} aria-hidden /></Link></span>}>
      {d.tasksError && <Notice tone="bad" className="mb-3">{d.tasksError}</Notice>}
      {!signedIn ? <p className="py-4 text-[13.5px] text-muted">Agent tasks are private to your organisation.</p>
        : d.tasks.length === 0 ? <p className="py-4 text-[13.5px] text-muted">No agent tasks yet. The payment pipeline creates one each time a payment is requested on <Link href="/approvals">Approvals</Link>.</p> : (
          <ol className="-mx-5 divide-y divide-line">
            {d.tasks.map((t) => {
              const st = TASK[t.state] ?? { word: t.state, tone: "neutral" as const };
              return (
                <li key={t.id} className="flex items-start gap-3 px-5 py-3">
                  <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-surface-2 text-muted"><Bot size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] leading-snug"><span className="font-medium">{t.agent}</span> <span className="text-muted">{t.intent}</span></p>
                    {t.error && <p className="mt-0.5 text-[12.5px] text-[var(--bad)]">{t.error}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                      <StatusDot tone={st.tone}>{st.word}</StatusDot>
                      <span>{relTime(t.updatedAt)}</span>
                      <Link href={t.txId ? "/approvals" : "/tasks"} className="text-accent-text hover:underline">{t.txId ? "View request" : "View task"}</Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      {signedIn && (d.live.submitted + d.live.confirmed + d.live.failed + d.live.rejected > 0) && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4 text-[12.5px]">
          <span className="text-muted">Live testnet payments:</span>
          <StatusDot tone="live">{d.live.confirmed} confirmed</StatusDot>
          {d.live.submitted > 0 && <StatusDot tone="sim">{d.live.submitted} submitted</StatusDot>}
          {d.live.rejected > 0 && <StatusDot tone="failed">{d.live.rejected} rejected</StatusDot>}
          {d.live.failed > 0 && <StatusDot tone="failed">{d.live.failed} failed</StatusDot>}
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- 5: is anything unsafe */
async function Security() {
  const [p, v] = await Promise.all([gatherPosture(), vaultSnapshot()]);
  const flags = liveStatusFlags();
  const count = (s: string) => p.findings.filter((f) => f.severity === s).length;
  const high = count("high"), medium = count("medium");
  const revoked = v.rules.filter((r) => !r.active).length;
  const soon = v.rules.filter((r) => r.active && r.validUntil * 1000 - Date.now() < 7 * DAY);
  const calm = p.ok && high === 0 && !v.paused;
  const rows: Array<{ label: string; value: React.ReactNode; tone?: "bad" | "warn" }> = [
    { label: "Posture findings", value: !p.ok ? "Could not read" : high + medium === 0 ? "None high or medium" : `${high} high · ${medium} medium`, tone: high ? "bad" : medium ? "warn" : undefined },
    { label: "Vault", value: !v.ok ? "Could not read" : v.paused ? "Paused, payments frozen" : "Active", tone: v.paused ? "warn" : undefined },
    { label: "Live execution", value: flags.emergencyStop ? "Emergency stop on" : !flags.switchOn ? "Switched off" : flags.ready ? "On, all keys configured" : `On, ${flags.missing.length} setting${flags.missing.length === 1 ? "" : "s"} missing`, tone: flags.emergencyStop ? "warn" : undefined },
    { label: "Revoked agent rules", value: revoked },
    { label: "Spending rules expiring in 7 days", value: soon.length, tone: soon.length ? "warn" : undefined },
  ];
  return (
    <Card icon={ShieldAlert} tile="red" title="Security" description={calm ? "No high-severity finding on the accounts checked." : "Something here needs attention."}
      right={!p.ok ? <Badge tone="unavailable" /> : high ? <Badge tone="failed">{high} HIGH</Badge> : <Badge tone="live" />}
      footer={<Link href="/threats" className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline">Threat Center<ArrowRight size={13} aria-hidden /></Link>}>
      <dl className="-mx-5 divide-y divide-line text-[13.5px]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4 px-5 py-2.5">
            <dt className="text-muted">{r.label}</dt>
            <dd className={`text-right font-medium tabular-nums ${r.tone === "bad" ? "text-[var(--bad)]" : r.tone === "warn" ? "text-[var(--warn)]" : ""}`}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {p.ok && p.findings.filter((f) => f.severity === "high").slice(0, 2).map((f) => (
        <Notice key={f.id + f.subject} tone="bad" title={f.title} className="mt-4">{f.subject}</Notice>
      ))}
      <Source>Rules applied to accounts read live from Diana testnet{p.readAtBlock ? ` at block ${Number(p.readAtBlock).toLocaleString("en-US")}` : ""}. Incidents are not tracked as records yet; this is posture, not an incident log.</Source>
    </Card>
  );
}

/* ---------------------------------------------------------------- 1: how is the organisation doing (operations) */
function Operations({ d }: { d: OrgData }) {
  if (!d.session.org) return null;
  const t = d.ops.tenders;
  const stages: Array<[string, string]> = [["draft", "Draft"], ["open", "Open for bids"], ["review", "Reviewing bids"], ["awarded", "Awarded"], ["closed", "Closed"]];
  const totalT = Object.values(t).reduce((a, b) => a + b, 0);
  return (
    <Card icon={Waypoints} tile="orange" title="Operations" description="Grant rounds and milestones in progress in this organisation.">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Metric label={<Link href="/grants" className="hover:text-ink">Open grant rounds</Link>} value={d.ops.grantsOpen} sub={d.ops.grantsOpen ? `${formatQor(d.ops.grantsBudgetWei.toString())} QOR budget` : undefined} />
        <Metric label={<Link href="/milestones" className="hover:text-ink">Milestones to review</Link>} value={d.ops.milestonesToReview} tone={d.ops.milestonesToReview ? "warn" : undefined} />
      </dl>
      <div className="mt-5 border-t border-line pt-4">
        <h3 className="text-[12px] font-semibold text-subtle">Labs <span className="font-normal">· not agent-driven, no live proof yet</span></h3>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted">
          <li><Link href="/procurement" className="hover:text-ink">{totalT} tender{totalT === 1 ? "" : "s"}</Link>{totalT ? ` (${stages.filter(([k]) => t[k]).map(([k, l]) => `${t[k]} ${l.toLowerCase()}`).join(", ")})` : ""}</li>
          <li><Link href="/governance" className="hover:text-ink">{d.ops.proposalsVoting} proposal{d.ops.proposalsVoting === 1 ? "" : "s"} in voting</Link></li>
          <li><Link href="/disputes" className="hover:text-ink">{d.ops.disputesOpen} open dispute{d.ops.disputesOpen === 1 ? "" : "s"}</Link></li>
        </ul>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- setup progress */
function Setup({ d }: { d: OrgData }) {
  const s = d.session;
  if (!s.org) return null;
  const flags = liveStatusFlags();
  const items: Array<{ label: string; detail: string; done: boolean; href: string }> = [
    { label: "Create your organisation", detail: `${s.org.name}, you are ${s.org.role.replaceAll("_", " ")}.`, done: true, href: "/settings/organization" },
    { label: "Link a treasury address", detail: "So payments and balances are tied to your vault.", done: !!s.org.treasuryAddress, href: "/settings/organization" },
    { label: "Add a second member", detail: "A person can never approve their own request, so approvals need two people.", done: (d.members ?? 0) > 1, href: "/settings/team" },
    { label: "Connect a QoreX wallet", detail: "Lets you check addresses and sign from your own wallet. Keys never enter this site.", done: false, href: "/settings/wallets" },
    { label: "Publish a reading key", detail: "Needed to open sealed bids and encrypted documents.", done: !!d.reviewerKey, href: "/procurement" },
    { label: "Turn on live execution", detail: "Server configuration; until then payments are recorded but never sent.", done: flags.ready, href: "/settings/integrations" },
  ];
  // The wallet step cannot be checked on the server (the wallet lives in the browser), so it never counts as missing.
  const counted = items.filter((i) => i.href !== "/settings/wallets");
  const done = counted.filter((i) => i.done).length;
  if (done === counted.length) return null;
  const firstOpen = items.findIndex((i) => !i.done && i.href !== "/settings/wallets");
  return (
    <details className="group mb-6 rounded-lg border border-line bg-surface shadow-card" open={done < 3}>
      <summary className="flex items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">Finish setting up {s.org.name}</p>
          <p className="text-[12.5px] text-muted">{done} of {counted.length} steps done. You can come back to any step.</p>
        </div>
        <div aria-hidden className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-surface-3 sm:block"><div className="h-full rounded-full bg-accent" style={{ width: `${(done / counted.length) * 100}%` }} /></div>
        <span className="text-[12.5px] text-muted group-open:hidden">Show</span><span className="hidden text-[12.5px] text-muted group-open:inline">Hide</span>
      </summary>
      <div className="grid gap-x-8 border-t border-line px-5 py-4 md:grid-cols-2">
        <Steps compact steps={items.slice(0, 3).map((i, k) => ({ label: <Link href={i.href} className="hover:underline">{i.label}</Link>, detail: i.detail, state: (i.done ? "done" : k === firstOpen ? "current" : "todo") as StepState }))} />
        <div className="mt-3 md:mt-0"><Steps compact steps={items.slice(3).map((i, k) => ({ label: <Link href={i.href} className="hover:underline">{i.label}</Link>, detail: i.href === "/settings/wallets" ? `${i.detail} Checked in your browser, not here.` : i.detail, state: (i.done ? "done" : k + 3 === firstOpen ? "current" : "todo") as StepState }))} /></div>
      </div>
    </details>
  );
}

/* ---------------------------------------------------------------- system */
async function System() {
  const [chain, cs] = await Promise.all([chainSnapshot(), contracts()]);
  const ai = aiStatus();
  const flags = liveStatusFlags();
  const missing = cs.rows.filter((r) => r.hasCode === false).length;
  return (
    <details className="group rounded-lg border border-line bg-surface shadow-card">
      <summary className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 text-[13px]">
        <span className="font-semibold">System</span>
        <StatusDot tone={chain.ok ? "live" : "failed"}>Diana testnet {chain.ok ? `block ${Number(chain.block).toLocaleString("en-US")}` : "unreachable"}</StatusDot>
        <StatusDot tone={ai.status === "configured" ? "live" : "unavailable"}>Gemini {ai.status === "configured" ? ai.model : "not configured"}</StatusDot>
        <StatusDot tone={missing ? "failed" : cs.error ? "unavailable" : "live"}>{cs.rows.length} contracts{missing ? `, ${missing} without code` : cs.error ? ", not checked" : " deployed"}</StatusDot>
        <StatusDot tone={flags.emergencyStop ? "approval" : flags.ready ? "live" : "unavailable"}>Live execution {flags.emergencyStop ? "stopped" : flags.ready ? "ready" : flags.switchOn ? "incomplete" : "off"}</StatusDot>
        <span className="ml-auto text-[12.5px] text-muted group-open:hidden">Details</span><span className="ml-auto hidden text-[12.5px] text-muted group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-line px-5 py-4">
        <div className="overflow-x-auto">
          <table className="data-table min-w-[36rem]">
            <thead><tr><th>Contract</th><th>Address</th><th>Code on-chain</th><th className="num">Balance (QOR)</th></tr></thead>
            <tbody>{cs.rows.map((c) => (
              <tr key={c.name}><td className="font-medium">{c.name}</td><td><ShortHash value={c.address} head={10} tail={8} /></td>
                <td>{c.hasCode === null ? <StatusDot tone="unavailable">unknown</StatusDot> : c.hasCode ? <StatusDot tone="live">yes</StatusDot> : <StatusDot tone="failed">no code</StatusDot>}</td>
                <td className="num font-mono text-[12.5px]">{c.balanceQor ?? "n/a"}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <Source>Chain id {chain.chainId ?? "n/a"} · mainnet is refused at startup · abstract accounts {chain.aa ? (chain.aa.enabled ? `enabled (max ${chain.aa.maxSessionKeys} session keys)` : "disabled") : "unknown"}. Contracts are not source-verified on an explorer and have had no external audit.</Source>
      </div>
    </details>
  );
}

/* ---------------------------------------------------------------- page */
async function OrgSections() {
  const d = await orgData();
  return (
    <>
      <Setup d={d} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="min-w-0 space-y-5 xl:col-span-8">
          <Suspense fallback={<><CardSkeleton rows={4} className="h-[17rem]" label="Reading the vault" /><ChartSkeleton height={230} /></>}><Money /></Suspense>
          <Operations d={d} />
        </div>
        <div className="min-w-0 space-y-5 xl:col-span-4">
          <Queue d={d} />
          <Suspense fallback={<CardSkeleton rows={5} label="Checking security posture" />}><Security /></Suspense>
        </div>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8"><Agents d={d} /></div>
        <div className="min-w-0 xl:col-span-4"><WhatThisIs /></div>
      </div>
    </>
  );
}

function WhatThisIs() {
  return (
    <Card icon={ShieldCheck} tile="teal" title="Reading this page">
      <ul className="space-y-3 text-[13px] leading-relaxed text-muted">
        <li className="flex gap-2.5"><Badge tone="live" /><span>Read from Diana testnet or confirmed there.</span></li>
        <li className="flex gap-2.5"><Badge tone="sim" /><span>Recorded in Verac only. No QOR moves.</span></li>
        <li className="flex gap-2.5"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-subtle" aria-hidden /><span>AI suggests and drafts. Fixed rules and people decide, and the contracts enforce limits on chain.</span></li>
      </ul>
      <Source>Everything on this page is testnet. Mainnet is disabled.</Source>
    </Card>
  );
}

async function Header() {
  const d = await orgData();
  const role = d.session.org?.role ?? null;
  const actions = [
    hasRole(role, "finance") && <Link key="pay" href="/approvals#request" className={btnCls}><Plus size={15} aria-hidden />Request payment</Link>,
    hasRole(role, "admin") && <Link key="g" href="/grants#create" className={btnSecondaryCls}><Flag size={15} aria-hidden />New grant round</Link>,
    <Link key="ai" href="/command-center" className={btnSecondaryCls}><Bot size={15} aria-hidden />Ask Verac AI</Link>,
  ].filter(Boolean);
  const greeting = d.session.org ? d.session.org.name : "Dashboard";
  const pending = d.queue.length;
  return (
    <header className="mb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="label-mono flex flex-wrap items-center gap-x-3 gap-y-1 text-muted"><span>{greeting}</span><span aria-hidden>·</span><span>Diana testnet</span><span aria-hidden>·</span><span>Read at {fmtUtc(Date.now())}</span></p>
        <div className="flex flex-wrap items-center gap-2">{actions}{pending > 0 && <Link href="/approvals" className={`${btnSecondaryCls} md:hidden`}><ClipboardCheck size={15} aria-hidden />Review {pending}</Link>}</div>
      </div>
      <h1 className="mt-8 text-[40px] font-medium leading-[1.1] tracking-[-0.025em] sm:text-[56px] lg:text-[64px] lg:tracking-[-0.03em]">Agents prepare the work.<span className="block text-muted">People decide. The chain enforces.</span></h1>
      <p className="mt-5 max-w-2xl text-[18px] leading-[1.3] tracking-[-0.01em] text-muted">
        {!d.session.configured ? "Funds, agents and security on Diana testnet. Organisation records are not connected on this server, so approvals and tasks are hidden."
          : !d.session.user ? "Funds, agents and security on Diana testnet. Sign in to see your organisation's approvals and agent work."
            : pending ? <>{pending} payment request{pending === 1 ? " is" : "s are"} waiting for a decision.</> : "Nothing is waiting for your decision."}
      </p>
    </header>
  );
}

export default function Dashboard() {
  return (
    <>
      <Suspense fallback={<div className="mb-7 h-[5.5rem]" />}><Header /></Suspense>
      <Welcome />
      <Suspense fallback={<div className="grid grid-cols-1 gap-5 xl:grid-cols-12"><CardSkeleton rows={8} className="h-[30rem] xl:col-span-8" /><CardSkeleton rows={6} className="xl:col-span-4" /></div>}>
        <OrgSections />
      </Suspense>
      <div className="mt-5"><Suspense fallback={<CardSkeleton rows={1} label="Checking system status" />}><System /></Suspense></div>
    </>
  );
}
