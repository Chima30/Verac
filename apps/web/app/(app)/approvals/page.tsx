import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader, btnCls, inputCls } from "@/components/ui";
import { buildProposal, formatQor, hashMatches, STATE_TONE } from "@/lib/approvals";
import { LivePayments } from "@/components/live/live-payments";
import { liveOperations } from "@/lib/live/list";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals" };

const FINANCE = ["owner", "administrator", "finance_manager"];
const back = (kind: "msg" | "error", text: string): never => redirect(`/approvals?${kind}=${encodeURIComponent(text)}`);

async function requestApproval(formData: FormData) {
  "use server";
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/approvals");
  const to = String(formData.get("to") ?? "").trim();
  const amount = Number(formData.get("amount"));
  const purpose = String(formData.get("purpose") ?? "").trim();
  const required = Number(formData.get("required"));
  const hours = Number(formData.get("hours"));
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) back("error", "Recipient must be a 0x address (40 hex characters).");
  if (!(amount > 0) || amount > 1_000_000) back("error", "Amount must be above 0 and at most 1,000,000 QOR.");
  if (purpose.length < 3 || purpose.length > 280) back("error", "Describe the purpose in 3 to 280 characters.");
  if (!Number.isInteger(required) || required < 1 || required > 10) back("error", "Approvals needed must be 1 to 10.");
  if (!(hours > 0) || hours > 168) back("error", "Validity must be up to 168 hours (7 days).");
  let built;
  try { built = buildProposal(s.org!.id, { to, amountQor: amount, purpose, validHours: hours }); } catch (e) { return back("error", e instanceof Error ? e.message : "Could not build the payment."); }
  const { proposal, hash, weiAmount } = built;
  const { error } = await sb!.rpc("request_payment_approval", {
    p_org: s.org!.id, p_idempotency_key: proposal.idempotencyKey, p_agent_id: "PaymentAgent", p_payment_hash: hash, p_token: proposal.token,
    p_recipient: proposal.to, p_amount: weiAmount, p_policy_version: proposal.policyVersion, p_expires_at: new Date(proposal.expiry * 1000).toISOString(),
    p_required: required, p_evaluation: { proposal, purpose },
  });
  if (error) back("error", error.message);
  back("msg", "Request created and waiting for approval. It is a simulation: nothing is sent to the chain.");
}

async function decide(formData: FormData) {
  "use server";
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/approvals");
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  // Re-verify the binding on the server: refuse to approve anything whose stored hash does not match its stored fields.
  const { data: tx } = await sb!.from("transactions").select("payment_hash, evaluation").eq("id", id).maybeSingle();
  if (!tx) back("error", "Request not found.");
  if (decision === "approve" && !hashMatches(tx!.payment_hash, tx!.evaluation, s.org!.id)) back("error", "Hash check failed: the stored payment does not match its hash. Not approved.");
  const { data, error } = await sb!.rpc("decide_payment", { p_tx: id, p_decision: decision, p_note: null });
  if (error) back("error", error.message);
  back("msg", data === "CANCELLED" ? "That request had expired and was cancelled." : `Recorded. Request is now ${data}.`);
}

interface Tx { id: string; state: string; recipient: string; amount: string; payment_hash: string; required_approvals: number; expires_at: string; requested_by: string | null; evaluation: unknown; source: string; created_at: string }
interface Appr { subject_id: string; approver: string; decision: string }

