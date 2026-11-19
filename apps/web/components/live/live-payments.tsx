"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Notice, btnCls, btnSecondaryCls, inputCls, labelCls, type Tone } from "@/components/ui";
import { CopyButton } from "@/components/ui-client";

export interface LiveOp {
  id: string; state: string; recipient: string; amount: string; required: number; approvals: number; requestedByMe: boolean;
  paymentHash: string; txHash: string | null; approvalTx: string | null; block: number | null; failure: string | null; purpose: string | null; expiresAt: string;
  /** 2 = TreasuryVault V2: approved only by administrators' own ML-DSA-87 signatures (signers lists their addresses). */
  vaultVersion?: 1 | 2; signers?: string[];
}
export interface V2Status { ready: boolean; switchOn: boolean; vault: string | null }

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

/** Where a live payment is in its life, read only from its stored state. Never shows "paid" before the chain confirms. */
function Progress({ state, approvals, required }: { state: string; approvals: number; required: number }) {
  const approved = ["APPROVED", "READY", "SUBMITTED", "CONFIRMED"].includes(state);
  const sent = ["SUBMITTED", "CONFIRMED"].includes(state);
  const steps: Array<{ label: string; s: "done" | "now" | "todo" | "bad" }> = [
    { label: "Requested", s: "done" },
    { label: `Approved ${Math.min(approvals, required)}/${required}`, s: state === "REJECTED" || state === "CANCELLED" ? "bad" : approved ? "done" : state === "AWAITING_APPROVAL" ? "now" : "todo" },
    { label: "Sent to chain", s: state === "FAILED" ? "bad" : sent ? "done" : state === "READY" || state === "APPROVED" ? "now" : "todo" },
    { label: "Confirmed", s: state === "CONFIRMED" ? "done" : state === "SUBMITTED" ? "now" : "todo" },
  ];
  const c = { done: "bg-[var(--live)]", now: "bg-[var(--accent)]", todo: "bg-surface-3", bad: "bg-[var(--bad)]" };
  const word = { done: "done", now: "current step", todo: "not yet", bad: "stopped here" };
  return (
    <ol aria-label="Payment progress" className="mt-3 grid grid-cols-4 gap-1.5">
      {steps.map((x) => (
        <li key={x.label} className="min-w-0">
          <span aria-hidden className={`block h-1 rounded-full ${c[x.s]}`} />
          <span className={`mt-1.5 block truncate text-[11.5px] ${x.s === "todo" ? "text-subtle" : x.s === "bad" ? "text-[var(--bad)]" : "text-muted"}`}>{x.label}<span className="sr-only">: {word[x.s]}</span></span>
        </li>
      ))}
    </ol>
  );
}

