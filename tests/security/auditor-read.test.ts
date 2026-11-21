import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Exercises supabase/migrations/0023_auditor_read.sql: a read-only auditor (the judge account) can read submitted grant
 * applications and the agents' reports, but never drafts, and can change nothing: no award, no review, no payment request,
 * no direct write to any table.
 */
const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  adm: "00000000-0000-0000-0000-0000000000a5",
  aud: "00000000-0000-0000-0000-0000000000a9",
  a1: "00000000-0000-0000-0000-0000000000e1",
  a2: "00000000-0000-0000-0000-0000000000e2",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
const QOR = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
let db: PGlite;
let APP: string, DRAFT: string, ROUND: string;

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const q = (u: string, sql: string, p: unknown[] = []) => as(u, () => db.query(sql, p));
const one = async (u: string, sql: string, p: unknown[] = []) => ((await q(u, sql, p)).rows[0] as { v: unknown }).v;
const content = (name: string) => ({
  overview: `${name} builds an open-source indexer for grant programmes.`, problem: "Grant managers cannot see delivery evidence in one place.",
  solution: "Index milestone transactions and expose an API.", team: "Two engineers.", technical: "TypeScript service with CI.", metrics: "Three programmes using it.",
  links: {}, contracts: [], transactions: [], budget: [{ item: "Engineering", amount: QOR(4000) }],
  milestones: [{ title: "MVP", deliverable: "Indexer running against Diana.", verification: "Public endpoint.", due: future(30), amount: QOR(4000) }],
  declarations: { accurate: true, rights: true, conflicts_disclosed: true },
});

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated nologin; create role app_user nologin; grant authenticated to app_user;
    create role service_role nologin bypassrls; create role anon nologin;
    grant usage on schema auth to app_user, service_role;
    alter default privileges in schema public grant execute on functions to authenticated, service_role;
  `);
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql", "0006_milestones.sql", "0007_governance.sql", "0008_disputes.sql", "0009_grants.sql", "0014_live_execution.sql", "0015_live_decision_guard.sql", "0016_agent_workflows.sql", "0019_grants_portal.sql", "0020_grant_reviews.sql", "0021_grant_milestones.sql", "0023_auditor_read.sql"])
    await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0023_auditor_read.sql"), "utf8")); // re-runnable
  await db.exec(`grant usage on schema public to authenticated, service_role; grant all on all tables in schema public to authenticated, service_role; grant all on all sequences in schema public to authenticated, service_role;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Verac demo','${U.owner}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.adm}','administrator'), ('${ORG}','${U.aud}','auditor'),
      ('${ORG}','${U.a1}','grant_applicant'), ('${ORG}','${U.a2}','grant_applicant');
  `);
  ROUND = (await one(U.owner, `select create_grant_round('${ORG}','Round',${QOR(20000)},'d','r',array['software'],now() + interval '30 days',null,null) as v`)) as string;
  APP = (await one(U.a1, `select save_grant_application($1,'Alpha','software',$2,$3,$4::jsonb) as v`, [ROUND, QOR(4000), "0x" + "4".repeat(40), JSON.stringify(content("Alpha"))])) as string;
  await q(U.a1, `select submit_grant_application($1,null)`, [APP]);
  DRAFT = (await one(U.a2, `select save_grant_application($1,'Beta draft','software',$2,$3,$4::jsonb) as v`, [ROUND, QOR(4000), "0x" + "5".repeat(40), JSON.stringify(content("Beta"))])) as string;
});

describe("the read-only auditor (judge) account", () => {
  it("reads submitted applications and the round, but never a draft", async () => {
    const r = await q(U.aud, `select id, applicant_name from grant_applications order by applicant_name`);
    expect(r.rows.map((x) => (x as { applicant_name: string }).applicant_name)).toEqual(["Alpha"]);
    expect((await q(U.aud, `select id from grant_applications where id = $1`, [DRAFT])).rows).toEqual([]);
    expect((await q(U.aud, `select id from grants where id = $1`, [ROUND])).rows.length).toBe(1);
    expect((await q(U.aud, `select version from grant_application_versions where application_id = $1`, [APP])).rows.length).toBe(1);
  });
  it("reads the agents' reports and evidence once they exist", async () => {
    await db.exec(`insert into grant_evidence(organization_id, application_id, application_version, source, subject, claim, status, reason, observed, url, retrieved_at)
      values ('${ORG}', '${APP}', 1, 'github', 'https://github.com/a/b', 'The repository exists', 'VERIFIED', 'GitHub returned it.', '{}'::jsonb, 'https://api.github.com/repos/a/b', now())`);
    expect((await q(U.aud, `select claim from grant_evidence where application_id = $1`, [APP])).rows.length).toBe(1);
  });
  it("cannot decide, award, open a round or request a payment", async () => {
    await expect(q(U.aud, `select decide_application($1,'recommend','looks good')`, [APP])).rejects.toThrow();
    await expect(q(U.aud, `select award_application($1,'[]'::jsonb)`, [APP])).rejects.toThrow();
    await expect(q(U.aud, `select create_grant_round('${ORG}','X',${QOR(10)},'d','r',array['software'],now() + interval '3 days',null,null)`)).rejects.toThrow(/owner or administrator required/);
    await expect(q(U.aud, `select request_payment('${ORG}', null, '0x${"6".repeat(40)}', '1', 'test', 1, now() + interval '1 day')`)).rejects.toThrow();
  });
  it("cannot write to the tables directly", async () => {
    await expect(q(U.aud, `update grant_applications set status = 'awarded' where id = $1 returning id`, [APP]).then((r) => r.rows.length)).resolves.toBe(0);
    await expect(q(U.aud, `insert into grant_reviews(organization_id, application_id) values ('${ORG}', $1)`, [APP])).rejects.toThrow();
    await expect(q(U.aud, `delete from grant_evidence where application_id = $1 returning id`, [APP]).then((r) => r.rows.length)).resolves.toBe(0);
    expect((await db.query(`select status from grant_applications where id = $1`, [APP])).rows[0]).toEqual({ status: "submitted" });
  });
  it("a grant applicant still cannot read another applicant's application", async () => {
    expect((await q(U.a2, `select id from grant_applications where id = $1`, [APP])).rows).toEqual([]);
  });
});
