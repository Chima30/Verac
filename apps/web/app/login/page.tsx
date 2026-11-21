"use client";
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck, Users } from "lucide-react";
import { LogoMark } from "@/components/logo";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useId, useState } from "react";
import { Notice } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Supabase reports network failures as "Failed to fetch". Say what that means instead. */
const explain = (m: string) => (/failed to fetch|network|fetch failed|load failed/i.test(m) ? "Could not reach the sign-in service. Check your connection and try again; nothing was changed." : m);
const field = "h-11 w-full rounded-lg border bg-white px-3.5 text-[15px] text-ink transition-[border-color,box-shadow] placeholder:text-subtle focus:outline-none focus:ring-4";
const ok = "border-[#d9d9de] hover:border-[#bdbdc4] focus:border-[var(--accent)] focus:ring-[color-mix(in_srgb,var(--accent)_16%,transparent)]";
const bad = "border-[var(--bad)] focus:border-[var(--bad)] focus:ring-[color-mix(in_srgb,var(--bad)_14%,transparent)]";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const id = useId();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const sb = supabaseBrowser();
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/settings/organization";

  const emailErr = touched.email && !EMAIL.test(email.trim()) ? "Enter a valid email address." : null;
  const pwErr = touched.password && password.length < 8 ? "Use at least 8 characters." : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (!sb || !EMAIL.test(email.trim()) || password.length < 8) return;
    setBusy(true); setMsg(null);
    if (mode === "up") {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) setMsg({ kind: "error", text: explain(error.message) });
      else if (!data.session) setMsg({ kind: "info", text: "Account created. Check your email to confirm it, then sign in." });
      else { router.push(safeNext); router.refresh(); }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) setMsg({ kind: "error", text: explain(error.message) });
      else { router.push(safeNext); router.refresh(); }
    }
    setBusy(false);
  }

  if (!sb) {
    return (
      <div className="rounded-2xl border border-[#d6d6d6] bg-white p-7 ">
        <h2 className="text-[20px] font-bold tracking-[-0.02em]">Sign-in is not configured</h2>
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted">This deployment has no Supabase project connected, so there are no accounts yet. Every read-only page still works.</p>
        <Link href="/dashboard" className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[4px] bg-primary font-mono text-[13px] font-medium uppercase text-primary-ink">Open the dashboard<ArrowRight size={16} aria-hidden /></Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#d6d6d6] bg-white p-6  sm:p-8">
      <div role="tablist" aria-label="Account" className="grid grid-cols-2 rounded-lg bg-[#f1f1f3] p-1 text-[13.5px] font-semibold">
        {(["in", "up"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setMsg(null); }}
            className={`h-9 rounded-md transition-[background-color,color,box-shadow] ${mode === m ? "bg-[#c8f6f9] text-ink" : "text-subtle hover:text-ink"}`}>
            {m === "in" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <h2 className="mt-7 text-[22px] font-bold tracking-[-0.025em]">{mode === "in" ? "Welcome back" : "Create your account"}</h2>
      <p className="mt-1 text-[14px] text-muted">{mode === "in" ? "Sign in to review and approve your organisation's work." : "You can create or join an organisation next."}</p>

      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        <div>
          <label htmlFor={`${id}-email`} className="mb-1.5 block text-[13px] font-semibold text-ink">Work email</label>
          <input id={`${id}-email`} type="email" required autoComplete="email" inputMode="email" value={email}
            onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            aria-invalid={!!emailErr} aria-describedby={emailErr ? `${id}-email-err` : undefined}
            className={`${field} ${emailErr ? bad : ok}`} placeholder="you@organisation.com" />
          {emailErr && <p id={`${id}-email-err`} className="mt-1.5 text-[13px] text-[var(--bad)]">{emailErr}</p>}
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between"><label htmlFor={`${id}-pw`} className="block text-[13px] font-semibold text-ink">Password</label><span className="text-[12px] text-subtle">8 characters or more</span></div>
          <div className="relative">
            <input id={`${id}-pw`} type={show ? "text" : "password"} required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} value={password}
              onChange={(e) => setPassword(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              aria-invalid={!!pwErr} aria-describedby={pwErr ? `${id}-pw-err` : undefined}
              className={`${field} pr-11 ${pwErr ? bad : ok}`} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
              className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-subtle hover:bg-[#f1f1f3] hover:text-ink">
              {show ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
            </button>
          </div>
          {pwErr && <p id={`${id}-pw-err`} className="mt-1.5 text-[13px] text-[var(--bad)]">{pwErr}</p>}
        </div>

        {msg && <Notice tone={msg.kind === "error" ? "bad" : "info"} role={msg.kind === "error" ? "alert" : "status"}>{msg.text}</Notice>}

        <button type="submit" disabled={busy} aria-busy={busy}
          className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-[4px] bg-primary font-mono text-[13px] font-medium uppercase text-primary-ink transition-[background-color,transform] hover:bg-primary-hover active:translate-y-px disabled:opacity-70">
          {busy ? <><Loader2 size={17} className="animate-spin" aria-hidden />{mode === "in" ? "Signing in…" : "Creating account…"}</> : <>{mode === "in" ? "Sign in" : "Create account"}<ArrowRight size={16} aria-hidden className="transition-transform group-hover:translate-x-0.5" /></>}
        </button>
      </form>

      <p className="mt-6 flex items-start gap-2 border-t border-[#ececef] pt-5 text-[12.5px] leading-relaxed text-subtle">
        <LockKeyhole size={14} className="mt-0.5 shrink-0" aria-hidden />
        Your password is checked by Supabase Auth and never stored by Verac. Verac never asks for wallet keys or seed phrases.
      </p>
    </div>
  );
}

const FACTS = [
  { Icon: Users, title: "Two people per payment", text: "Whoever requests a payment can never approve it." },
  { Icon: ShieldCheck, title: "Limits enforced on chain", text: "Agent caps and approved recipients live in the vault contract." },
  { Icon: LockKeyhole, title: "Every claim has a receipt", text: "Live Proof re-reads each testnet transaction." },
];

export default function LoginPage() {
  const name = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Verac";
  return (
    <main className="theme-light relative isolate min-h-dvh overflow-hidden bg-[#fafafa]">

      <header className="relative mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <span className="flex items-center gap-2.5 text-[20px] font-medium tracking-[-0.03em]">
          <LogoMark size={30} />
          {name}
        </span>
        <nav aria-label="Public pages" className="flex items-center gap-1 text-[14px] font-medium">
          <Link href="/proof" className="hidden rounded-md px-3 py-2 text-muted hover:text-ink sm:inline-block">Live Proof</Link>
          <Link href="/start" className="rounded-md px-3 py-2 text-muted hover:text-ink">Start here</Link>
        </nav>
      </header>

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[1.15fr_minmax(24rem,28rem)] lg:gap-x-16 lg:gap-y-10 lg:pt-16">
        <section aria-labelledby="hero-h" className="lg:col-start-1 lg:row-start-1">
          <p className="inline-flex items-center gap-2 rounded-[4px] border border-[#d6d6d6] bg-white px-3 py-1 font-mono text-[11px] font-medium uppercase text-muted">
            <span aria-hidden className="size-1.5 rounded-full bg-[var(--live)]" />QoreChain Diana testnet · mainnet disabled
          </p>
          <h1 id="hero-h" className="mt-6 max-w-[14ch] text-[44px] font-extrabold leading-[0.98] tracking-[-0.045em] sm:text-[60px] lg:text-[72px]">
            Operate your treasury <span className="text-muted">with control.</span>
          </h1>
          <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-muted sm:text-[18px]">
            AI agents draft, check and explain. Policy decides what is allowed, a second person approves, and the contract enforces the limits. Every payment ends with a receipt you can verify.
          </p>
        </section>

        <section aria-label="Sign in" className="w-full lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
          <Suspense><LoginForm /></Suspense>
          <p className="mt-5 text-center text-[13.5px] text-muted">Just looking? <Link href="/start" className="font-semibold text-ink underline decoration-[#c9c9cf] underline-offset-4 hover:decoration-ink">Take the three one-minute tours</Link></p>
        </section>
        <ul aria-label="How Verac keeps control" className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3 lg:col-start-1 lg:row-start-2 lg:self-start">
          {FACTS.map(({ Icon, title, text }) => (
            <li key={title} className="rounded-xl border border-[#d6d6d6] bg-white p-4">
              <Icon size={18} className="text-[var(--accent)]" aria-hidden />
              <p className="mt-3 text-[14px] font-semibold leading-snug">{title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
