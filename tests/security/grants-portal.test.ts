import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0019_grants_portal.sql: rounds, versioned rubrics, drafts, validated submission, amendments. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  adm: "00000000-0000-0000-0000-0000000000a5",
  a1: "00000000-0000-0000-0000-0000000000e1",
  a2: "00000000-0000-0000-0000-0000000000e2",
  fin: "00000000-0000-0000-0000-0000000000a3",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
const QOR = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const ADDR = "0x" + "4".repeat(40);
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
let db: PGlite;

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const q = (u: string, sql: string, params: unknown[] = []) => as(u, () => db.query(sql, params));
const one = async (u: string, sql: string, params: unknown[] = []) => ((await q(u, sql, params)).rows[0] as { v: unknown }).v;
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];

function content(over: Record<string, unknown> = {}, amount = 4000) {
  return {
    overview: "An open-source indexer for QoreChain grant programmes, with a public API.",
    problem: "Grant managers cannot see on-chain delivery evidence in one place today.",
    solution: "We index milestone transactions and expose them through a small, documented API.",
    team: "Two engineers who maintain the Alpha SDK.",
    experience: "Shipped two open-source SDKs.",
    technical: "TypeScript service with Postgres; read-only RPC access; CI on every commit.",
    metrics: "Three programmes using the API within two months.",
    timeline: "Eight weeks.",
    links: { website: "https://alpha.example.org", repos: ["https://github.com/alpha-labs/indexer"] },
    contracts: [], transactions: [],
    budget: [{ item: "Engineering, 8 weeks", amount: QOR(amount - 500) }, { item: "Hosting for one year", amount: QOR(500) }],
    milestones: [
      { title: "Indexer MVP", deliverable: "Indexer running against Diana with documented endpoints.", verification: "Public endpoint and repository tag.", due: future(30), amount: QOR(amount / 2) },
      { title: "Public API", deliverable: "Versioned API with usage documentation and tests.", verification: "Docs site and CI results.", due: future(60), amount: QOR(amount / 2) },
    ],
    declarations: { accurate: true, rights: true, conflicts_disclosed: true },
    ...over,
  };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role app_user nologin; create role authenticated nologin; grant authenticated to app_user;
    grant usage on schema auth to app_user;
  `);
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql", "0006_milestones.sql", "0007_governance.sql", "0008_disputes.sql", "0009_grants.sql", "0019_grants_portal.sql"])
    await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0019_grants_portal.sql"), "utf8")); // re-runnable
  await db.exec(`grant usage on schema public to app_user; grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user; grant execute on all functions in schema public to app_user;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.adm}','administrator'), ('${ORG}','${U.fin}','finance_manager'),
      ('${ORG}','${U.a1}','grant_applicant'), ('${ORG}','${U.a2}','grant_applicant');
  `);
});

const round = (u = U.owner, over: { categories?: string; max?: string; rubric?: string } = {}) =>
  one(u, `select create_grant_round('${ORG}','Web3 Developer Grants',${QOR(20000)},'Funding for developer tooling.','Open source preferred.',${over.categories ?? "array['software','research','education']"},now() + interval '30 days',${over.max ?? QOR(8000)},${over.rubric ?? "null"}) as v`) as Promise<string>;
const save = (u: string, g: string, c: unknown, amount = QOR(4000), category = "software", recipient = ADDR) =>
  one(u, `select save_grant_application($1,'Project Alpha',$2,$3,$4,$5::jsonb) as v`, [g, category, amount, recipient, JSON.stringify(c)]) as Promise<string>;
const submit = (u: string, a: string, reason: string | null = null) => one(u, `select submit_grant_application($1,$2) as v`, [a, reason]);

describe("rounds and rubrics", () => {
  it("an administrator creates a round with the default rubric as version 1; others cannot", async () => {
    const g = await round();
    const r = (await rows(`select version, criteria, locked_at from grant_rubrics where grant_id = '${g}'`))[0]!;
    expect(r.version).toBe(1);
    expect((r.criteria as Array<{ key: string }>).map((c) => c.key)).toEqual(["relevance", "technical", "approach", "feasibility", "milestones", "budget", "impact", "capability"]);
    for (const u of [U.fin, U.a1]) await expect(round(u)).rejects.toThrow(/owner or administrator required/);
  });
  it("refuses an invalid rubric and bad round settings", async () => {
    await expect(round(U.owner, { rubric: `'[{"key":"Bad Key","label":"x","max":10}]'::jsonb` })).rejects.toThrow(/rubric is not valid/);
    await expect(round(U.owner, { categories: "array['crypto']" })).rejects.toThrow(/categories/);
    await expect(round(U.owner, { max: QOR(30000) })).rejects.toThrow(/maximum request/);
  });
  it("edits the rubric in place until it is locked, then only adds a new version with a reason", async () => {
    const g = await round();
    const c2 = JSON.stringify([{ key: "relevance", label: "Relevance", max: 50 }, { key: "feasibility", label: "Feasibility", max: 50 }]);
    expect(await one(U.adm, `select set_grant_rubric($1,$2::jsonb,null) as v`, [g, c2])).toBe(1);
    await db.exec(`update grant_rubrics set locked_at = now() where grant_id = '${g}'`); // what the first evaluation does (phase 4)
    await expect(q(U.adm, `select set_grant_rubric($1,$2::jsonb,null)`, [g, c2])).rejects.toThrow(/give a reason/);
    expect(await one(U.adm, `select set_grant_rubric($1,$2::jsonb,'Add security criterion') as v`, [g, c2])).toBe(2);
    expect((await rows(`select count(*)::int n from grant_rubrics where grant_id = '${g}'`))[0]!.n).toBe(2);
    await expect(q(U.a1, `select set_grant_rubric($1,$2::jsonb,'x')`, [g, c2])).rejects.toThrow(/owner or administrator required/);
  });
});

describe("drafts and submission", () => {
  it("a draft can be incomplete, is private to its applicant, and is refused at submission with the first problem", async () => {
    const g = await round();
    const a = await save(U.a1, g, { overview: "Just started" }, QOR(4000), "software", "");
    expect((await rows(`select status, version from grant_applications where id = '${a}'`))[0]).toMatchObject({ status: "draft", version: 0 });
    expect((await as(U.owner, () => db.query(`select id from grant_applications where id = '${a}'`))).rows.length).toBe(0);
    expect((await as(U.a1, () => db.query(`select id from grant_applications where id = '${a}'`))).rows.length).toBe(1);
    await expect(submit(U.a1, a)).rejects.toThrow(/cannot submit yet: the overview section/);
  });
  it("checks sums, links, category and declarations", async () => {
    const g = await round();
    const a = await save(U.a1, g, content());
    await save(U.a1, g, content({ budget: [{ item: "Engineering", amount: QOR(3000) }] }));
    await expect(submit(U.a1, a)).rejects.toThrow(/budget lines must add up exactly/);
    await save(U.a1, g, content({ links: { repos: ["https://gitlab.com/x/y"] } }));
    await expect(submit(U.a1, a)).rejects.toThrow(/github\.com\/owner\/name/);
    await save(U.a1, g, content({ declarations: { accurate: true, rights: true } }));
    await expect(submit(U.a1, a)).rejects.toThrow(/three declarations/);
    await save(U.a1, g, content(), QOR(4000), "community");
    await expect(submit(U.a1, a)).rejects.toThrow(/category this round accepts/);
    await save(U.a1, g, content({ milestones: [{ title: "All", deliverable: "Everything at once, finished.", verification: "Trust us.", due: future(10), amount: QOR(3999) }] }));
    await expect(submit(U.a1, a)).rejects.toThrow(/milestones must add up exactly/);
  });
  it("does not require a public repository; research projects need no technical section", async () => {
    const g = await round();
    const a = await save(U.a2, g, content({ links: {}, technical: "" }), QOR(4000), "research");
    expect(await submit(U.a2, a)).toBe(1);
  });
  it("submits a complete application as version 1, makes it visible to administrators, then locks it", async () => {
    const g = await round();
    const a = await save(U.a1, g, content());
    expect(await submit(U.a1, a)).toBe(1);
    const r = (await rows(`select status, version, pitch, submitted_at from grant_applications where id = '${a}'`))[0]!;
    expect(r).toMatchObject({ status: "submitted", version: 1 });
    expect(String(r.pitch)).toContain("open-source indexer");
    expect((await rows(`select count(*)::int n from grant_application_versions where application_id = '${a}'`))[0]!.n).toBe(1);
    expect((await as(U.owner, () => db.query(`select id from grant_applications where id = '${a}'`))).rows.length).toBe(1);
    await expect(save(U.a1, g, content({ overview: "Changed after submission, which must not be allowed." }))).rejects.toThrow(/can no longer be edited/);
    await expect(submit(U.a2, a)).rejects.toThrow(/only the applicant/);
  });
  it("refuses a request above the round's maximum", async () => {
    const g = await round(U.owner, { max: QOR(3000) });
    const a = await save(U.a1, g, content());
    await expect(submit(U.a1, a)).rejects.toThrow(/above this round's maximum/);
  });
  it("an opened amendment allows one change, recorded as a new version with a reason", async () => {
    const g = await round();
    const a = await save(U.a1, g, content());
    await submit(U.a1, a);
    await db.exec(`update grant_applications set status = 'clarification_requested', amendment_open = true where id = '${a}'`); // phase 4 opens this
    await save(U.a1, g, content({ budget: [{ item: "Engineering, 8 weeks: 2 engineers x 4 weeks at 437.5 QOR per week", amount: QOR(3500) }, { item: "Hosting for one year", amount: QOR(500) }] }));
    await expect(submit(U.a1, a)).rejects.toThrow(/describe what you changed/);
    expect(await submit(U.a1, a, "Explained the engineering budget line")).toBe(2);
    const r = (await rows(`select status, version, amendment_open from grant_applications where id = '${a}'`))[0]!;
    expect(r).toMatchObject({ status: "under_review", version: 2, amendment_open: false });
    const v = await rows(`select version, reason from grant_application_versions where application_id = '${a}' order by version`);
    expect(v.map((x) => x.reason)).toEqual(["submitted", "Explained the engineering budget line"]);
  });
  it("the one-step apply from 0009 still works", async () => {
    const g = await round();
    const id = await one(U.a2, `select apply_to_grant($1,'Legacy',${QOR(10)},'We will build an open-source tool for the community and report progress monthly.') as v`, [g]);
    expect((await rows(`select status from grant_applications where id = '${id}'`))[0]!.status).toBe("submitted");
  });
});
