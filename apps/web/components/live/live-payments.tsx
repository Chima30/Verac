"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, btnCls, inputCls, type Tone } from "@/components/ui";

export interface LiveOp {
  id: string; state: string; recipient: string; amount: string; required: number; approvals: number; requestedByMe: boolean;
  paymentHash: string; txHash: string | null; approvalTx: string | null; block: number | null; failure: string | null; purpose: string | null; expiresAt: string;
}

// The states a reader sees. READY means the server has claimed the operation and is sending it.
const LABEL: Record<string, { text: string; tone: Tone }> = {
  PROPOSED: { text: "PROPOSED", tone: "pending" },
  AWAITING_APPROVAL: { text: "AWAITING APPROVAL", tone: "approval" },
  APPROVED: { text: "APPROVED", tone: "neutral" },
  READY: { text: "APPROVED, EXECUTING", tone: "neutral" },
  SUBMITTED: { text: "SUBMITTED", tone: "sim" },
  CONFIRMED: { text: "CONFIRMED, LIVE TESTNET", tone: "live" },
  REJECTED: { text: "REJECTED", tone: "failed" },
  FAILED: { text: "FAILED", tone: "failed" },
  CANCELLED: { text: "EXPIRED", tone: "pending" },
};

const qor = (wei: string) => {
  const n = BigInt(wei);
  const frac = (n % 10n ** 18n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return `${n / 10n ** 18n}${frac ? "." + frac : ""}`;
};
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;

export function LivePayments({ ops, canRequest, canDecide, explorer, status }: {
  ops: LiveOp[]; canRequest: boolean; canDecide: boolean; explorer: string;
  status: { switchOn: boolean; ready: boolean; missing: string[] };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ recipient: "", amountQor: "", purpose: "" });
  const txUrl = (h: string) => `${explorer.replace(/\/$/, "")}/tx/${h}`;

  async function call(path: string, body: unknown, label: string, okText: (j: Record<string, unknown>) => string): Promise<boolean> {
    setBusy(label); setMsg(null);
    let ok = false;
    try {
      const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; result?: { state?: string; reason?: string } } & Record<string, unknown>;
      if (!r.ok) setMsg({ ok: false, text: j.error ?? "The request failed." });
      else if (j.result?.state === "FAILED") setMsg({ ok: false, text: `Not paid: ${j.result.reason ?? "the chain refused it"}` });
      else { setMsg({ ok: true, text: okText(j) }); ok = true; }
      router.refresh();
    } catch { setMsg({ ok: false, text: "Network error. Nothing was changed." }); }
    setBusy(null);
    return ok;
  }

  return (
    <div className="space-y-4">
      {(!status.switchOn || !status.ready) && (
        <p className="rounded-lg border border-line bg-surface px-5 py-3 text-sm text-muted">
          Live execution is {status.switchOn ? "switched on but not fully configured" : "switched off"} on this deployment, so approved payments cannot be sent yet. Requests and approvals still work and are recorded.
          {status.missing.length > 0 && <> Missing server settings: <span className="font-mono">{status.missing.join(", ")}</span>.</>}
        </p>
      )}

      {canRequest && (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_9rem]"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await call("/api/live/propose", { ...form, idempotencyKey: crypto.randomUUID() }, "propose", () => "Request created. It is waiting for an administrator to approve it.");
            if (ok) setForm({ recipient: "", amountQor: "", purpose: "" });
          }}
        >
          <div>
            <label htmlFor="lp-to" className="mb-1 block text-xs text-muted">Recipient (must already be approved on the vault)</label>
            <input id="lp-to" className={inputCls} required pattern="0x[0-9a-fA-F]{40}" placeholder="0x…" value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} />
          </div>
          <div>
            <label htmlFor="lp-amt" className="mb-1 block text-xs text-muted">Amount, QOR (max 10)</label>
            <input id="lp-amt" className={inputCls} required inputMode="decimal" placeholder="1.5" value={form.amountQor} onChange={(e) => setForm({ ...form, amountQor: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="lp-why" className="mb-1 block text-xs text-muted">Purpose (recorded and hashed into the payment)</label>
            <input id="lp-why" className={inputCls} required minLength={3} maxLength={120} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button className={btnCls} disabled={busy !== null} type="submit">{busy === "propose" ? "Checking the chain…" : "Request live payment"}</button>
            <span className="text-xs text-muted">This only creates a request. Nothing is sent until an administrator approves it and someone presses Execute.</span>
          </div>
        </form>
      )}

      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "" : "text-[var(--bad)]"}`}>{msg.text}</p>}

      {ops.length === 0 ? <p className="text-sm text-muted">No live payment requests yet.</p> : (
        <ul className="space-y-3">
          {ops.map((o) => {
            const l = LABEL[o.state] ?? { text: o.state, tone: "neutral" as Tone };
            return (
              <li key={o.id} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{qor(o.amount)} QOR to <span className="font-mono text-[13px]">{short(o.recipient)}</span></p>
                  <Badge tone={l.tone}>{l.text}</Badge>
                </div>
                {o.purpose && <p className="mt-1 text-sm text-muted">{o.purpose}</p>}
                <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted">Payment hash</dt><dd className="break-all font-mono">{o.paymentHash}</dd>
                  <dt className="text-muted">Approvals</dt><dd>{o.approvals} of {o.required} administrator{o.required === 1 ? "" : "s"}</dd>
                  <dt className="text-muted">Expires</dt><dd>{new Date(o.expiresAt).toLocaleString()}</dd>
                  {o.approvalTx && (<><dt className="text-muted">Approval tx</dt><dd className="break-all font-mono"><a className="underline" href={txUrl(o.approvalTx)} target="_blank" rel="noreferrer">{o.approvalTx}</a> (submitted by the Verac server on the administrators&apos; behalf)</dd></>)}
                  {o.txHash && (<><dt className="text-muted">Transaction</dt><dd className="break-all font-mono"><a className="underline" href={txUrl(o.txHash)} target="_blank" rel="noreferrer">{o.txHash}</a>{o.block ? ` · block ${o.block}` : ""}</dd></>)}
                  {o.failure && (<><dt className="text-muted">Why it did not pay</dt><dd>{o.failure}</dd></>)}
                </dl>

                {o.state === "AWAITING_APPROVAL" && canDecide && (
                  o.requestedByMe ? <p className="mt-3 text-xs text-muted">You made this request, so someone else must decide it.</p> : (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <div>
                        <label htmlFor={`pw-${o.id}`} className="mb-1 block text-xs text-muted">Your password, to approve</label>
                        <input id={`pw-${o.id}`} type="password" autoComplete="current-password" className={inputCls} value={pw[o.id] ?? ""} onChange={(e) => setPw({ ...pw, [o.id]: e.target.value })} />
                      </div>
                      <button className={btnCls} disabled={busy !== null || !(pw[o.id] ?? "")} onClick={() => call("/api/live/decide", { id: o.id, decision: "approve", password: pw[o.id] }, `approve-${o.id}`, () => "Approved. It can now be executed.").then(() => setPw({ ...pw, [o.id]: "" }))}>Approve exactly this payment</button>
                      <button className="rounded-full border border-line px-4 py-2 text-sm hover:bg-surface-2" disabled={busy !== null} onClick={() => call("/api/live/decide", { id: o.id, decision: "reject" }, `reject-${o.id}`, () => "Rejected.")}>Reject</button>
                    </div>
                  )
                )}

                {o.state === "APPROVED" && canRequest && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button className={btnCls} disabled={busy !== null || !status.switchOn || !status.ready} onClick={() => call("/api/live/execute", { id: o.id }, `execute-${o.id}`, (j) => `Confirmed on Diana testnet: ${(j.result as { txHash?: string } | undefined)?.txHash ?? ""}`)}>
                      {busy === `execute-${o.id}` ? "Sending and waiting for the chain…" : "Execute on Diana testnet"}
                    </button>
                    <span className="text-xs text-muted">Sends {qor(o.amount)} test QOR from the vault. The result shown is read back from the chain.</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
