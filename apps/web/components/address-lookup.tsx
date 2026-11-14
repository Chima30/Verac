"use client";
import { Search } from "lucide-react";
import { useState } from "react";
import { Badge, Card, KV, btnCls, inputCls } from "./ui";

type Part = { ok: true; data?: unknown; wei?: string; qor?: string } | { ok: false; error: string };
interface Result {
  address: string; nativeAddress: string;
  balance: Part; window: Part; pqc: Part; kem: Part; rules: Part; authenticators: Part;
}
type Focus = "balance" | "pq" | "wallet";

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

function Section({ title, part, empty }: { title: string; part: Part; empty?: string }) {
  return (
    <Card title={title} right={part.ok ? <Badge tone="live" /> : <Badge tone="unavailable" />}>
      {part.ok ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{part.data === undefined || part.data === null ? (empty ?? "No data returned.") : pretty(part.data)}</pre>
      ) : (
        <p className="text-sm text-muted">Query failed: {part.error}</p>
      )}
    </Card>
  );
}

export function AddressLookup({ focus }: { focus: Focus }) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setRes(null);
    try {
      const r = await fetch(`/api/chain/lookup?address=${encodeURIComponent(address.trim())}`);
      const j = (await r.json()) as Result & { error?: string };
      if (!r.ok) setError(j.error ?? `Request failed (${r.status})`); else setRes(j);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Card title="Look up an address on Diana testnet">
        <form onSubmit={run} className="flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="addr">EVM address</label>
          <input id="addr" className={`${inputCls} font-mono`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
          <button className={btnCls} disabled={busy || address.trim().length === 0} type="submit"><Search size={16} aria-hidden /> {busy ? "Querying…" : "Query chain"}</button>
        </form>
        <p className="mt-2 text-xs text-muted">Public address only. Never paste a private key or seed phrase here. This is a read-only query; nothing is signed or sent.</p>
        {error && <p role="alert" className="mt-3 text-sm text-[var(--bad)]">{error}</p>}
      </Card>

      {res && (
        <>
          <Card title="Account" right={<Badge tone="live" />}>
            <KV rows={[["EVM address", res.address], ["Native address", res.nativeAddress],
              ["Balance", res.balance.ok ? `${res.balance.qor} QOR (${res.balance.wei} wei)` : `unavailable: ${res.balance.error}`]]} />
          </Card>
          {(focus === "balance" || focus === "wallet") && <Section title="Spending rules" part={res.rules} empty="No spending rules found." />}
          {(focus === "pq" || focus === "wallet") && <Section title="Post-quantum key status" part={res.pqc} empty="No PQC key registered for this account." />}
          {focus !== "balance" && <Section title="EVM authorisation window" part={res.window} empty="No window found." />}
          {focus === "pq" && <Section title="QoreSeal KEM key" part={res.kem} empty="No KEM key registered." />}
          {focus === "wallet" && <Section title="Delegated authenticators" part={res.authenticators} empty="None registered." />}
        </>
      )}
    </div>
  );
}
