import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ArchitectureDiagram } from "@/components/architecture-diagram";
import { btnCls, btnSecondaryCls } from "@/components/ui";
import { GRANTS_RUN, V2_RUN } from "@/lib/start";

export const metadata = { title: "Start here" };

const PATHS = [
  { href: "/start/invoices", tint: "sky", label: "One minute", title: "Watch six agents review three invoices", body: "One instruction. One invoice paid, two held, one of them carrying a hidden instruction to the AI. The payment is on chain." },
  { href: "/start/attacks", tint: "peach", label: "One minute", title: "Try to steal from the vault", body: `Everything the server holds, ${V2_RUN.attacks.length} attempts. Every one refused, and each refusal is a transaction you can open.` },
  { href: "/start/grants", tint: "blush", label: "One minute", title: "See a grant application investigated", body: `${GRANTS_RUN.results.length} applications checked against GitHub, QoreChain and a published rubric. The AI scores; people award.` },
] as const;

/** The first page for someone who has never seen Verac: what it is in one picture, then three short guided proofs. */
export default async function StartHere({ searchParams }: { searchParams: Promise<{ judge?: string }> }) {
  const { judge } = await searchParams;
  const judgeReady = !!process.env.JUDGE_EMAIL?.trim() && !!process.env.JUDGE_PASSWORD?.trim();
  return (
    <>
      <header className="mb-12">
        <p className="label-mono text-muted">Start here · no account needed</p>
        <h1 className="mt-6 text-[40px] font-medium leading-[1.1] tracking-[-0.025em] sm:text-[56px] lg:text-[64px] lg:tracking-[-0.03em]">
          AI does the treasury work.<span className="block text-muted">It never holds the keys.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-[18px] leading-[1.35] tracking-[-0.01em] text-muted">
          Verac's agents check invoices and investigate grant applications for a DAO. People approve every payment with
          post-quantum keys the server never sees, and QoreChain enforces the limits. Everything below happened on Diana
          testnet and can be checked on the chain.
        </p>
      </header>

      {judgeReady && (
        <form action="/auth/judge" method="post" className="mb-10 flex flex-col gap-4 rounded-[4px] bg-[var(--band)] p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <p className="label-mono flex items-center gap-2 text-[var(--accent)]"><span aria-hidden className="inline-block h-[2px] w-3 bg-[var(--accent)]" />For judges</p>
            <p className="mt-3 max-w-xl text-[20px] font-medium leading-[1.25] tracking-[-0.015em]">Open the live product with one click. Read-only: look at everything, change nothing.</p>
          </div>
          <button className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-[4px] bg-white px-4 py-2 font-mono text-[13px] font-medium uppercase text-black">Enter as a judge<ArrowRight size={14} aria-hidden /></button>
        </form>
      )}
      {judge && <p role="alert" className="mb-10 rounded-[4px] bg-[var(--bad-bg)] px-4 py-3 text-[14px] text-[var(--bad)]">{judge}</p>}

      <section aria-labelledby="paths" className="mb-16">
        <h2 id="paths" className="sr-only">Three guided proofs</h2>
        <div className="stagger grid grid-cols-1 gap-3 lg:grid-cols-3">
          {PATHS.map((p) => (
            <Link key={p.href} href={p.href} className="group flex min-h-[15rem] flex-col rounded-[4px] p-6 text-[var(--tint-ink)]" style={{ background: `var(--tint-${p.tint})` }}>
              <span className="label-mono">{p.label}</span>
              <span className="mt-5 text-[24px] font-medium leading-[1.15] tracking-[-0.015em]">{p.title}</span>
              <span className="mt-3 text-[15px] leading-[1.35] tracking-[-0.01em]" style={{ color: "var(--tint-sub)" }}>{p.body}</span>
              <span className="label-mono mt-auto inline-flex items-center gap-2 pt-6">Start<ArrowRight size={14} aria-hidden className="transition-transform group-hover:translate-x-1" /></span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="how" className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h2 id="how" className="text-[28px] font-medium tracking-[-0.015em]">How Verac works</h2>
          <p className="mt-3 max-w-xl text-[16px] leading-[1.4] tracking-[-0.01em] text-muted">
            Each step can only narrow what the next one may do. The AI's output is advice that fixed rules check. The rules can
            only prepare a request. A request moves money only with two administrators' ML-DSA-87 signatures, which the vault
            verifies on chain, inside caps and authorisation windows that QoreChain enforces.
          </p>
          <ul className="mt-6 space-y-3 text-[15px] leading-[1.35] tracking-[-0.01em]">
            <li className="flex gap-3"><span aria-hidden className="mt-2 h-[2px] w-3 shrink-0 bg-[var(--ring)]" />A stolen server key cannot approve: the server holds no administrator key.</li>
            <li className="flex gap-3"><span aria-hidden className="mt-2 h-[2px] w-3 shrink-0 bg-[var(--ring)]" />A stolen classical key cannot spend: QoreChain also requires the ML-DSA-87 half.</li>
            <li className="flex gap-3"><span aria-hidden className="mt-2 h-[2px] w-3 shrink-0 bg-[var(--ring)]" />A misleading invoice cannot pay itself: instructions in it are treated as a warning sign.</li>
          </ul>
          <div className="mt-8 flex flex-wrap gap-2">
            <Link href="/proof" className={btnCls}>Verify everything on Live Proof</Link>
            <Link href="/login" className={btnSecondaryCls}>Sign in to the live product</Link>
          </div>
        </div>
        <div className="flex justify-center rounded-[4px] border border-line bg-surface p-6 sm:p-8"><ArchitectureDiagram /></div>
      </section>
    </>
  );
}
