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
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Policy JSON">
          <label htmlFor="policy" className="sr-only">Policy JSON</label>
          <textarea id="policy" className={`${inputCls} h-80 font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          <div className="mt-3"><button type="button" className={btnCls} onClick={validate} disabled={busy}>{busy ? "Validating…" : "Validate policy"}</button></div>
          {err && <p role="alert" className="mt-3 text-sm text-[var(--bad)]">{err}</p>}
        </Card>
        <Card title="Result" right={out ? <Badge tone={out.ok ? "live" : "failed"}>{out.ok ? "VALID" : "INVALID"}</Badge> : undefined}>
          {!out && <p className="text-sm text-muted">Run validation to see findings.</p>}
          {out && (
            <div className="space-y-4 text-sm">
              {out.summary.length > 0 && <div><p className="mb-1 font-medium">What this policy does</p><ul className="list-disc space-y-1 pl-5">{out.summary.map((s) => <li key={s}>{s}</li>)}</ul></div>}
              {out.findings.length > 0 ? <div><p className="mb-1 font-medium">Findings</p><ul className="list-disc space-y-1 pl-5">{out.findings.map((f, i) => <li key={i}><span className="font-mono text-xs">{f.severity ?? ""} {f.code ?? ""}</span> {f.message ?? JSON.stringify(f)}</li>)}</ul></div> : <p className="text-muted">No findings.</p>}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
