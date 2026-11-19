"use client";
import { useMemo, useState } from "react";
import { btnCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";

export interface AppFormValue {
  name: string; category: string; amountQor: string; recipient: string;
  content: {
    overview: string; problem: string; solution: string; team: string; experience: string; technical: string; metrics: string; timeline: string;
    links: { website: string; docs: string; demo: string; repos: string[] };
    contracts: string[]; transactions: string[];
    budget: Array<{ item: string; amountQor: string }>;
    milestones: Array<{ title: string; deliverable: string; verification: string; due: string; amountQor: string }>;
    declarations: { accurate: boolean; rights: boolean; conflicts_disclosed: boolean };
  };
}

const LABEL: Record<string, string> = { software: "Software", research: "Research", education: "Developer education", community: "Community or public goods", other: "Other" };

/** Sum of QOR strings as micro-QOR, without floating point. */
function micro(v: string): bigint | null {
  const m = /^(\d{1,15})(?:\.(\d{1,6})\d*)?$/.exec(v.trim());
  return m ? BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0")) : null;
}
const show = (u: bigint) => `${u / 1_000_000n}${u % 1_000_000n ? "." + (u % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "") : ""}`;

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return <div><label htmlFor={id} className={labelCls}>{label}</label>{children}{hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}</div>;
}

