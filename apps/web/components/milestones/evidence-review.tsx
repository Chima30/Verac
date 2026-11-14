"use client";
import { useEffect, useState } from "react";
import { decideMilestone, fetchEvidence } from "@/app/(app)/milestones/actions";
import { Badge, btnCls, inputCls } from "@/components/ui";
import { keysFromSeedHex, loadSeed, openEvidence } from "@/lib/seal-browser";

/** Opens sealed evidence with the reviewer's own key, in this browser, then lets them accept or reject. */
export function EvidenceReview({ milestoneId, orgId, userId }: { milestoneId: string; orgId: string; userId: string }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setHasKey(loadSeed(orgId, userId) !== null); }, [orgId, userId]);

  async function open() {
    setErr(null); setBusy(true);
    try {
      const seed = loadSeed(orgId, userId);
      if (!seed) throw new Error("No reading key in this browser. Restore your backup on the Procurement page.");
      const r = await fetchEvidence(milestoneId);
      if (r.error || !r.envelope) throw new Error(r.error ?? "No evidence.");
      const plain = openEvidence(milestoneId, r.envelope, keysFromSeedHex(seed));
      try { setText((JSON.parse(plain) as { description?: string }).description ?? plain); } catch { setText(plain); }
    } catch (e) { setErr(e instanceof Error && /decrypt|recipient|NOT_A_RECIPIENT/i.test(e.message) ? "This browser's key cannot open this evidence (it was not sealed to you)." : e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-2 text-sm">
      {text === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <button className={btnCls} disabled={busy || hasKey === false} onClick={open}>{busy ? "Opening…" : "Open evidence in this browser"}</button>
          <Badge tone="neutral">DECRYPTED ONLY IN YOUR BROWSER</Badge>
          {hasKey === false && <span className="text-[var(--fail-text)]">This browser has no reading key.</span>}
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap break-words rounded-md border border-line p-3">{text}</p>
          <form action={decideMilestone} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={milestoneId} />
            <input name="note" maxLength={500} className={`${inputCls} max-w-sm`} placeholder="Note for the record (optional)" />
            <button name="decision" value="approve" className={btnCls}>Accept milestone</button>
            <button name="decision" value="reject" className="inline-flex items-center rounded-md border border-line px-3.5 py-2 text-sm hover:bg-[var(--well)]">Reject</button>
          </form>
        </>
      )}
      {err && <p role="alert" className="text-[var(--fail-text)]">{err}</p>}
    </div>
  );
}
