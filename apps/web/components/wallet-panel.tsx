"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Card, btnCls } from "@/components/ui";
import { AddressLookup } from "@/components/address-lookup";
import { checkNetwork, explainQorexError, isEvmAddress, isQorexAnnouncement, parseChainId } from "@/lib/qorex";

interface Eip1193 { request(args: { method: string; params?: unknown[] }): Promise<unknown> }

/**
 * Connects the QoreX browser wallet for READING and identification only. QoreX's EVM provider cannot send transactions yet, so
 * Verac never asks it to; payments are sent by the server. Balance, post-quantum key and EVM window status come from the chain
 * (not from the wallet) through the same lookup used elsewhere.
 */
export function WalletPanel() {
  const provider = useRef<Eip1193 | null>(null);
  const [found, setFound] = useState<"looking" | "yes" | "no">("looking");
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Strict EIP-6963 discovery: only `network.qore.qorex`, never window.ethereum.
  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<{ info?: { rdns?: string }; provider?: Eip1193 }>).detail;
      if (isQorexAnnouncement(d) && d.provider) { provider.current = d.provider; setFound("yes"); }
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(() => setFound((f) => (f === "looking" ? "no" : f)), 800);
    return () => { window.removeEventListener("eip6963:announceProvider", onAnnounce); clearTimeout(t); };
  }, []);

  const read = useCallback(async (p: Eip1193, ask: boolean) => {
    const accounts = (await p.request({ method: ask ? "eth_requestAccounts" : "eth_accounts" })) as unknown[];
    const a = accounts?.[0];
    if (!isEvmAddress(a)) { setAddress(null); setChainId(null); return; }
    setAddress(a);
    setChainId(parseChainId(await p.request({ method: "eth_chainId" })));
  }, []);

  // QoreX does not emit accountsChanged / chainChanged yet, so re-read when the tab regains focus.
  useEffect(() => {
    if (!address) return;
    const onFocus = () => { if (provider.current) read(provider.current, false).catch(() => undefined); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [address, read]);

  async function connect() {
    if (!provider.current) return;
    setBusy(true); setError(null);
    try { await read(provider.current, true); } catch (e) { setError(explainQorexError(e)); }
    setBusy(false);
  }
  function disconnect() {
    // QoreX documents no disconnect call, so this only makes Verac forget the address in this tab.
    setAddress(null); setChainId(null); setError(null);
  }

  const verdict = checkNetwork(chainId);
  const badge = address
    ? verdict.ok ? <Badge tone="live">CONNECTED</Badge> : <Badge tone="failed">WRONG NETWORK</Badge>
    : found === "yes" ? <Badge tone="neutral">NOT CONNECTED</Badge> : <Badge tone="unavailable">{found === "looking" ? "LOOKING" : "NOT DETECTED"}</Badge>;

  return (
    <div className="space-y-4">
      <Card title="QoreX wallet" right={badge}>
        {found === "no" && !address && (
          <p className="text-sm text-muted">QoreX was not detected in this browser. Install the QoreX extension, reload this page and try again. Verac looks only for QoreX (it never uses another wallet).</p>
        )}
        {found !== "no" && !address && (
          <div className="flex flex-wrap items-center gap-3">
            <button className={btnCls} onClick={connect} disabled={busy || found !== "yes"}>{busy ? "Waiting for QoreX…" : "Connect QoreX"}</button>
            <span className="text-xs text-muted">Shows your address and chain status. It sends nothing and asks for no signature.</span>
          </div>
        )}
        {address && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_1fr]">
              <dt className="text-muted">Address</dt><dd className="break-all font-mono text-xs">{address}</dd>
              <dt className="text-muted">Network</dt><dd>{chainId === null ? "unknown" : `chain ${chainId}`}{verdict.ok ? " (Diana testnet)" : ""}</dd>
            </dl>
            {!verdict.ok && <p role="alert" className="text-[var(--bad)]">{verdict.reason}</p>}
            <button className="rounded-full border border-line px-4 py-2 text-sm hover:bg-surface-2" onClick={disconnect}>Disconnect</button>
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-[var(--bad)]">{error}</p>}
        <div className="mt-4 space-y-1 text-xs text-muted">
          <p>QoreX&apos;s EVM side cannot send contract transactions yet, so Verac never asks your wallet to sign a payment. Approved testnet payments are sent by the Verac server inside the vault&apos;s on-chain limits.</p>
          <p>Disconnect only clears the address from this page. QoreX has no documented disconnect call, so revoke the site&apos;s access inside QoreX if you want it gone.</p>
          <p>Opening and closing your own EVM authorisation window from this page is <strong>not built</strong>: the message format could not be verified without a real QoreX wallet, and a wrong guess is not worth the risk. Use the scripts in the repository for now.</p>
        </div>
      </Card>

      {address && verdict.ok
        ? <AddressLookup focus="wallet" presetAddress={address} />
        : <AddressLookup focus="wallet" />}
    </div>
  );
}