export default async function Approvals({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Approvals" description="Human approval queue." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">Approvals live in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/approvals");
  if (!s.org) redirect("/onboarding");
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: txs, error } = await sb!.from("transactions").select("id,state,recipient,amount,payment_hash,required_approvals,expires_at,requested_by,evaluation,source,created_at").eq("organization_id", s.org.id).is("calldata_hash", null).order("created_at", { ascending: false }).limit(50); // live operations (which carry a calldata hash) are decided in the Live payments card, never here
  const list = (txs ?? []) as unknown as Tx[];
  const live = await liveOperations();
  const { data: ap } = list.length ? await sb!.from("approvals").select("subject_id,approver,decision").in("subject_id", list.map((t) => t.id)) : { data: [] };
  const approvals = (ap ?? []) as Appr[];
  const canAct = FINANCE.includes(s.org.role);
  const me = s.user.id;

  return (
    <>
      <PageHeader title="Approvals" description="Payments that need a human yes. Each request is tied to its exact amount, recipient and expiry by a hash that is re-checked before you can approve. The person who made a request can never approve it." badge={<Badge tone="sim" />} />
      {sp.msg && <p role="status" className="mb-4 rounded-md border border-line bg-surface px-3 py-2 text-sm">{sp.msg}</p>}
      {(sp.error || error) && <p role="alert" className="mb-4 text-sm text-[var(--bad)]">{sp.error ?? error?.message}</p>}

      <div className="mb-6">
        <Card title="Live testnet payments" right={<Badge tone="live">LIVE TESTNET</Badge>}>
          <LivePayments
            ops={live.ops}
            canRequest={canAct}
            canDecide={["owner", "administrator"].includes(s.org.role)}
            explorer="https://explore.qore.network"
            status={live.status}
          />
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-medium text-muted">Simulated requests (nothing is sent to the chain)</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {list.length === 0 ? <EmptyState title="No requests yet">Create a test request on the right. You need a second finance member to approve it, because you cannot approve your own.</EmptyState> : list.map((t) => {
            const mine = t.requested_by === me;
            const decisions = approvals.filter((a) => a.subject_id === t.id);
            const iDecided = decisions.some((a) => a.approver === me);
            const ok = hashMatches(t.payment_hash, t.evaluation, s.org!.id);
            const payroll = (t.evaluation as { payroll?: { period: string; items: Array<{ name: string; address: string; amountQor: number }> } } | null)?.payroll;
            const purpose = (t.evaluation as { purpose?: string } | null)?.purpose;
            const open = t.state === "AWAITING_APPROVAL";
            return (
              <Card key={t.id} title={`${formatQor(t.amount)} QOR`} right={<span className="flex gap-2"><Badge tone={STATE_TONE[t.state] ?? "neutral"}>{t.state.replace("_", " ")}</Badge><Badge tone="sim" /></span>}>
                <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
                  <dt className="text-muted">To</dt><dd className="break-all font-mono text-xs">{payroll ? `Payroll ${payroll.period}: ${payroll.items.length} recipients` : t.recipient}</dd>
                  {payroll && (<><dt className="text-muted">Lines</dt><dd><ul className="space-y-0.5 text-xs">{payroll.items.map((l, i) => <li key={i} className="flex flex-wrap justify-between gap-2"><span>{l.name} <span className="break-all font-mono text-muted">{l.address}</span></span><span>{l.amountQor} QOR</span></li>)}</ul></dd></>)}
                  <dt className="text-muted">Purpose</dt><dd>{purpose ?? "-"}</dd>
                  <dt className="text-muted">Approvals</dt><dd>{decisions.filter((d) => d.decision === "approve").length} of {t.required_approvals} needed{decisions.some((d) => d.decision === "reject") ? ", rejected" : ""}</dd>
                  <dt className="text-muted">Expires</dt><dd>{new Date(t.expires_at).toISOString().replace("T", " ").slice(0, 16)} UTC</dd>
                  <dt className="text-muted">Hash check</dt><dd>{ok ? <span className="text-[var(--live)]">Matches the stored fields</span> : <span className="text-[var(--bad)]">DOES NOT MATCH, do not approve</span>} <span className="break-all font-mono text-xs text-muted">{t.payment_hash.slice(0, 18)}…</span></dd>
                </dl>
                {open && canAct && (
                  mine ? <p className="mt-3 text-sm text-muted">You made this request, so someone else has to decide it.</p>
                  : iDecided ? <p className="mt-3 text-sm text-muted">You have already decided this request.</p>
                  : (
                    <form action={decide} className="mt-3 flex gap-2">
                      <input type="hidden" name="id" value={t.id} />
                      <button name="decision" value="approve" className={btnCls}>Approve</button>
                      <button name="decision" value="reject" className="inline-flex items-center rounded-md border border-line px-3.5 py-2 text-sm hover:bg-[var(--neutral-bg)]">Reject</button>
                    </form>
                  )
                )}
                {open && !canAct && <p className="mt-3 text-sm text-muted">Your role ({s.org!.role}) cannot decide payments.</p>}
                {t.state === "APPROVED" && <p className="mt-3 text-sm text-muted">Approved in this app only. Nothing has been executed on chain.</p>}
              </Card>
            );
          })}
        </div>

        <Card title="Create a test request">
          {!canAct ? <p className="text-sm text-muted">Only finance roles can create requests.</p> : (
            <form action={requestApproval} className="space-y-3">
              <div><label htmlFor="to" className="mb-1 block text-xs text-muted">Recipient (0x…)</label><input id="to" name="to" required className={inputCls} placeholder="0x…" /></div>
              <div><label htmlFor="amount" className="mb-1 block text-xs text-muted">Amount (QOR)</label><input id="amount" name="amount" required inputMode="decimal" className={inputCls} defaultValue="5" /></div>
              <div><label htmlFor="purpose" className="mb-1 block text-xs text-muted">Purpose</label><input id="purpose" name="purpose" required minLength={3} maxLength={280} className={inputCls} placeholder="October design work" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label htmlFor="required" className="mb-1 block text-xs text-muted">Approvals needed</label><input id="required" name="required" type="number" min={1} max={10} defaultValue={1} className={inputCls} /></div>
                <div><label htmlFor="hours" className="mb-1 block text-xs text-muted">Valid for (hours)</label><input id="hours" name="hours" type="number" min={1} max={168} defaultValue={24} className={inputCls} /></div>
              </div>
              <button className={btnCls} type="submit">Request approval</button>
              <p className="text-xs text-muted">Simulation: it records the request, the decisions and an audit trail. It does not move any QOR.</p>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
