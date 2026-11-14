"use client";
import { useState } from "react";
import { submitEvidence } from "@/app/(app)/milestones/actions";
import { btnCls, inputCls } from "@/components/ui";
import { sealEvidence } from "@/lib/seal-browser";

interface Reviewer { user_id: string; mlkem_public: string; x25519_public: string }

/** Seals the evidence in this browser to the reviewers' public keys; the server receives ciphertext only. */
export function EvidenceForm({ milestoneId, reviewers }: { milestoneId: string; reviewers: Reviewer[] }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function submit() {
    setErr(null);
    if (text.trim().length < 10) return setErr("Describe what was delivered (at least a sentence).");
    if (reviewers.length === 0) return setErr("No reviewer has published a reading key, so this cannot be sealed.");
    setBusy(true);
    try {
      const { text: env, sha256 } = await sealEvidence(milestoneId, reviewers.map((r) => ({ mlkem: r.mlkem_public, x25519: r.x25519_public })), JSON.stringify({ description: text.trim() }));
      const r = await submitEvidence(milestoneId, env, sha256);
      if (r.error) setErr(r.error); else setDone(true);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  if (done) return <p className="text-sm">Evidence sealed in your browser and submitted. Reload to see its status.</p>;
  return (
    <div className="space-y-2 text-sm">
      <textarea className={inputCls} rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you deliver? Include links or reference numbers." />
      <button className={btnCls} disabled={busy} onClick={submit}>{busy ? "Sealing…" : "Seal and submit evidence"}</button>
      <p className="text-xs text-muted">Sealed to {reviewers.length} reviewer{reviewers.length === 1 ? "" : "s"} (ML-KEM-1024 + X25519), bound to this milestone.</p>
      {err && <p role="alert" className="text-[var(--bad)]">{err}</p>}
    </div>
  );
}
