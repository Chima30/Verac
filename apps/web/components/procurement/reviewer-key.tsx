"use client";
import { useEffect, useState } from "react";
import { publishReadingKey } from "@/app/(app)/procurement/actions";
import { Badge, btnCls, inputCls } from "@/components/ui";
import { fingerprint, isSeedHex, keysFromSeedHex, loadSeed, newSeedHex, publicKeysHex, saveSeed } from "@/lib/seal-browser";

/** Creates, backs up, restores and publishes a reviewer's reading key. The private seed never leaves this browser. */
export function ReviewerKey({ orgId, userId, publishedFingerprint, publish: publishAction, purpose = "Bids" }: { orgId: string; userId: string; publishedFingerprint: string | null; publish?: (mlkem: string, x25519: string) => Promise<{ error?: string }>; purpose?: string }) {
  const [seed, setSeed] = useState<string | null>(null);
  const [fp, setFp] = useState<string | null>(null);
  const [restore, setRestore] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => { setSeed(loadSeed(orgId, userId)); setReady(true); }, [orgId, userId]);
  useEffect(() => {
    if (!seed) { setFp(null); return; }
    const k = publicKeysHex(keysFromSeedHex(seed));
    fingerprint(k.mlkem, k.x25519).then(setFp).catch(() => setFp(null));
  }, [seed]);

  function create() {
    const s = newSeedHex();
    if (!saveSeed(orgId, userId, s)) { setErr("This browser would not store the key. Allow site data and try again."); return; }
    setSeed(s); setErr(null);
  }
  function doRestore() {
    const s = restore.trim().toLowerCase();
    if (!isSeedHex(s)) { setErr("A backup key is 64 characters, 0-9 and a-f."); return; }
    if (!saveSeed(orgId, userId, s)) { setErr("This browser would not store the key."); return; }
    setSeed(s); setRestore(""); setErr(null);
  }
  function download() {
    if (!seed) return;
    const blob = new Blob([`Verac reading key backup (keep private, never share)\n${seed}\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "verac-reading-key-backup.txt"; a.click();
    URL.revokeObjectURL(a.href);
  }
  async function publish() {
    if (!seed) return;
    setBusy(true); setErr(null);
    const k = publicKeysHex(keysFromSeedHex(seed));
    const r = await (publishAction ?? publishReadingKey)(k.mlkem, k.x25519);
    setBusy(false);
    if (r.error) setErr(r.error);
  }

  if (!ready) return null;
  const mismatch = publishedFingerprint && fp && publishedFingerprint !== fp;
  return (
    <div className="space-y-3 text-[13.5px]">
      <p className="text-muted">{purpose} are sealed so that only people holding a reading key can open them. Your key is created in this browser and never sent to the server. <strong>If you lose it, everything sealed to it cannot be recovered.</strong> Download the backup. The same key is used for bids, evidence and the vault.</p>
      {publishedFingerprint && <p>Published key fingerprint: <span className="font-mono text-[12.5px]">{publishedFingerprint}</span> <Badge tone="live">PUBLISHED</Badge></p>}
      {mismatch && <p role="alert" className="text-[var(--bad)]">The key stored in this browser does not match the one you published. Restore your backup, or you will not be able to open bids.</p>}
      {!seed ? (
        <div className="space-y-2">
          <button className={btnCls} onClick={create}>Create my reading key</button>
          <div className="flex flex-wrap items-end gap-2"><input className={`${inputCls} max-w-md font-mono text-[12.5px]`} placeholder="…or paste your backup (64 characters)" value={restore} onChange={(e) => setRestore(e.target.value)} /><button className="rounded-md border border-line px-3 py-2 text-[13.5px]" onClick={doRestore}>Restore</button></div>
        </div>
      ) : (
        <div className="space-y-2">
          <p>This browser holds your reading key. Fingerprint: <span className="font-mono text-[12.5px]">{fp ?? "…"}</span></p>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-md border border-line px-3 py-2 text-[13.5px]" onClick={download}>Download backup</button>
            {!publishedFingerprint && <button className={btnCls} disabled={busy} onClick={publish}>{busy ? "Publishing…" : "Publish my public key"}</button>}
          </div>
          {!publishedFingerprint && <p className="text-[12.5px] text-muted">Download the backup first. Publishing shares only the public half so others can seal to you.</p>}
        </div>
      )}
      {err && <p role="alert" className="text-[var(--bad)]">{err}</p>}
    </div>
  );
}
