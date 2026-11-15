"use client";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
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
        <pre className="scroll-quiet max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-3 font-mono text-[12px] leading-relaxed">{part.data === undefined || part.data === null ? (empty ?? "No data returned.") : pretty(part.data)}</pre>
      ) : (
        <p className="text-[13.5px] text-muted">Query failed: {part.error}</p>
      )}
    </Card>
  );
}

export function AddressLookup({ focus, presetAddress }: { focus: Focus; presetAddress?: string }) {
  const [address, setAddress] = useState(presetAddress ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);

  // A connected wallet's address is queried straight away (the same read-only lookup, so everything shown comes from the chain).
  useEffect(() => {
    if (presetAddress) { setAddress(presetAddress); void query(presetAddress); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetAddress]);

  function run(e: React.FormEvent) { e.preventDefault(); return query(address); }

  async function query(addr: string) {
    setBusy(true); setError(null); setRes(null);
    try {
      const r = await fetch(`/api/chain/lookup?address=${encodeURIComponent(addr.trim())}`);
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
        <p className="mt-2 text-[12px] text-muted">Public address only. Never paste a private key or seed phrase here. This is a read-only query; nothing is signed or sent.</p>
        {error && <p role="alert" className="mt-3 text-[13px] text-[var(--bad)]">{error}</p>}
      </Card>

      {res && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card title="Account" right={<Badge tone="live" />} className="md:col-span-2">
            <KV rows={[["EVM address", res.address], ["Native address", res.nativeAddress],
              ["Balance", res.balance.ok ? `${res.balance.qor} QOR (${res.balance.wei} wei)` : `unavailable: ${res.balance.error}`]]} />
          </Card>
          {(focus === "balance" || focus === "wallet") && <Section title="Spending rules" part={res.rules} empty="No spending rules found." />}
          {(focus === "pq" || focus === "wallet") && <Section title="Post-quantum key status" part={res.pqc} empty="No PQC key registered for this account." />}
          {focus !== "balance" && <Section title="EVM authorisation window" part={res.window} empty="No window found." />}
          {focus === "pq" && <Section title="QoreSeal KEM key" part={res.kem} empty="No KEM key registered." />}
          {focus === "wallet" && <Section title="Delegated authenticators" part={res.authenticators} empty="None registered." />}
        </div>
      )}
    </div>
  );
}
