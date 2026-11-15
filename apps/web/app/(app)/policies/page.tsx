"use client";
import { useState } from "react";
import { Badge, Card, PageHeader, btnCls, inputCls } from "@/components/ui";

const SAMPLE = JSON.stringify({
  schemaVersion: 1, name: "Operations payments", agent: "PaymentAgent",
  token: "0x0000000000000000000000000000000000000000", tokenDecimals: 18,
  perTxCap: "100000000000000000000", dailyCap: "500000000000000000000", autoApproveCap: "10000000000000000000",
  approvalThreshold: 2, requireApprovalForNewRecipients: true,
}, null, 2);

interface Finding { severity?: string; code?: string; message?: string }
interface Out { ok: boolean; findings: Finding[]; summary: string[] }

export default function Policies() {
  const [text, setText] = useState(SAMPLE);
  const [out, setOut] = useState<Out | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<{ model: string; aiSummary: string; description: string[]; findings: Finding[]; ok: boolean } | null>(null);
  const [draftErr, setDraftErr] = useState<string | null>(null);

  async function makeDraft() {
    setDrafting(true); setDraft(null); setDraftErr(null);
    try {
      const r = await fetch("/api/policy/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: ask }) });
      const j = (await r.json()) as { error?: string; policy?: unknown; model: string; aiSummary: string; description: string[]; findings: Finding[]; ok: boolean };
      if (!r.ok) { setDraftErr(j.error ?? `Request failed (${r.status})`); return; }
      setDraft({ model: j.model, aiSummary: j.aiSummary, description: j.description, findings: j.findings, ok: j.ok });
      setText(JSON.stringify(j.policy, null, 2));
      setOut({ ok: j.ok, findings: j.findings, summary: j.description });
    } catch (e) { setDraftErr(e instanceof Error ? e.message : String(e)); }
    finally { setDrafting(false); }
  }

  async function validate() {
    setErr(null); setOut(null); setBusy(true);
    let body: unknown;
    try { body = JSON.parse(text); } catch { setErr("Not valid JSON."); setBusy(false); return; }
    try {
      const r = await fetch("/api/policy/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      setOut((await r.json()) as Out);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Policies" description="Validate a spending policy against the real policy-engine schema and see it described in plain language. Saving and activating policies needs the database and an approver, and is not built yet." badge={<Badge tone="sim">VALIDATION ONLY</Badge>} />
      <Card title="Describe a policy in words" className="mb-4" right={<Badge tone="sim">AI DRAFT ONLY</Badge>}>
        <label htmlFor="ask" className="sr-only">Describe the policy</label>
        <textarea id="ask" className={`${inputCls} h-24`} value={ask} maxLength={1500} onChange={(e) => setAsk(e.target.value)}
          placeholder="Example: let the payment agent pay up to 10 QOR per payment and 25 QOR a day, auto-approve anything under 2 QOR to known vendors, and require 2 approvers for the rest." />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={btnCls} onClick={makeDraft} disabled={drafting || ask.trim().length < 5}>{drafting ? "Drafting…" : "Draft with Gemini"}</button>
          <span className="text-[12.5px] text-muted">Gemini only drafts. Amounts are converted and checked by deterministic code, and nothing is activated. Do not include secrets or personal data.</span>
        </div>
        {draftErr && <p role="alert" className="mt-3 text-[13.5px] text-[var(--bad)]">{draftErr}</p>}
        {draft && (
          <div className="mt-4 space-y-3 text-[13.5px]">
            <p><span className="text-muted">Model {draft.model} understood:</span> {draft.aiSummary}</p>
            <p className="text-muted">The draft is loaded in the editor below and was checked by the policy engine: <strong>{draft.ok ? "no blocking problems" : "blocking problems found"}</strong>. Compare the plain-language description on the right with what you asked for, not just the AI&apos;s summary.</p>
          </div>
        )}
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Policy JSON">
          <label htmlFor="policy" className="sr-only">Policy JSON</label>
          <textarea id="policy" className={`${inputCls} h-80 font-mono text-[12.5px]`} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          <div className="mt-3"><button type="button" className={btnCls} onClick={validate} disabled={busy}>{busy ? "Validating…" : "Validate policy"}</button></div>
          {err && <p role="alert" className="mt-3 text-[13.5px] text-[var(--bad)]">{err}</p>}
        </Card>
        <Card title="Result" right={out ? <Badge tone={out.ok ? "live" : "failed"}>{out.ok ? "VALID" : "INVALID"}</Badge> : undefined}>
          {!out && <p className="text-[13.5px] text-muted">Run validation to see findings.</p>}
          {out && (
            <div className="space-y-4 text-[13.5px]">
              {out.summary.length > 0 && <div><p className="mb-1 font-medium">What this policy does</p><ul className="list-disc space-y-1 pl-5">{out.summary.map((s) => <li key={s}>{s}</li>)}</ul></div>}
              {out.findings.length > 0 ? <div><p className="mb-1 font-medium">Findings</p><ul className="list-disc space-y-1 pl-5">{out.findings.map((f, i) => <li key={i}><span className="font-mono text-[12.5px]">{f.severity ?? ""} {f.code ?? ""}</span> {f.message ?? JSON.stringify(f)}</li>)}</ul></div> : <p className="text-muted">No findings.</p>}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
