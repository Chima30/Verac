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
    return <Card title="Sign-in is not configured"><p className="text-sm text-muted">This deployment has no Supabase project connected, so there are no accounts. The read-only pages work without signing in.</p></Card>;
  }
  return (
    <Card title={mode === "in" ? "Sign in" : "Create an account"}>
      <form onSubmit={submit} className="space-y-3">
        <div><label htmlFor="email" className="mb-1 block text-xs text-muted">Email</label>
          <input id="email" type="email" required autoComplete="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label htmlFor="pw" className="mb-1 block text-xs text-muted">Password (8+ characters)</label>
          <input id="pw" type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button className={`${btnCls} w-full`} disabled={busy} type="submit">{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}</button>
        {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-sm ${msg.kind === "error" ? "text-[var(--bad)]" : "text-muted"}`}>{msg.text}</p>}
      </form>
      <button type="button" className="mt-4 text-sm text-muted underline" onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }}>
        {mode === "in" ? "No account yet? Create one" : "Already have an account? Sign in"}
      </button>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">{process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Verac"}</h1>
      <p className="mb-6 text-sm text-muted">Sign in to manage your organisation. Testnet only.</p>
      <Suspense><LoginForm /></Suspense>
      <a href="/dashboard" className="mt-6 text-sm text-muted underline">Continue without signing in (read-only)</a>
    </main>
  );
}
