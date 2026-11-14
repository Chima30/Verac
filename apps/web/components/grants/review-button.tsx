"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnCls } from "@/components/ui";

/** Asks Gemini for an advisory read of one pitch. Sends the pitch to Google's free-tier API. */
export function ReviewButton({ id, again }: { id: string; again: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  async function run() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/grants/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) setErr(j.error ?? "Failed."); else router.refresh();
    } catch { setErr("Could not reach the server."); } finally { setBusy(false); }
  }
  return (
    <div className="text-sm">
      <button className={btnCls} disabled={busy} onClick={run}>{busy ? "Reviewing…" : again ? "Run AI review again" : "Run AI review"}</button>
      <span className="ml-2 text-xs text-muted">Sends the pitch to Gemini (free tier).</span>
      {err && <p role="alert" className="mt-1 text-[var(--bad)]">{err}</p>}
    </div>
  );
}
