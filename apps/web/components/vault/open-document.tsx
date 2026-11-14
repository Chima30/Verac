"use client";
import { useEffect, useState } from "react";
import { fetchDocument } from "@/app/(app)/vault/actions";
import { Badge, btnCls } from "@/components/ui";
import { keysFromSeedHex, loadSeed, openDocument, sha256Text } from "@/lib/seal-browser";

type Opened = { kind: "text"; text: string } | { kind: "file"; name: string; type: string; data: string; note?: string };

/** Fetches the ciphertext, checks it against the stored checksum, and decrypts it with this browser's key. */
export function OpenDocument({ id, orgId, userId }: { id: string; orgId: string; userId: string }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [out, setOut] = useState<Opened | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setHasKey(loadSeed(orgId, userId) !== null); }, [orgId, userId]);

  async function open() {
    setErr(null); setBusy(true);
    try {
      const seed = loadSeed(orgId, userId);
      if (!seed) throw new Error("No reading key in this browser. Restore your backup first.");
      const r = await fetchDocument(id);
      if (r.error || !r.envelope) throw new Error(r.error ?? "Nothing to open.");
      if ((await sha256Text(r.envelope)) !== r.sha256) throw new Error("The stored document does not match its checksum. Do not trust it.");
      const plain = openDocument(id, r.envelope, keysFromSeedHex(seed));
      setOut(JSON.parse(plain) as Opened);
    } catch (e) { setErr(e instanceof Error && /decrypt|recipient|NOT_A_RECIPIENT/i.test(e.message) ? "This browser's key cannot open this document (it was not sealed to your key)." : e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  function download(o: Extract<Opened, { kind: "file" }>) {
    const bin = atob(o.data); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" })); a.download = o.name.replace(/[^\w.\- ]/g, "_"); a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-2 text-sm">
      {!out ? (
        <div className="flex flex-wrap items-center gap-3">
          <button className={btnCls} disabled={busy || hasKey === false} onClick={open}>{busy ? "Opening…" : "Open in this browser"}</button>
          <Badge tone="neutral">DECRYPTED ONLY IN YOUR BROWSER</Badge>
          {hasKey === false && <span className="text-[var(--bad)]">This browser has no reading key.</span>}
        </div>
      ) : out.kind === "text" ? (
        <p className="whitespace-pre-wrap break-words rounded-md border border-line p-3">{out.text}</p>
      ) : (
        <div className="space-y-2 rounded-md border border-line p-3">
          <p>File: <strong className="break-all">{out.name}</strong></p>
          {out.note && <p className="whitespace-pre-wrap break-words">{out.note}</p>}
          <button className={btnCls} onClick={() => download(out)}>Download file</button>
        </div>
      )}
      {err && <p role="alert" className="text-[var(--bad)]">{err}</p>}
    </div>
  );
}