export function LivePayments({ ops, canRequest, canDecide, explorer, status, v2 }: {
  ops: LiveOp[]; canRequest: boolean; canDecide: boolean; explorer: string;
  status: { switchOn: boolean; ready: boolean; missing: string[] };
  v2?: V2Status;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ recipient: "", amountQor: "", purpose: "" });
  const [ask, setAsk] = useState("");
  const [drafted, setDrafted] = useState<string | null>(null);
  const v2Ready = !!(v2?.ready && v2.switchOn);
  const [method, setMethod] = useState<"v2" | "v1">(v2Ready ? "v2" : "v1");
  const [sigText, setSigText] = useState<Record<string, string>>({});

  async function draft() {
    setBusy("ask"); setMsg(null); setDrafted(null);
    try {
      const r = await fetch("/api/live/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: ask }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; code?: string; draft?: { recipient: string; amountQor: string; purpose: string }; note?: string };
      if (!r.ok || !j.draft) setMsg({ ok: false, text: r.status === 503 ? "The AI drafting service is not configured here. Fill in the form directly." : j.error ?? "Could not draft that." });
      else { setForm(j.draft); setDrafted(j.note ?? "Draft filled in."); }
    } catch { setMsg({ ok: false, text: "Network error. Nothing was changed." }); }
    setBusy(null);
  }
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
        <Notice tone="warn" title={`Live execution is ${status.switchOn ? "switched on but not fully configured" : "switched off"} here`}>
          Approved payments cannot be sent yet. Requests and approvals still work and are recorded.
          {status.missing.length > 0 && <> Missing server settings: <span className="font-mono text-[12px]">{status.missing.join(", ")}</span>.</>}
        </Notice>
      )}

      {canRequest && (
        <div className="space-y-2 rounded-lg border border-line bg-surface-2/60 p-4">
          <label htmlFor="lp-ask" className={labelCls}>Optional: describe the payment in plain English and Gemini fills in the form below</label>
          <div className="flex flex-wrap gap-2">
            <input id="lp-ask" className={`${inputCls} min-w-0 flex-1`} maxLength={600} placeholder="Pay 0x… 1.5 QOR for October design work" value={ask} onChange={(e) => setAsk(e.target.value)} />
            <button type="button" className={btnSecondaryCls} disabled={busy !== null || ask.trim().length < 10} onClick={draft}>{busy === "ask" ? "Drafting…" : "Draft with AI"}</button>
          </div>
          {drafted && <p role="status" className="text-[12.5px] text-muted">AI draft, not requested. {drafted} Check every field before requesting.</p>}
        </div>
      )}

      {canRequest && (
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem]"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = method === "v2"
              ? await call("/api/live/v2/propose", { ...form, idempotencyKey: crypto.randomUUID() }, "propose", (j) => `Request created on TreasuryVault V2. It needs ${String(j.required ?? 2)} administrators to sign it with their own keys.`)
              : await call("/api/live/propose", { ...form, idempotencyKey: crypto.randomUUID() }, "propose", () => "Request created. It is waiting for an administrator to approve it.");
            if (ok) setForm({ recipient: "", amountQor: "", purpose: "" });
          }}
        >
          {v2Ready && (
            <fieldset className="sm:col-span-2">
              <legend className={labelCls}>How this payment is approved</legend>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[13.5px]">
                <label className="flex items-center gap-2"><input type="radio" name="lp-method" checked={method === "v2"} onChange={() => setMethod("v2")} /> Administrators sign with their own post-quantum keys (TreasuryVault V2)</label>
                <label className="flex items-center gap-2"><input type="radio" name="lp-method" checked={method === "v1"} onChange={() => setMethod("v1")} /> Password approval, relayed by the server (original vault)</label>
              </div>
            </fieldset>
          )}
          <div>
            <label htmlFor="lp-to" className={labelCls}>Recipient (must already be approved on the vault)</label>
            <input id="lp-to" className={`${inputCls} font-mono`} spellCheck={false} autoComplete="off" required pattern="0x[0-9a-fA-F]{40}" placeholder="0x…" value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} />
          </div>
          <div>
            <label htmlFor="lp-amt" className={labelCls}>Amount, QOR (max 10)</label>
            <input id="lp-amt" className={inputCls} required inputMode="decimal" placeholder="1.5" value={form.amountQor} onChange={(e) => setForm({ ...form, amountQor: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="lp-why" className={labelCls}>Purpose (recorded and hashed into the payment)</label>
            <input id="lp-why" className={inputCls} required minLength={3} maxLength={120} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button className={btnCls} disabled={busy !== null} type="submit">{busy === "propose" ? "Checking the chain…" : "Request live payment"}</button>
            <span className="text-[12.5px] text-muted">This only creates a request. Nothing is sent until an administrator approves it and someone presses Execute.</span>
          </div>
        </form>
      )}

      {msg && <Notice tone={msg.ok ? "live" : "bad"} role={msg.ok ? "status" : "alert"}>{msg.text}</Notice>}

      {ops.length === 0 ? <p className="py-4 text-center text-[13.5px] text-muted">No live payment requests yet.</p> : (
        <ul className="space-y-3">
          {ops.map((o) => {
            const l = LABEL[o.state] ?? { text: o.state, tone: "neutral" as Tone };
            return (
              <li key={o.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-x-1.5 text-[15px] font-semibold tabular-nums">{qor(o.amount)} QOR <span className="text-[13px] font-normal text-muted">to</span> <a href={`${explorer.replace(/\/$/, "")}/address/${o.recipient}`} target="_blank" rel="noreferrer" title={`${o.recipient} (open in the QoreChain explorer)`} className="font-mono text-[13px] font-normal underline decoration-line-strong underline-offset-[3px] hover:decoration-current">{short(o.recipient)}</a><CopyButton value={o.recipient} label="Copy recipient address" /></p>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {o.vaultVersion === 2 && <Badge tone="live">V2 · ML-DSA-87 APPROVAL</Badge>}
                    <Badge tone={l.tone}>{l.text}</Badge>
                  </span>
                </div>
                {o.purpose && <p className="mt-1 text-[13.5px] text-muted">{o.purpose}</p>}
                <Progress state={o.state} approvals={o.approvals} required={o.required} />
                <dl className="mt-3 grid grid-cols-1 gap-x-3 gap-y-1 text-[12.5px] sm:grid-cols-[8rem_1fr]">
                  <dt className="text-muted">Recipient</dt><dd className="flex items-start gap-1"><span className="break-all font-mono">{o.recipient}</span><CopyButton value={o.recipient} label="Copy recipient address" className="-mt-1" /></dd>
                  <dt className="text-muted">Payment hash</dt><dd className="flex items-start gap-1"><span className="break-all font-mono">{o.paymentHash}</span><CopyButton value={o.paymentHash} label="Copy payment hash" className="-mt-1" /></dd>
                  {o.vaultVersion === 2 ? (
                    <><dt className="text-muted">Signatures</dt><dd>{(o.signers ?? []).length} of {o.required} administrators, each checked against the key registered on QoreChain{(o.signers ?? []).length > 0 && <span className="mt-0.5 block break-all font-mono text-[12px] text-muted">{(o.signers ?? []).join(", ")}</span>}</dd></>
                  ) : (
                    <><dt className="text-muted">Approvals</dt><dd>{o.approvals} of {o.required} administrator{o.required === 1 ? "" : "s"}</dd></>
                  )}
                  <dt className="text-muted">Expires</dt><dd>{new Date(o.expiresAt).toLocaleString()}</dd>
                  {o.approvalTx && (<><dt className="text-muted">Approval tx</dt><dd className="break-all font-mono"><a className="underline" href={txUrl(o.approvalTx)} target="_blank" rel="noreferrer">{o.approvalTx}</a> (submitted by the Verac server on the administrators&apos; behalf)</dd></>)}
                  {o.txHash && (<><dt className="text-muted">Transaction</dt><dd className="break-all font-mono"><a className="underline" href={txUrl(o.txHash)} target="_blank" rel="noreferrer">{o.txHash}</a>{o.block ? ` · block ${o.block}` : ""}</dd></>)}
                  {o.failure && (<><dt className="text-muted">Why it did not pay</dt><dd>{o.failure}</dd></>)}
                </dl>

                {o.state === "AWAITING_APPROVAL" && o.vaultVersion === 2 && (canDecide || canRequest) && (
                  <div className="mt-4 space-y-3 border-t border-line pt-4 text-[13px]">
                    <p className="text-muted">
                      Two administrators approve this payment on their own computers. The Verac server holds no administrator key and cannot sign for them.
                    </p>
                    <ol className="list-decimal space-y-1 pl-5 text-muted">
                      <li><a className="underline" href={`/api/live/v2/request?id=${o.id}`}>Download the signing request</a> (public payment fields only).</li>
                      <li>Run <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">pnpm v2:admin sign &lt;your key folder&gt; &lt;signing request file&gt;</code>. It shows the payment and signs only after you type yes.</li>
                      <li>Upload or paste the signature file it writes:</li>
                    </ol>
                    <div className="flex flex-wrap items-end gap-2">
                      <input type="file" accept="application/json,.json" aria-label="Signature file" className="text-[12.5px]" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setSigText({ ...sigText, [o.id]: await f.text() }); }} />
                      <textarea aria-label="Signature file contents" rows={2} className={`${inputCls} min-w-0 flex-1 font-mono text-[11.5px]`} placeholder="Signature file contents (JSON)" value={sigText[o.id] ?? ""} onChange={(e) => setSigText({ ...sigText, [o.id]: e.target.value })} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className={btnCls} disabled={busy !== null || !(sigText[o.id] ?? "").trim()} onClick={() => call("/api/live/v2/signature", { id: o.id, signature: sigText[o.id] }, `sig-${o.id}`, (j) => `Signature verified and recorded (${String(j.signatures)} of ${String(j.required)}).${j.state === "APPROVED" ? " The payment is approved and can be executed." : ""}`).then((ok) => { if (ok) setSigText({ ...sigText, [o.id]: "" }); })}>
                        {busy === `sig-${o.id}` ? "Checking the signature against QoreChain…" : "Submit signature"}
                      </button>
                      {canDecide && <button className={btnSecondaryCls} disabled={busy !== null} onClick={() => call("/api/live/decide", { id: o.id, decision: "reject" }, `reject-${o.id}`, () => "Rejected.")}>Reject</button>}
                    </div>
                  </div>
                )}

                {o.state === "AWAITING_APPROVAL" && o.vaultVersion !== 2 && canDecide && (
                  o.requestedByMe ? <p className="mt-3 text-[12.5px] text-muted">You made this request, so someone else must decide it.</p> : (
                    <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
                      <div>
                        <label htmlFor={`pw-${o.id}`} className={labelCls}>Your password, to approve</label>
                        <input id={`pw-${o.id}`} type="password" autoComplete="current-password" className={inputCls} value={pw[o.id] ?? ""} onChange={(e) => setPw({ ...pw, [o.id]: e.target.value })} />
                      </div>
                      <button className={btnCls} disabled={busy !== null || !(pw[o.id] ?? "")} onClick={() => call("/api/live/decide", { id: o.id, decision: "approve", password: pw[o.id] }, `approve-${o.id}`, () => "Approved. It can now be executed.").then(() => setPw({ ...pw, [o.id]: "" }))}>Approve exactly this payment</button>
                      <button className={btnSecondaryCls} disabled={busy !== null} onClick={() => call("/api/live/decide", { id: o.id, decision: "reject" }, `reject-${o.id}`, () => "Rejected.")}>Reject</button>
                    </div>
                  )
                )}

                {o.state === "APPROVED" && canRequest && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                    <button className={btnCls} disabled={busy !== null || (o.vaultVersion === 2 ? !v2Ready : !status.switchOn || !status.ready)} onClick={() => call("/api/live/execute", { id: o.id }, `execute-${o.id}`, (j) => `Confirmed on Diana testnet: ${(j.result as { txHash?: string } | undefined)?.txHash ?? ""}`)}>
                      {busy === `execute-${o.id}` ? "Sending and waiting for the chain…" : "Execute on Diana testnet"}
                    </button>
                    <span className="text-[12.5px] text-muted">Sends {qor(o.amount)} test QOR from the vault. The result shown is read back from the chain.</span>
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
