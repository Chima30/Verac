"use client";
import Link from "next/link";
import { useState } from "react";
import { previewPayroll, submitPayroll, type Preview } from "@/app/(app)/payroll/actions";
import { Badge, btnCls, inputCls } from "@/components/ui";

const A1 = "0x" + "1".repeat(40), A2 = "0x" + "2".repeat(40);
const EXAMPLE = `Ada Lovelace | ${A1} | 120\nBob Builder | ${A2} | 80.5`;
const SEV: Record<string, string> = { critical: "text-[var(--bad)]", high: "text-[var(--bad)]", medium: "text-[var(--warn)]" };

export function PayrollWorkbench({ canSubmit }: { canSubmit: boolean }) {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [text, setText] = useState(EXAMPLE);
  const [lineCap, setLineCap] = useState("");
  const [totalCap, setTotalCap] = useState("");
  const [required, setRequired] = useState(1);
  const [hours, setHours] = useState(48);
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function check() {
    setBusy(true); setErr(null); setMsg(null);
    const r = await previewPayroll(period, text, lineCap, totalCap);
    setBusy(false);
    if (r.error) { setErr(r.error); setPv(null); } else setPv(r);
  }
  async function submit() {
    setBusy(true); setErr(null); setMsg(null);
    const r = await submitPayroll(period, text, required, hours);
    setBusy(false);
    if (r.error) setErr(r.error); else { setMsg("Submitted. It now waits on the Approvals page for a different finance member."); setPv(null); }
  }
  const v = pv?.check?.verdict;
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className="mb-1 block text-xs text-muted">Period (YYYY-MM)</label><input className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs text-muted">Per-payment limit, QOR (optional)</label><input className={inputCls} value={lineCap} onChange={(e) => setLineCap(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs text-muted">Batch limit, QOR (optional)</label><input className={inputCls} value={totalCap} onChange={(e) => setTotalCap(e.target.value)} /></div>
      </div>
      <div><label className="mb-1 block text-xs text-muted">Payees, one per line: name | 0x address | amount in QOR</label><textarea className={`${inputCls} font-mono text-xs`} rows={7} value={text} onChange={(e) => setText(e.target.value)} /></div>
      <button className={btnCls} disabled={busy} onClick={check}>{busy ? "Checking…" : "Check batch"}</button>
      {err && <p role="alert" className="text-[var(--bad)]">{err}</p>}
      {msg && <p role="status">{msg} <Link className="underline" href="/approvals">Open Approvals</Link></p>}

      {pv?.check && (
        <div className="rounded-md border border-line p-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={v === "block" ? "failed" : v === "review" ? "approval" : "live"}>{v === "block" ? "BLOCKED" : v === "review" ? "NEEDS REVIEW" : "NO PROBLEMS FOUND"}</Badge>
            <span>{pv.check.lines} lines · total {pv.check.totalQor} QOR</span>
            <span className="text-xs text-muted">{pv.previousPeriod ? `compared with ${pv.previousPeriod}` : "no earlier approved period to compare with"}</span>
          </div>
          {pv.check.findings.length > 0 && <ul className="mt-2 space-y-1">{pv.check.findings.map((f, i) => <li key={i} className={SEV[f.severity]}>{f.line ? `Line ${f.line}: ` : ""}{f.message}</li>)}</ul>}
          {pv.hash && <p className="mt-2 break-all text-xs text-muted">Batch hash (binds every address and amount): <span className="font-mono">{pv.hash}</span></p>}
          {v !== "block" && canSubmit && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div><label className="mb-1 block text-xs text-muted">Approvals needed</label><input type="number" min={1} max={10} className={`${inputCls} w-24`} value={required} onChange={(e) => setRequired(Number(e.target.value))} /></div>
              <div><label className="mb-1 block text-xs text-muted">Valid for (hours)</label><input type="number" min={1} max={168} className={`${inputCls} w-24`} value={hours} onChange={(e) => setHours(Number(e.target.value))} /></div>
              <button className={btnCls} disabled={busy} onClick={submit}>Submit for approval</button>
            </div>
          )}
          {v === "review" && <p className="mt-2 text-xs text-muted">Items marked for review can still be submitted; the approver sees every line and must decide.</p>}
        </div>
      )}
    </div>
  );
}
