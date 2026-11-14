import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0010_revenue.sql: who can record, mark paid and void, and one payment per transaction. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  fin: "00000000-0000-0000-0000-0000000000a3",
  emp: "00000000-0000-0000-0000-0000000000f1",
  vendor: "00000000-0000-0000-0000-0000000000b1",
  other: "00000000-0000-0000-0000-0000000000c1",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
const ORG2 = "10000000-0000-0000-0000-00000000000b";
const TX = (n: number) => "0x" + n.toString(16).padStart(64, "0");
let db: PGlite;
let n = 0;

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];
const q = (u: string, sql: string) => as(u, () => db.query(sql));
const rec = (u: string, amount = "1000", ref = `INV-${++n}`, org = ORG) => as(u, async () => ((await db.query(`select create_revenue_record('${org}','Acme Ltd','${ref}',${amount},'2026-12-31','Hosting') as v`)).rows[0] as { v: string }).v);
const paid = (u: string, id: string, tx: string) => q(u, `select mark_revenue_paid('${id}','${tx}')`);
const status = async (id: string) => (await rows(`select status from revenue_records where id='${id}'`))[0]!.status;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role app_user nologin; create role authenticated nologin; grant authenticated to app_user;
    grant usage on schema auth to app_user;
  `);
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql", "0006_milestones.sql", "0007_governance.sql", "0008_disputes.sql", "0009_grants.sql", "0010_revenue.sql"]) await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(`grant usage on schema public to app_user; grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user; grant execute on all functions in schema public to app_user;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}'), ('${ORG2}','Other','${U.other}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.fin}','finance_manager'), ('${ORG}','${U.emp}','employee'), ('${ORG}','${U.vendor}','vendor'), ('${ORG2}','${U.other}','owner');
  `);
});

describe("recording", () => {
  it("only finance roles record, with valid values and a unique reference", async () => {
    for (const u of [U.emp, U.vendor, U.other]) await expect(rec(u)).rejects.toThrow(/finance role required/);
    await expect(rec(U.fin, "0")).rejects.toThrow(/positive whole number/);
    await expect(rec(U.fin, "1.5")).rejects.toThrow(/positive whole number/);
    await expect(q(U.fin, `select create_revenue_record('${ORG}','','R1',5,'2026-12-31','')`)).rejects.toThrow(/customer/);
    await expect(q(U.fin, `select create_revenue_record('${ORG}','Acme','R1',5,null,'')`)).rejects.toThrow(/due date/);
    const id = await rec(U.fin, "1000", "DUP-1");
    await expect(rec(U.owner, "1000", "DUP-1")).rejects.toThrow(/already exists/);
    expect(await status(id)).toBe("issued");
    expect((await rows(`select token from revenue_records where id='${id}'`))[0]!.token).toBe("0x" + "0".repeat(40));
  });
  it("direct writes are denied, and vendors and other organisations cannot read", async () => {
    await expect(as(U.fin, () => db.exec(`insert into revenue_records(organization_id,customer,reference,amount,token) values ('${ORG}','x','y',1,'0x0')`))).rejects.toThrow(/row-level security/);
    const id = await rec(U.fin);
    expect((await as(U.fin, () => db.query(`update revenue_records set status='paid' where id='${id}' returning id`))).rows.length).toBe(0);
    await as(U.emp, async () => expect((await db.query(`select 1 from revenue_records where id='${id}'`)).rows.length).toBe(1));
    for (const u of [U.vendor, U.other]) await as(u, async () => expect((await db.query(`select 1 from revenue_records`)).rows.length).toBe(0));
  });
});

describe("payment and void", () => {
  it("only finance roles mark paid, with a well-formed hash, once", async () => {
    const id = await rec(U.fin);
    for (const u of [U.emp, U.vendor, U.other]) await expect(paid(u, id, TX(1))).rejects.toThrow(/finance role required/);
    await expect(paid(U.fin, id, "0x123")).rejects.toThrow(/64 hex/);
    await paid(U.fin, id, TX(100 + n).toUpperCase().replace("0X", "0x"));
    expect(await status(id)).toBe("paid");
    expect((await rows(`select marked_by from revenue_records where id='${id}'`))[0]!.marked_by).toBe(U.fin);
    await expect(paid(U.fin, id, TX(999))).rejects.toThrow(/is paid/);
  });
  it("one transaction cannot pay two records", async () => {
    const a = await rec(U.fin), b = await rec(U.fin);
    await paid(U.fin, a, TX(5000));
    await expect(paid(U.owner, b, TX(5000))).rejects.toThrow(/already recorded against another record/);
    expect(await status(b)).toBe("issued");
  });
  it("voiding needs a reason and only works on unpaid records", async () => {
    const a = await rec(U.fin), b = await rec(U.fin);
    await expect(q(U.emp, `select void_revenue_record('${a}','duplicate entry')`)).rejects.toThrow(/finance role required/);
    await expect(q(U.fin, `select void_revenue_record('${a}','no')`)).rejects.toThrow(/short reason/);
    await q(U.fin, `select void_revenue_record('${a}','duplicate entry')`);
    expect(await status(a)).toBe("void");
    await expect(paid(U.fin, a, TX(6000))).rejects.toThrow(/is void/);
    await paid(U.fin, b, TX(6001));
    await expect(q(U.fin, `select void_revenue_record('${b}','too late now')`)).rejects.toThrow(/is paid/);
  });
  it("is recorded in the audit log", async () => {
    const id = await rec(U.fin);
    await paid(U.fin, id, TX(7000));
    expect((await rows(`select action from audit_events where subject='${id}' order by id`)).map((x) => x.action)).toEqual(["revenue.recorded", "revenue.marked_paid"]);
  });
});
