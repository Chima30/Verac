"use client";
import { useEffect, useState } from "react";
import { submitSealedBid } from "@/app/(app)/procurement/actions";
import { Badge, btnCls, inputCls } from "@/components/ui";
import { fingerprint, sealBid } from "@/lib/seal-browser";

interface Reviewer { user_id: string; mlkem_public: string; x25519_public: string }

/** Seals the bid in this browser to every reviewer's public key. The server receives ciphertext only. */
export function BidForm({ tenderId, reviewers, budgetQor }: { tenderId: string; reviewers: Reviewer[]; budgetQor: string }) {
  const [f, setF] = useState({ vendorName: "", amountQor: "", deliveryDays: "", approach: "", references: "" });
  const [fps, setFps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { Promise.all(reviewers.map((r) => fingerprint(r.mlkem_public, r.x25519_public))).then(setFps).catch(() => setFps([])); }, [reviewers]);

  async function submit() {
    setErr(null);
    const amountQor = Number(f.amountQor), deliveryDays = Number(f.deliveryDays);
    if (!f.vendorName.trim()) return setErr("Enter your company name.");
    if (!(amountQor > 0)) return setErr("Enter your price in QOR.");
    if (!Number.isInteger(deliveryDays) || deliveryDays < 1) return setErr("Delivery time must be a whole number of days.");
    if (f.approach.trim().length < 20) return setErr("Describe your approach in at least a sentence or two.");
    if (reviewers.length === 0) return setErr("No reviewer has published a reading key, so this bid cannot be sealed.");
    setBusy(true);
    try {
      const plaintext = JSON.stringify({ vendorName: f.vendorName.trim(), amountQor, deliveryDays, approach: f.approach.trim(), ...(f.references.trim() ? { references: f.references.trim() } : {}) });
      const { text, sha256 } = await sealBid(tenderId, reviewers.map((r) => ({ mlkem: r.mlkem_public, x25519: r.x25519_public })), plaintext);
      const r = await submitSealedBid(tenderId, f.vendorName.trim(), text, sha256);
      if (r.error) setErr(r.error); else setDone(true);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  if (done) return <p className="text-sm">Your bid was sealed in this browser and submitted. The organisation cannot read it until bidding closes. <Badge tone="live">SEALED</Badge></p>;
  const field = (label: string, k: keyof typeof f, ph = "") => (<div><label className="mb-1 block text-xs text-text-2">{label}</label><input className={inputCls} value={f[k]} onChange={set(k)} placeholder={ph} /></div>);
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">{field("Company name", "vendorName")}{field(`Price (QOR, budget ${budgetQor})`, "amountQor")}{field("Delivery (days)", "deliveryDays")}</div>
      <div><label className="mb-1 block text-xs text-text-2">Your approach</label><textarea className={inputCls} rows={5} value={f.approach} onChange={set("approach")} /></div>
      {field("References (optional)", "references")}
      <p className="text-xs text-text-2">Sealed in your browser to {reviewers.length} reviewer{reviewers.length === 1 ? "" : "s"} (ML-KEM-1024 + X25519). Reviewer key fingerprints: {fps.length ? fps.map((x, i) => <span key={i} className="font-mono">{x}{i < fps.length - 1 ? " · " : ""}</span>) : "…"}. If you can, confirm one with the organisation through another channel.</p>
      <button className={btnCls} disabled={busy} onClick={submit}>{busy ? "Sealing…" : "Seal and submit bid"}</button>
      {err && <p role="alert" className="text-[var(--fail-text)]">{err}</p>}
    </div>
  );
}
