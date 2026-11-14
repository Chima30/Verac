import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0009_grants.sql: roles, budget limits, separation between recommender and awarder. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  adm: "00000000-0000-0000-0000-0000000000a5",
  fin: "00000000-0000-0000-0000-0000000000a3",
  a1: "00000000-0000-0000-0000-0000000000e1",
  a2: "00000000-0000-0000-0000-0000000000e2",
  a3: "00000000-0000-0000-0000-0000000000e3",
  vendor: "00000000-0000-0000-0000-0000000000b1",
  other: "00000000-0000-0000-0000-0000000000c1",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
const ORG2 = "10000000-0000-0000-0000-00000000000b";
const TOKEN = "0x" + "0".repeat(40);
const PITCH = "We will build an open-source tool for the community and report progress monthly.";
let db: PGlite;

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];
const q = (u: string, sql: string) => as(u, () => db.query(sql));
const one = async (u: string, sql: string) => as(u, async () => ((await db.query(sql)).rows[0] as { v: string }).v);
const grant = (u: string, budget = "100", org = ORG) => one(u, `select create_grant('${org}','Tooling round',${budget},'${TOKEN}') as v`);
const apply = (u: string, g: string, amount = "40", pitch = PITCH) => one(u, `select apply_to_grant('${g}','Applicant',${amount},'${pitch}') as v`);
const recommend = (u: string, a: string) => q(u, `select decide_application('${a}','recommend','Looks solid')`);
const award = (u: string, a: string, ms: Array<[string, number]>) => q(u, `select award_application('${a}','${JSON.stringify(ms.map(([title, amount]) => ({ title, amount: String(amount) })))}'::jsonb)`);
const status = async (a: string) => (await rows(`select status from grant_applications where id='${a}'`))[0]!.status;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role app_user nologin; create role authenticated nologin; grant authenticated to app_user;
    grant usage on schema auth to app_user;
  `);
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql", "0006_milestones.sql", "0007_governance.sql", "0008_disputes.sql", "0009_grants.sql"]) await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(`grant usage on schema public to app_user; grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user; grant execute on all functions in schema public to app_user;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}'), ('${ORG2}','Other','${U.other}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.adm}','administrator'), ('${ORG}','${U.fin}','finance_manager'),
      ('${ORG}','${U.a1}','grant_applicant'), ('${ORG}','${U.a2}','grant_applicant'), ('${ORG}','${U.a3}','grant_applicant'),
      ('${ORG}','${U.vendor}','vendor'), ('${ORG2}','${U.other}','owner');
  `);
});

describe("rounds", () => {
  it("only owners and administrators create and close them, with valid values", async () => {
    for (const u of [U.fin, U.a1, U.vendor, U.other]) await expect(grant(u)).rejects.toThrow(/owner or administrator required/);
    await expect(grant(U.owner, "0")).rejects.toThrow(/positive whole number/);
    await expect(q(U.owner, `select create_grant('${ORG}','x',10,'${TOKEN}')`)).rejects.toThrow(/3 to 160/);
    await expect(q(U.owner, `select create_grant('${ORG}','Valid title',10,'nope')`)).rejects.toThrow(/token must be/);
    const g = await grant(U.owner);
    await expect(q(U.fin, `select close_grant('${g}')`)).rejects.toThrow(/owner or administrator required/);
    await q(U.adm, `select close_grant('${g}')`);
    await expect(q(U.adm, `select close_grant('${g}')`)).rejects.toThrow(/already closed/);
  });
  it("direct writes are denied", async () => {
    await expect(as(U.owner, () => db.exec(`insert into grants(organization_id,title,budget,token,created_by) values ('${ORG}','x',1,'0x0','${U.owner}')`))).rejects.toThrow(/row-level security/);
    const g = await grant(U.owner);
    await expect(as(U.a1, () => db.exec(`insert into grant_applications(organization_id,grant_id,applicant_user_id,applicant_name,requested_amount) values ('${ORG}','${g}','${U.a1}','x',1)`))).rejects.toThrow(/row-level security/);
    expect((await as(U.owner, () => db.query(`update grants set status='closed' where id='${g}' returning id`))).rows.length).toBe(0);
  });
  it("applicants see open rounds only; vendors and other organisations see none", async () => {
    const g = await grant(U.owner);
    await as(U.a1, async () => expect((await db.query(`select 1 from grants where id='${g}'`)).rows.length).toBe(1));
    for (const u of [U.vendor, U.other]) await as(u, async () => expect((await db.query(`select 1 from grants`)).rows.length).toBe(0));
    await q(U.owner, `select close_grant('${g}')`);
    await as(U.a1, async () => expect((await db.query(`select 1 from grants where id='${g}'`)).rows.length).toBe(0));
  });
});

describe("applying", () => {
  it("only grant applicants can apply, to open rounds, within the budget, once", async () => {
    const g = await grant(U.owner, "100");
    for (const u of [U.vendor, U.fin, U.owner, U.other]) await expect(apply(u, g)).rejects.toThrow(/grant applicant role required/);
    await expect(apply(U.a1, g, "101")).rejects.toThrow(/whole round budget/);
    await expect(apply(U.a1, g, "0")).rejects.toThrow(/positive whole number/);
    await expect(apply(U.a1, g, "40", "too short")).rejects.toThrow(/20 to 6000/);
    await apply(U.a1, g);
    await expect(apply(U.a1, g)).rejects.toThrow(/already applied/);
    const closed = await grant(U.owner);
    await q(U.owner, `select close_grant('${closed}')`);
    await expect(apply(U.a2, closed)).rejects.toThrow(/not open/);
  });
  it("applicants see only their own application; reviewers see all", async () => {
    const g = await grant(U.owner, "100");
    await apply(U.a1, g); await apply(U.a2, g);
    await as(U.a1, async () => expect((await db.query(`select 1 from grant_applications where grant_id='${g}'`)).rows.length).toBe(1));
    await as(U.owner, async () => expect((await db.query(`select 1 from grant_applications where grant_id='${g}'`)).rows.length).toBe(2));
    for (const u of [U.vendor, U.other]) await as(u, async () => expect((await db.query(`select 1 from grant_applications where grant_id='${g}'`)).rows.length).toBe(0));
  });
});

describe("review and award", () => {
  it("only owners and administrators save the AI review or decide", async () => {
    const g = await grant(U.owner); const a = await apply(U.a1, g);
    for (const u of [U.fin, U.a1, U.other]) {
      await expect(q(u, `select save_application_review('${a}','{"fit":5}'::jsonb)`)).rejects.toThrow(/owner or administrator required/);
      await expect(recommend(u, a)).rejects.toThrow(/owner or administrator required/);
    }
    await q(U.owner, `select save_application_review('${a}','{"fit":5}'::jsonb)`);
    expect(await status(a)).toBe("under_review");
    await expect(q(U.owner, `select decide_application('${a}','maybe','long enough')`)).rejects.toThrow(/recommend or reject/);
    await expect(q(U.owner, `select decide_application('${a}','reject','no')`)).rejects.toThrow(/short reason/);
  });
  it("only a recommended application can be awarded, and not by whoever recommended it", async () => {
    const g = await grant(U.owner, "100"); const a = await apply(U.a1, g, "40");
    await expect(award(U.adm, a, [["All", 40]])).rejects.toThrow(/only a recommended/);
    await recommend(U.owner, a);
    expect(await status(a)).toBe("recommended");
    await expect(award(U.owner, a, [["All", 40]])).rejects.toThrow(/different administrator must award/);
    for (const u of [U.fin, U.a1, U.other]) await expect(award(u, a, [["All", 40]])).rejects.toThrow(/owner or administrator required/);
    expect(await status(a)).toBe("recommended");
  });
  it("milestones must add up exactly to the request", async () => {
    const g = await grant(U.owner, "100"); const a = await apply(U.a1, g, "40");
    await recommend(U.owner, a);
    await expect(award(U.adm, a, [["One", 20], ["Two", 10]])).rejects.toThrow(/add up exactly/);
    await expect(award(U.adm, a, [["One", 30], ["Two", 20]])).rejects.toThrow(/add up exactly/);
    await expect(award(U.adm, a, [])).rejects.toThrow(/1 to 10/);
    await expect(award(U.adm, a, [["", 40]])).rejects.toThrow(/title/);
    expect(await status(a)).toBe("recommended");
    expect((await rows(`select count(*)::int as c from milestones where parent_id='${a}'`))[0]!.c).toBe(0);
    await award(U.adm, a, [["One", 25], ["Two", 15]]);
    expect(await status(a)).toBe("awarded");
    expect((await rows(`select parent_type from milestones where parent_id='${a}' order by idx`)).map((m) => m.parent_type)).toEqual(["grant", "grant"]);
  });
  it("the total awarded can never pass the round budget", async () => {
    const g = await grant(U.owner, "100");
    const a = await apply(U.a1, g, "70"); const b = await apply(U.a2, g, "50");
    await recommend(U.owner, a); await recommend(U.owner, b);
    await award(U.adm, a, [["All", 70]]);
    await expect(award(U.adm, b, [["All", 50]])).rejects.toThrow(/pass the round budget/);
    expect(await status(b)).toBe("recommended");
  });
  it("a rejected application stays rejected, and an applicant sees only their own milestones", async () => {
    const g = await grant(U.owner, "100"); const a = await apply(U.a1, g, "30"); const r = await apply(U.a2, g, "30");
    await q(U.owner, `select decide_application('${r}','reject','Out of scope')`);
    await expect(recommend(U.owner, r)).rejects.toThrow(/not awaiting a decision/);
    await recommend(U.owner, a); await award(U.adm, a, [["All", 30]]);
    await as(U.a1, async () => expect((await db.query(`select 1 from milestones where parent_id='${a}'`)).rows.length).toBe(1));
    await as(U.a2, async () => expect((await db.query(`select 1 from milestones where parent_id='${a}'`)).rows.length).toBe(0));
  });
  it("is recorded in the audit log", async () => {
    const g = await grant(U.owner, "100"); const a = await apply(U.a3, g, "10");
    await recommend(U.owner, a); await award(U.adm, a, [["All", 10]]);
    expect((await rows(`select action from audit_events where subject='${a}' order by id`)).map((x) => x.action)).toEqual(["grant.applied", "grant.recommend", "grant.awarded"]);
  });
});
