"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Card, btnCls, inputCls } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const sb = supabaseBrowser();
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/settings/organization";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return;
    setBusy(true); setMsg(null);
    if (mode === "up") {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) setMsg({ kind: "error", text: error.message });
      else if (!data.session) setMsg({ kind: "info", text: "Account created. Check your email to confirm it, then sign in." });
      else { router.push(safeNext); router.refresh(); }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) setMsg({ kind: "error", text: error.message });
      else { router.push(safeNext); router.refresh(); }
    }
    setBusy(false);
  }

  if (!sb) {
    return <Card title="Sign-in is not configured"><p className="text-[13.5px] text-muted">This deployment has no Supabase project connected, so there are no accounts. The read-only pages work without signing in.</p></Card>;
  }
  return (
    <Card title={mode === "in" ? "Sign in" : "Create an account"}>
      <form onSubmit={submit} className="space-y-3">
        <div><label htmlFor="email" className="mb-1.5 block text-[12.5px] font-medium text-muted">Email</label>
          <input id="email" type="email" required autoComplete="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label htmlFor="pw" className="mb-1.5 block text-[12.5px] font-medium text-muted">Password (8+ characters)</label>
          <input id="pw" type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button className={`${btnCls} w-full`} disabled={busy} type="submit">{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}</button>
        {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-[13.5px] ${msg.kind === "error" ? "text-[var(--bad)]" : "text-muted"}`}>{msg.text}</p>}
      </form>
      <button type="button" className="mt-4 text-[13.5px] text-muted underline" onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }}>
        {mode === "in" ? "No account yet? Create one" : "Already have an account? Sign in"}
      </button>
    </Card>
  );
}

const POINTS = [
  ["Agents advise, people decide", "Fifteen AI agents with fixed tool lists. Only PaymentAgent can submit a payment, and only after a second person approves."],
  ["Limits live on chain", "Spending caps and approved recipients are enforced by the TreasuryVault contract, not by this website."],
  ["Every claim has a receipt", "Live Proof re-reads each testnet transaction from QoreChain Diana and flags any mismatch."],
];

export default function LoginPage() {
  const name = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Verac";
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_minmax(26rem,32rem)]">
      <section aria-label={`About ${name}`} className="hidden flex-col justify-between border-r border-line bg-surface-2/60 p-12 lg:flex">
        <span className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight"><span aria-hidden className="grid size-8 place-items-center rounded-lg bg-ink text-bg"><svg viewBox="0 0 20 20" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5l6 10 6-10" /><path d="M7.5 5h5" opacity=".55" /></svg></span>{name}</span>
        <div className="max-w-lg">
          <h2 className="text-[30px] font-semibold leading-tight tracking-tight">Financial operations run by AI agents, under rules you can verify.</h2>
          <ul className="mt-8 space-y-5">{POINTS.map(([t, d]) => <li key={t} className="border-l-2 border-accent pl-4"><p className="text-[14px] font-medium">{t}</p><p className="mt-0.5 text-[13.5px] leading-relaxed text-muted">{d}</p></li>)}</ul>
        </div>
        <p className="text-[12.5px] text-subtle">QoreChain Diana testnet only. Mainnet is disabled.</p>
      </section>
      <div className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-[24px] font-semibold tracking-tight">Welcome to {name}</h1>
          <p className="mb-6 mt-1 text-[13.5px] text-muted">Sign in to manage your organisation. Testnet only.</p>
          <Suspense><LoginForm /></Suspense>
          <a href="/dashboard" className="mt-6 inline-block text-[13.5px] text-muted underline underline-offset-[3px] hover:text-ink">Continue without signing in (read-only)</a>
        </div>
      </div>
    </main>
  );
}
