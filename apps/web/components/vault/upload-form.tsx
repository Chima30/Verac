"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { uploadDocument } from "@/app/(app)/vault/actions";
import { Badge, btnCls, inputCls } from "@/components/ui";
import { sealDocument } from "@/lib/seal-browser";

export interface Reader { user_id: string; role: string; mlkem_public: string; x25519_public: string }
const MAX_BYTES = 150 * 1024;

/** Seals the note or file in this browser to the chosen readers' public keys. The server receives ciphertext only. */
export function UploadForm({ readers, me }: { readers: Reader[]; me: string }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [picked, setPicked] = useState<string[]>([me]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  const toggle = (id: string) => setPicked((p) => (id === me ? p : p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function submit() {
    setErr(null);
    if (title.trim().length < 1) return setErr("Give the document a title.");
    if (!file && note.trim().length < 1) return setErr("Write a note or choose a file.");
    if (file && file.size > MAX_BYTES) return setErr("Files are limited to 150 KB for now.");
    const chosen = readers.filter((r) => picked.includes(r.user_id));
    if (!chosen.some((r) => r.user_id === me)) return setErr("You have not published a reading key yet, so you cannot be a reader.");
    setBusy(true);
    try {
      let payload: Record<string, string>;
      if (file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
        payload = { kind: "file", name: file.name, type: file.type || "application/octet-stream", data: btoa(bin), note: note.trim() };
      } else payload = { kind: "text", text: note.trim() };
      const id = crypto.randomUUID();
      const { text, sha256 } = await sealDocument(id, chosen.map((r) => ({ mlkem: r.mlkem_public, x25519: r.x25519_public })), JSON.stringify(payload));
      if (text.length > 900_000) throw new Error("The sealed document is too large to upload. Use a smaller file.");
      const r = await uploadDocument(id, title.trim(), text, sha256, chosen.map((x) => x.user_id));
      if (r.error) setErr(r.error); else { setDone(true); setTitle(""); setNote(""); setFile(null); router.refresh(); }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2 text-sm">
      <input className={inputCls} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="Title (visible to administrators; it is not encrypted)" />
      <textarea className={inputCls} rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Private note (encrypted), or a description of the file" />
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <fieldset className="rounded-md border border-line p-3">
        <legend className="px-1 text-xs text-muted">Who can read it</legend>
        {readers.map((r) => (
          <label key={r.user_id} className="mr-4 inline-flex items-center gap-1">
            <input type="checkbox" checked={picked.includes(r.user_id)} disabled={r.user_id === me} onChange={() => toggle(r.user_id)} />
            <span className="font-mono text-xs">{r.user_id.slice(0, 8)}</span> <span className="text-muted">{r.role}{r.user_id === me ? " (you)" : ""}</span>
          </label>
        ))}
        {readers.length <= 1 && <p className="text-xs text-muted">Only members who have published a reading key can be chosen. Ask your team to open this page and publish theirs.</p>}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button className={btnCls} disabled={busy} onClick={submit}>{busy ? "Sealing…" : "Seal and upload"}</button>
        <Badge tone="neutral">SEALED IN YOUR BROWSER</Badge>
      </div>
      <p className="text-xs text-muted">ML-KEM-1024 + X25519, AES-GCM, bound to this document. Up to 150 KB. To add a reader later, upload a new sealed copy.</p>
      {done && <p role="status">Sealed and uploaded.</p>}
      {err && <p role="alert" className="text-[var(--bad)]">{err}</p>}
    </div>
  );
}
