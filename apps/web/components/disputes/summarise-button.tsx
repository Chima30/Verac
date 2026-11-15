"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnCls } from "@/components/ui";

/** Asks Gemini for a neutral summary of the statements. Sends them to Google's free-tier API. */
export function SummariseButton({ id, again }: { id: string; again: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  async function run() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/disputes/summarise", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) setErr(j.error ?? "Failed."); else router.refresh();
    } catch { setErr("Could not reach the server."); } finally { setBusy(false); }
  }
  return (
    <div className="text-[13.5px]">
      <button className={btnCls} disabled={busy} onClick={run}>{busy ? "Summarising…" : again ? "Run AI summary again" : "Run AI summary"}</button>
      <span className="ml-2 text-[12.5px] text-muted">Sends the statements to Gemini (free tier).</span>
      {err && <p role="alert" className="mt-1 text-[var(--bad)]">{err}</p>}
    </div>
  );
}