export function ApplicationForm({ grantId, categories, initial, amending, action }: {
  grantId: string; categories: string[]; initial: AppFormValue; amending: boolean; action: (f: FormData) => Promise<void>;
}) {
  const [v, setV] = useState<AppFormValue>(initial);
  const c = v.content;
  const set = (patch: Partial<AppFormValue>) => setV({ ...v, ...patch });
  const setC = (patch: Partial<AppFormValue["content"]>) => setV({ ...v, content: { ...c, ...patch } });
  const text = (key: "overview" | "problem" | "solution" | "team" | "experience" | "technical" | "metrics" | "timeline", label: string, hint: string, rows = 4, max = 6000) => (
    <Field id={`f-${key}`} label={label} hint={hint}>
      <textarea id={`f-${key}`} rows={rows} maxLength={max} className={inputCls} value={c[key]} onChange={(e) => setC({ [key]: e.target.value } as Partial<AppFormValue["content"]>)} />
    </Field>
  );
  const list = (key: "repos" | "contracts" | "transactions", label: string, placeholder: string, max: number, hint: string) => {
    const items = key === "repos" ? c.links.repos : c[key];
    const put = (next: string[]) => key === "repos" ? setC({ links: { ...c.links, repos: next } }) : setC({ [key]: next } as Partial<AppFormValue["content"]>);
    return (
      <div>
        <p className={labelCls}>{label}</p>
        <div className="space-y-2">
          {items.map((x, i) => (
            <div key={i} className="flex gap-2">
              <input aria-label={`${label} ${i + 1}`} className={`${inputCls} font-mono text-[12.5px]`} spellCheck={false} placeholder={placeholder} value={x} onChange={(e) => put(items.map((y, j) => (j === i ? e.target.value : y)))} />
              <button type="button" className={btnSecondaryCls} onClick={() => put(items.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          {items.length < max && <button type="button" className={`${btnSecondaryCls} min-h-8 text-[12.5px]`} onClick={() => put([...items, ""])}>Add</button>}
        </div>
        <p className="mt-1 text-[12px] text-muted">{hint}</p>
      </div>
    );
  };

  const totals = useMemo(() => {
    const req = micro(v.amountQor);
    const b = c.budget.reduce<bigint | null>((t, x) => (t === null ? null : micro(x.amountQor) === null ? null : t + micro(x.amountQor)!), 0n);
    const m = c.milestones.reduce<bigint | null>((t, x) => (t === null ? null : micro(x.amountQor) === null ? null : t + micro(x.amountQor)!), 0n);
    return { req, b, m };
  }, [v.amountQor, c.budget, c.milestones]);
  const sumNote = (got: bigint | null, what: string) =>
    totals.req === null ? `Enter the requested amount to check the ${what}.` : got === null ? `One ${what} amount is not a number.` : got === totals.req ? `Adds up to the request (${show(got)} QOR).` : `Adds up to ${show(got)} QOR; the request is ${show(totals.req)} QOR.`;

  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="grant" value={grantId} />
      <input type="hidden" name="payload" value={JSON.stringify(v)} />

      <fieldset className="space-y-4">
        <legend className="text-[15px] font-semibold">1. Project overview</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="f-name" label="Project or team name"><input id="f-name" maxLength={120} className={inputCls} value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field id="f-cat" label="Category" hint="The form and the evaluation criteria adapt to it. A public repository is never required.">
            <select id="f-cat" className={inputCls} value={v.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">Choose…</option>
              {categories.map((x) => <option key={x} value={x}>{LABEL[x] ?? x}</option>)}
            </select>
          </Field>
        </div>
        {text("overview", "Overview", "What you propose, in a few sentences.", 3)}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-[15px] font-semibold">2 to 6. The work</legend>
        {text("problem", "Problem being solved", "Who has this problem today, and how do you know?")}
        {text("solution", "Proposed solution", "What you will build or do.")}
        {text("team", "Team and contributors", "Who does the work and their roles.", 3, 4000)}
        {text("experience", "Relevant experience", "Previous work a reviewer can check. Optional.", 3, 4000)}
        {text("technical", "Technical implementation", v.category === "software" ? "Required for software: architecture, stack, current state." : "Optional for this category.", 4)}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-[15px] font-semibold">7. Repository and project links (all optional)</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {(["website", "docs", "demo"] as const).map((k) => (
            <Field key={k} id={`f-${k}`} label={k === "docs" ? "Documentation" : k[0]!.toUpperCase() + k.slice(1)}>
              <input id={`f-${k}`} className={`${inputCls} text-[13px]`} placeholder="https://…" value={c.links[k]} onChange={(e) => setC({ links: { ...c.links, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
        {list("repos", "GitHub repositories", "https://github.com/owner/name", 5, "Verac reads public repository data through GitHub's API. Nothing is cloned or run. Private work is fine: explain it in the technical section.")}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {list("contracts", "QoreChain contract addresses", "0x…", 10, "Checked on Diana testnet: does code exist at this address.")}
          {list("transactions", "Transaction hashes", "0x…", 10, "Checked on Diana testnet: receipt and status.")}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-[15px] font-semibold">8 and 9. Funding request and budget breakdown</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="f-amt" label="Requested amount (QOR)"><input id="f-amt" inputMode="decimal" className={inputCls} value={v.amountQor} onChange={(e) => set({ amountQor: e.target.value })} /></Field>
          <Field id="f-rcpt" label="14. Recipient wallet address" hint="Where funds would be paid. Changing it later is shown to reviewers."><input id="f-rcpt" className={`${inputCls} font-mono text-[12.5px]`} spellCheck={false} placeholder="0x…" value={v.recipient} onChange={(e) => set({ recipient: e.target.value })} /></Field>
        </div>
        <div className="space-y-2">
          {c.budget.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_9rem_auto] gap-2">
              <input aria-label={`Budget line ${i + 1}`} className={inputCls} placeholder="What the money is for" value={b.item} onChange={(e) => setC({ budget: c.budget.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)) })} />
              <input aria-label={`Budget line ${i + 1} amount (QOR)`} inputMode="decimal" className={inputCls} placeholder="QOR" value={b.amountQor} onChange={(e) => setC({ budget: c.budget.map((x, j) => (j === i ? { ...x, amountQor: e.target.value } : x)) })} />
              <button type="button" className={btnSecondaryCls} onClick={() => setC({ budget: c.budget.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          {c.budget.length < 30 && <button type="button" className={`${btnSecondaryCls} min-h-8 text-[12.5px]`} onClick={() => setC({ budget: [...c.budget, { item: "", amountQor: "" }] })}>Add budget line</button>}
          <p role="status" className="text-[12.5px] text-muted">{sumNote(totals.b, "budget")}</p>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-[15px] font-semibold">10 to 12. Timeline, milestones and success metrics</legend>
        {text("timeline", "Project timeline", "The overall schedule.", 2, 3000)}
        <div className="space-y-3">
          {c.milestones.map((m, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-line p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_9rem]">
                <input aria-label={`Milestone ${i + 1} title`} className={inputCls} placeholder={`Milestone ${i + 1} title`} value={m.title} onChange={(e) => setC({ milestones: c.milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                <input aria-label={`Milestone ${i + 1} due date`} type="date" className={inputCls} value={m.due} onChange={(e) => setC({ milestones: c.milestones.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)) })} />
                <input aria-label={`Milestone ${i + 1} amount (QOR)`} inputMode="decimal" className={inputCls} placeholder="QOR" value={m.amountQor} onChange={(e) => setC({ milestones: c.milestones.map((x, j) => (j === i ? { ...x, amountQor: e.target.value } : x)) })} />
              </div>
              <textarea aria-label={`Milestone ${i + 1} deliverable`} rows={2} className={inputCls} placeholder="The deliverable: what exactly will exist when this milestone is done" value={m.deliverable} onChange={(e) => setC({ milestones: c.milestones.map((x, j) => (j === i ? { ...x, deliverable: e.target.value } : x)) })} />
              <input aria-label={`Milestone ${i + 1} verification`} className={inputCls} placeholder="How a reviewer can verify it (link, release, report, transaction…)" value={m.verification} onChange={(e) => setC({ milestones: c.milestones.map((x, j) => (j === i ? { ...x, verification: e.target.value } : x)) })} />
              <button type="button" className={`${btnSecondaryCls} min-h-8 text-[12.5px]`} onClick={() => setC({ milestones: c.milestones.filter((_, j) => j !== i) })}>Remove milestone</button>
            </div>
          ))}
          {c.milestones.length < 10 && <button type="button" className={`${btnSecondaryCls} min-h-8 text-[12.5px]`} onClick={() => setC({ milestones: [...c.milestones, { title: "", deliverable: "", verification: "", due: "", amountQor: "" }] })}>Add milestone</button>}
          <p role="status" className="text-[12.5px] text-muted">{sumNote(totals.m, "milestone")}</p>
        </div>
        {text("metrics", "Success metrics", "How you and reviewers will know it worked.", 2, 3000)}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-[15px] font-semibold">13 and 15. Supporting documents and declarations</legend>
        <p className="text-[13px] text-muted">Applications are stored as plain text in Verac's database. Do not paste secrets or private keys. Confidential documents go through QoreSeal encryption on the milestone evidence flow.</p>
        {([["accurate", "Everything in this application is accurate to the best of my knowledge."], ["rights", "I have the right to use and publish the work described, including any reused open-source code."], ["conflicts_disclosed", "I have disclosed any relationship with this organisation's reviewers or administrators in the team section."]] as const).map(([k, t]) => (
          <label key={k} className="flex items-start gap-2 text-[13.5px]">
            <input type="checkbox" className="mt-1" checked={c.declarations[k]} onChange={(e) => setC({ declarations: { ...c.declarations, [k]: e.target.checked } })} /> {t}
          </label>
        ))}
      </fieldset>

      {amending && <Field id="f-reason" label="What did you change, and why?" hint="Required for an amendment. Reviewers see every version."><input id="f-reason" name="reason" required minLength={5} maxLength={300} className={inputCls} /></Field>}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button className={btnSecondaryCls} name="intent" value="draft">Save draft</button>
        <button className={btnCls} name="intent" value="submit">{amending ? "Resubmit amendment" : "Submit application"}</button>
        <span className="text-[12.5px] text-muted">{amending ? "Your earlier version stays on record." : "After submission the application is locked for review. Changes are possible only if a reviewer asks for clarification."}</span>
      </div>
    </form>
  );
}
