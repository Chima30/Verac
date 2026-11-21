import { Badge, type Tone } from "@/components/ui";
import { StartNav, recordedLabel } from "@/components/start-nav";
import { GRANTS_RUN as R } from "@/lib/start";

export const metadata = { title: "A grant application investigated" };

const REC: Record<string, { text: string; tint: string }> = {
  strong_candidate: { text: "Strong candidate", tint: "mint" },
  needs_clarification: { text: "Needs clarification", tint: "peach" },
  further_review: { text: "Further review", tint: "blush" },
};
const EV: Record<string, Tone> = { VERIFIED: "live", PARTIALLY_VERIFIED: "info", UNVERIFIED: "pending", CONTRADICTED: "failed", UNAVAILABLE: "unavailable" };

/** Replay of the grants dry run (deployments/grants-sample-dryrun.json): real GitHub, Diana and Gemini on fictional applications. */
export default function GrantsReplay() {
  return (
    <>
      {recordedLabel(`${new Date(R.ranAt).toISOString().slice(0, 10)} · sample programme, fictional applicants`)}
      <header className="mb-10">
        <h1 className="text-[32px] font-medium leading-[1.15] tracking-[-0.02em] sm:text-[40px]">Three applications, investigated.<span className="block text-muted">The AI scores. People award.</span></h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-[1.35] tracking-[-0.01em] text-muted">
          The applicants are fictional; the checks were real. Agents read GitHub, checked claimed contracts on Diana and scored a
          published rubric with Gemini, citing evidence for every score. Budget and milestones are scored by fixed rules. A
          different administrator would still have to award, and money moves only through the treasury.
        </p>
      </header>

      <div className="space-y-6">
        {R.results.map((r) => {
          const rec = REC[r.recommendation.recommendation] ?? { text: r.recommendation.recommendation, tint: "sky" };
          const scored = r.scores.filter((s) => s.state === "scored");
          const pts = scored.reduce((t, s) => t + (s.score ?? 0), 0), max = scored.reduce((t, s) => t + s.max, 0);
          const ruleQ = r.questions.filter((q) => q.about !== "AI-drafted (optional)");
          return (
            <article key={r.app} className="overflow-hidden rounded-[4px] border border-line bg-surface">
              <header className="flex flex-wrap items-end justify-between gap-4 p-6" style={{ background: `var(--tint-${rec.tint})`, color: "var(--tint-ink)" }}>
                <div>
                  <p className="label-mono">{rec.text}</p>
                  <h2 className="mt-3 text-[28px] font-medium tracking-[-0.015em]">{r.app.replace("SAMPLE ", "")}</h2>
                  <p className="mt-1 max-w-xl text-[14px]" style={{ color: "var(--tint-sub)" }}>{r.recommendation.why}</p>
                </div>
                {max > 0 && <p className="text-[48px] font-medium leading-none tracking-[-0.03em] tabular-nums">{Math.round(pts)}<span className="ml-1 font-mono text-[13px]">/ {max}</span></p>}
              </header>
              <div className="grid grid-cols-1 gap-8 p-6 lg:grid-cols-2">
                <section>
                  <h3 className="label-mono text-muted">Evidence the agents checked</h3>
                  <ul className="mt-3 space-y-3">
                    {r.evidence.slice(0, 5).map((e) => (
                      <li key={e.ref + e.claim} className="text-[14px] leading-[1.35] tracking-[-0.01em]">
                        <span className="flex flex-wrap items-center gap-2"><Badge tone={EV[e.status] ?? "neutral"}>{e.status.replace("_", " ")}</Badge><span className="font-medium">{e.claim}</span></span>
                        <span className="mt-1 block text-muted">{e.reason}</span>
                      </li>
                    ))}
                    {r.evidence.length === 0 && <li className="text-[14px] text-muted">No repository, contract or website was given, so there was nothing to check. Not counted against the applicant.</li>}
                  </ul>
                </section>
                <section>
                  {r.flags.length > 0 && (
                    <>
                      <h3 className="label-mono text-muted">Flags for a person</h3>
                      <ul className="mt-3 mb-6 space-y-2">{r.flags.map((f) => <li key={f.code + f.message} className="text-[14px] leading-[1.35]"><Badge tone={f.severity === "high" ? "failed" : f.severity === "medium" ? "approval" : "neutral"}>{f.severity}</Badge> <span className="text-muted">{f.message}</span></li>)}</ul>
                    </>
                  )}
                  <h3 className="label-mono text-muted">{ruleQ.length ? "Questions drafted for the applicant" : "Questions"}</h3>
                  {ruleQ.length ? <ul className="mt-3 space-y-2">{ruleQ.slice(0, 4).map((q) => <li key={q.question} className="text-[14px] leading-[1.35] text-muted">{q.question}</li>)}</ul>
                    : <p className="mt-3 text-[14px] text-muted">None required: the application is complete.</p>}
                </section>
              </div>
            </article>
          );
        })}
      </div>
      <p className="mt-6 max-w-3xl text-[14px] leading-[1.4] text-muted">Alpha links Verac's own public repository so its evidence is real; the report also says a link does not prove ownership. The agents were also attacked with hidden instructions in applications: the model raised no score, and every attempt was flagged for a person.</p>

      <StartNav current="/start/grants" />
    </>
  );
}
