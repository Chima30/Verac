"use client";
import { useEffect, useMemo, useState } from "react";
import { awardBid } from "@/app/(app)/procurement/actions";
import { Badge, btnCls, inputCls } from "@/components/ui";
import { keysFromSeedHex, loadSeed, openBid } from "@/lib/seal-browser";

interface SealedBid { bid_id: string; vendor_name: string; submitted_at: string; envelope: string; envelope_sha256: string }
interface Flag { code: string; blocking: boolean; message: string }
interface Ranked { ref: string; eligible: boolean; flags: Flag[]; amountQor?: number; deliveryDays?: number; priceScore?: number; deliveryScore?: number; fit?: number; total?: number; rank?: number }
interface AiEval { ref: string; fit: number; strengths: string[]; concerns: string[] }
interface EvalOut { ranked: Ranked[]; ai: { model: string; summary: string; evaluations: AiEval[] } | null; aiError?: string; error?: string }
interface Plain { vendorName?: string; amountQor?: number; deliveryDays?: number; approach?: string; references?: string }

export function ReviewPanel({ tenderId, orgId, userId, requirements, budgetQor, status, awardBidId, bids }: {
  tenderId: string; orgId: string; userId: string; requirements: string; budgetQor: number; status: string; awardBidId: string | null; bids: SealedBid[];
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [plain, setPlain] = useState<Record<string, { text?: string; error?: string }>>({});
  const [confirmAi, setConfirmAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<EvalOut | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<string>(awardBidId ?? "");
  const [ms, setMs] = useState([{ title: "Delivery", amount: "" }]);
  const [awarding, setAwarding] = useState(false);

  useEffect(() => { setHasKey(loadSeed(orgId, userId) !== null); }, [orgId, userId]);
  const refOf = (i: number) => `Bid ${i + 1}`;
  const decrypted = bids.every((b) => plain[b.bid_id]);

  function decryptAll() {
    setErr(null);
    const seed = loadSeed(orgId, userId);
    if (!seed) { setErr("No reading key in this browser. Restore your backup in the Reading key card on the Procurement page."); return; }
    const keys = keysFromSeedHex(seed);
    const next: typeof plain = {};
    for (const b of bids) {
      try { next[b.bid_id] = { text: openBid(tenderId, b.envelope, keys) }; }
      catch { next[b.bid_id] = { error: "This browser's key cannot open this bid (it was not sealed to you, or it was altered)." }; }
    }
    setPlain(next);
  }
  const parsed = (id: string): Plain | null => { try { return plain[id]?.text ? (JSON.parse(plain[id]!.text!) as Plain) : null; } catch { return null; } };

  async function evaluate() {
    setBusy(true); setErr(null); setOut(null);
    try {
      const list = bids.map((b, i) => ({ ref: refOf(i), text: plain[b.bid_id]?.text ?? "" }));
      const res = await fetch("/api/procurement/evaluate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requirements, budgetQor, bids: list, confirmSendToAi: confirmAi }) });
      const d = (await res.json()) as EvalOut;
      if (!res.ok) setErr(d.error ?? "Evaluation failed."); else setOut(d);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const rankedBy = useMemo(() => new Map((out?.ranked ?? []).map((r) => [r.ref, r])), [out]);
  const aiBy = useMemo(() => new Map((out?.ai?.evaluations ?? []).map((e) => [e.ref, e])), [out]);

  async function award() {
    setAwarding(true); setErr(null);
    const rows = ms.map((m) => ({ title: m.title, amountQor: Number(m.amount) }));
    if (!pick) { setErr("Choose a bid to award."); setAwarding(false); return; }
    if (rows.some((r) => !r.title.trim() || !(r.amountQor > 0))) { setErr("Every milestone needs a title and an amount above 0."); setAwarding(false); return; }
    const r = await awardBid(tenderId, pick, rows);
    setAwarding(false);
    if (r.error) setErr(r.error);
  }

  return (
    <div className="space-y-4 text-[13.5px]">
      {status === "review" && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button className={btnCls} onClick={decryptAll} disabled={hasKey === false}>Open bids in this browser</button>
            {hasKey === false && <span className="text-[var(--bad)]">This browser has no reading key.</span>}
            <Badge tone="neutral">DECRYPTED ONLY IN YOUR BROWSER</Badge>
          </div>
          {decrypted && bids.length > 0 && (
            <div className="rounded-lg border border-line bg-surface p-4">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmAi} onChange={(e) => setConfirmAi(e.target.checked)} />
                <span>Let Gemini score how well each approach fits the requirements. This sends the <strong>decrypted approach text</strong> (without vendor names) to Google&apos;s free Gemini service, which may use free-tier content to improve its products. Leave unticked for confidential bids; price and delivery are still ranked by fixed rules.</span></label>
              <button className={`${btnCls} mt-3`} disabled={busy} onClick={evaluate}>{busy ? "Ranking…" : "Rank bids"}</button>
            </div>
          )}
        </>
      )}
      {err && <p role="alert" className="text-[var(--bad)]">{err}</p>}

      <div className="space-y-3">
        {bids.map((b, i) => {
          const p = parsed(b.bid_id); const r = rankedBy.get(refOf(i)); const a = aiBy.get(refOf(i)); const st = plain[b.bid_id];
          return (
            <div key={b.bid_id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{refOf(i)} · {b.vendor_name}</span>
                <span className="flex items-center gap-2">
                  {r?.rank && <Badge tone="live">RANK {r.rank}</Badge>}
                  {r && !r.eligible && <Badge tone="failed">NOT RANKED</Badge>}
                  {awardBidId === b.bid_id && <Badge tone="live">AWARDED</Badge>}
                  <Badge tone="neutral">SEALED {b.envelope_sha256.slice(0, 8)}…</Badge>
                </span>
              </div>
              {!st && <p className="mt-2 text-muted">Sealed. Open the bids in this browser to read it.</p>}
              {st?.error && <p className="mt-2 text-[var(--bad)]">{st.error}</p>}
              {p && (
                <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_1fr]">
                  <dt className="text-muted">Price</dt><dd>{p.amountQor} QOR</dd>
                  <dt className="text-muted">Delivery</dt><dd>{p.deliveryDays} days</dd>
                  <dt className="text-muted">Approach</dt><dd className="whitespace-pre-wrap break-words">{p.approach}</dd>
                  {p.references && <><dt className="text-muted">References</dt><dd className="break-words">{p.references}</dd></>}
                </dl>
              )}
              {st?.text && !p && <p className="mt-2 text-[var(--bad)]">The bid opened but is not in the expected format.</p>}
              {r && (
                <div className="mt-2 border-t border-line pt-2">
                  {r.eligible && <p>Price score {r.priceScore}/10 · Delivery score {r.deliveryScore}/10{r.fit !== undefined ? ` · AI fit ${r.fit}/10` : ""} · <strong>Total {r.total}</strong></p>}
                  {r.flags.map((f) => <p key={f.code} className={f.blocking ? "text-[var(--bad)]" : "text-muted"}>{f.blocking ? "Blocking: " : "Note: "}{f.message}</p>)}
                  {a && <div className="mt-1"><span className="text-[12.5px] text-muted">AI notes (advisory):</span>
                    {a.strengths.map((s) => <p key={s}>+ {s}</p>)}{a.concerns.map((s) => <p key={s}>− {s}</p>)}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {out?.ai && <p className="text-[12.5px] text-muted"><Badge tone="sim">AI ADVISORY, NOT A DECISION</Badge> {out.ai.model}: {out.ai.summary}</p>}
      {out?.aiError && <p className="text-[12.5px] text-muted">AI scoring: {out.aiError}</p>}

      {status === "review" && decrypted && (
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="mb-2 font-medium">Award (your decision)</p>
          <div className="space-y-1">
            {bids.map((b, i) => <label key={b.bid_id} className="flex items-center gap-2"><input type="radio" name="pick" checked={pick === b.bid_id} onChange={() => { setPick(b.bid_id); const p = parsed(b.bid_id); if (p?.amountQor && ms.length === 1 && !ms[0]!.amount) setMs([{ title: ms[0]!.title, amount: String(p.amountQor) }]); }} /> {refOf(i)} · {b.vendor_name}{rankedBy.get(refOf(i))?.eligible === false ? " (not ranked)" : ""}</label>)}
          </div>
          <p className="mb-1 mt-3 text-[12.5px] text-muted">Milestones (total must not exceed the budget of {budgetQor} QOR)</p>
          {ms.map((m, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input className={inputCls} value={m.title} onChange={(e) => setMs(ms.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Milestone title" />
              <input className={`${inputCls} max-w-32`} value={m.amount} onChange={(e) => setMs(ms.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} placeholder="QOR" />
              {ms.length > 1 && <button className="rounded-md border border-line px-2 text-[12.5px]" onClick={() => setMs(ms.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          ))}
          <div className="flex gap-2">
            {ms.length < 10 && <button className="rounded-md border border-line px-3 py-2 text-[12.5px]" onClick={() => setMs([...ms, { title: "", amount: "" }])}>Add milestone</button>}
            <button className={btnCls} disabled={awarding} onClick={award}>{awarding ? "Awarding…" : "Award tender"}</button>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">Awarding records the decision and the milestone plan. It does not move any QOR: funding the escrow on chain is a separate, approved step that is not wired to this page yet.</p>
        </div>
      )}
    </div>
  );
}
