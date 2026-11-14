import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0012_activity.sql: who can read which audit events, and that the log stays append-only. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  aud: "00000000-0000-0000-0000-0000000000a6",
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
const visible = (u: string, org = ORG) => as(u, async () => (await db.query(`select action from audit_events where organization_id='${org}' order by id`)).rows.map((r) => (r as { action: string }).action));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role app_user nologin; create role authenticated nologin; grant authenticated to app_user;
    grant usage on schema auth to app_user;
  `);
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0012_activity.sql"]) await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(`grant usage on schema public to app_user; grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user; grant execute on all functions in schema public to app_user;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}'), ('${ORG2}','Other','${U.other}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.aud}','auditor'), ('${ORG}','${U.fin}','finance_manager'), ('${ORG}','${U.emp}','employee'), ('${ORG2}','${U.other}','owner');
    insert into audit_events(organization_id, actor, action) values
      ('${ORG}','${U.fin}','payment.approve'), ('${ORG}','${U.emp}','vault.uploaded'), ('${ORG}','system','payment.approval_expired'), ('${ORG2}','${U.other}','grant.created');
  `);
});

describe("who can read audit events", () => {
  it("owners and auditors read everything in their organisation", async () => {
    for (const u of [U.owner, U.aud]) expect(await visible(u)).toEqual(["payment.approve", "vault.uploaded", "payment.approval_expired"]);
  });
  it("other members read only the events they caused", async () => {
    expect(await visible(U.fin)).toEqual(["payment.approve"]);
    expect(await visible(U.emp)).toEqual(["vault.uploaded"]);
  });
  it("nobody reads another organisation's events", async () => {
    expect(await visible(U.owner, ORG2)).toEqual([]);
    expect(await visible(U.fin, ORG2)).toEqual([]);
    expect(await visible(U.other)).toEqual([]);
  });
  it("members cannot write, change or delete events", async () => {
    await expect(as(U.fin, () => db.exec(`insert into audit_events(organization_id, actor, action) values ('${ORG}','${U.fin}','x.y')`))).rejects.toThrow(/row-level security/);
    await expect(db.exec(`update audit_events set action='x.y'`)).rejects.toThrow(/append-only/);
    await expect(db.exec(`delete from audit_events`)).rejects.toThrow(/append-only/);
  });
});
