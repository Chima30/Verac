import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0013_strategies.sql: strategies are saved simulations, never live. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  fin: "00000000-0000-0000-0000-0000000000a3",
  emp: "00000000-0000-0000-0000-0000000000f1",
  other: "00000000-0000-0000-0000-0000000000c1",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
const ORG2 = "10000000-0000-0000-0000-00000000000b";
let db: PGlite;

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];
const save = (u: string, kind = "dca", config = `{"name":"Monthly","input":{"totalBudget":100}}`) =>
  as(u, async () => ((await db.query(`select save_strategy('${ORG}','${kind}','${config}'::jsonb) as v`)).rows[0] as { v: string }).v);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role app_user nologin; create role authenticated nologin; grant authenticated to app_user;
    grant usage on schema auth to app_user;
  `);
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0013_strategies.sql"]) await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(`grant usage on schema public to app_user; grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user; grant execute on all functions in schema public to app_user;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}'), ('${ORG2}','Other','${U.other}');
    insert into memberships(organization_id,user_id,role) values ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.fin}','finance_manager'), ('${ORG}','${U.emp}','employee'), ('${ORG2}','${U.other}','owner');
  `);
});

describe("strategies", () => {
  it("only finance roles save, and what is saved is always a paused SIMULATION", async () => {
    for (const u of [U.emp, U.other]) await expect(save(u)).rejects.toThrow(/finance role required/);
    await expect(save(U.fin, "trade_now")).rejects.toThrow(/kind must be/);
    await expect(save(U.fin, "dca", `{"input":{}}`)).rejects.toThrow(/name/);
    const id = await save(U.fin);
    expect((await rows(`select mode, status, kind from strategies where id='${id}'`))[0]).toMatchObject({ mode: "SIMULATION", status: "paused", kind: "dca" });
  });
  it("direct writes cannot make a strategy live or active", async () => {
    await expect(as(U.fin, () => db.exec(`insert into strategies(organization_id,kind,config,mode,status,created_by) values ('${ORG}','dca','{}','LIVE_TESTNET','active','${U.fin}')`))).rejects.toThrow(/row-level security/);
    const id = await save(U.fin);
    expect((await as(U.fin, () => db.query(`update strategies set mode='LIVE_TESTNET', status='active' where id='${id}' returning id`))).rows.length).toBe(0);
    expect((await rows(`select mode, status from strategies where id='${id}'`))[0]).toMatchObject({ mode: "SIMULATION", status: "paused" });
  });
  it("members can read, outsiders cannot, and cancelling is finance only and once", async () => {
    const id = await save(U.owner);
    await as(U.emp, async () => expect((await db.query(`select 1 from strategies where id='${id}'`)).rows.length).toBe(1));
    await as(U.other, async () => expect((await db.query(`select 1 from strategies`)).rows.length).toBe(0));
    await expect(as(U.emp, () => db.query(`select cancel_strategy('${id}')`))).rejects.toThrow(/finance role required/);
    await as(U.fin, () => db.query(`select cancel_strategy('${id}')`));
    await expect(as(U.fin, () => db.query(`select cancel_strategy('${id}')`))).rejects.toThrow(/already cancelled/);
    expect((await rows(`select action from audit_events where subject='${id}' order by id`)).map((x) => x.action)).toEqual(["strategy.saved", "strategy.cancelled"]);
  });
});
