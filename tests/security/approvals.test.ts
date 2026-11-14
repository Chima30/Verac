import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0003_approvals.sql: request/decide functions, separation of duties, quorum, expiry, audit. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  fin1: "00000000-0000-0000-0000-0000000000a2",
  fin2: "00000000-0000-0000-0000-0000000000a3",
  proc: "00000000-0000-0000-0000-0000000000a4",
  auditor: "00000000-0000-0000-0000-0000000000a5",
  other: "00000000-0000-0000-0000-0000000000b1",
  stranger: "00000000-0000-0000-0000-0000000000f1",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
const ORG2 = "10000000-0000-0000-0000-00000000000b";
let db: PGlite;
let n = 0;

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];

async function request(user: string, required = 1, expiresIn = "1 hour", org = ORG): Promise<string> {
  n++;
  return as(user, async () => {
    const r = await db.query(
      `select request_payment_approval('${org}','k${n}','PaymentAgent','0x${n.toString(16).padStart(64, "0")}','0x0000000000000000000000000000000000000000','0x${"2".repeat(40)}',5000000000000000000,1, now() + interval '${expiresIn}', ${required}, '{"purpose":"test"}'::jsonb) as id`,
    );
    return (r.rows[0] as { id: string }).id;
  });
}
const decide = (user: string, tx: string, d: string) => as(user, async () => ((await db.query(`select decide_payment('${tx}','${d}','ok') as s`)).rows[0] as { s: string }).s);
const state = async (tx: string) => (await rows(`select state from transactions where id = '${tx}'`))[0]!.state;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role app_user nologin; create role authenticated nologin; grant authenticated to app_user;
    grant usage on schema auth to app_user;
  `);
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql"]) await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(`grant usage on schema public to app_user; grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user; grant execute on all functions in schema public to app_user;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}'), ('${ORG2}','Other','${U.other}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.fin1}','finance_manager'), ('${ORG}','${U.fin2}','finance_manager'),
      ('${ORG}','${U.proc}','procurement_manager'), ('${ORG}','${U.auditor}','auditor'), ('${ORG2}','${U.other}','owner');
  `);
});

describe("requesting approval", () => {
  it("only finance roles in the organisation can request", async () => {
    await expect(request(U.proc)).rejects.toThrow(/finance role required/);
    await expect(request(U.auditor)).rejects.toThrow(/finance role required/);
    await expect(request(U.stranger)).rejects.toThrow(/finance role required/);
    await expect(request(U.other)).rejects.toThrow(/finance role required/); // owner of a different org
    const tx = await request(U.fin1);
    expect(await state(tx)).toBe("AWAITING_APPROVAL");
  });

  it("is always a SIMULATION, and creates a human-wait task and an audit event", async () => {
    const tx = await request(U.fin1);
    expect((await rows(`select source, requested_by from transactions where id='${tx}'`))[0]).toMatchObject({ source: "SIMULATION", requested_by: U.fin1 });
    expect((await rows(`select state from agent_tasks where result->>'transaction_id' = '${tx}'`))[0]!.state).toBe("AWAITING_HUMAN");
    expect((await rows(`select action from audit_events where subject = '${tx}'`)).map((r) => r.action)).toContain("payment.approval_requested");
  });

  it("rejects bad bounds", async () => {
    await expect(request(U.fin1, 0)).rejects.toThrow(/1 to 10/);
    await expect(request(U.fin1, 11)).rejects.toThrow(/1 to 10/);
    await expect(request(U.fin1, 1, "8 days")).rejects.toThrow(/within the next 7 days/);
  });
});

describe("deciding", () => {
  it("the requester cannot decide their own request (separation of duties)", async () => {
    const tx = await request(U.fin1);
    await expect(decide(U.fin1, tx, "approve")).rejects.toThrow(/separation of duties/);
    expect(await state(tx)).toBe("AWAITING_APPROVAL");
  });

  it("another finance member approves; the task completes and everything is audited", async () => {
    const tx = await request(U.fin1);
    expect(await decide(U.fin2, tx, "approve")).toBe("APPROVED");
    expect(await state(tx)).toBe("APPROVED");
    expect((await rows(`select state from agent_tasks where result->>'transaction_id' = '${tx}'`))[0]!.state).toBe("COMPLETED");
    expect((await rows(`select action from audit_events where subject = '${tx}' order by id`)).map((r) => r.action)).toEqual(["payment.approval_requested", "payment.approve"]);
  });

  it("needs the full quorum, and nobody counts twice", async () => {
    const tx = await request(U.fin1, 2);
    expect(await decide(U.fin2, tx, "approve")).toBe("AWAITING_APPROVAL");
    await expect(decide(U.fin2, tx, "approve")).rejects.toThrow(/already decided/);
    expect(await state(tx)).toBe("AWAITING_APPROVAL");
    expect(await decide(U.owner, tx, "approve")).toBe("APPROVED");
  });

  it("any rejection ends the request, and a finished request cannot be decided again", async () => {
    const tx = await request(U.fin1, 2);
    expect(await decide(U.fin2, tx, "reject")).toBe("REJECTED");
    expect((await rows(`select state from agent_tasks where result->>'transaction_id' = '${tx}'`))[0]).toMatchObject({ state: "FAILED" });
    await expect(decide(U.owner, tx, "approve")).rejects.toThrow(/already REJECTED/);
  });

  it("an expired request is cancelled instead of approved", async () => {
    const tx = await request(U.fin1, 1, "1 second");
    await new Promise((r) => setTimeout(r, 1500));
    expect(await decide(U.fin2, tx, "approve")).toBe("CANCELLED");
    expect(await state(tx)).toBe("CANCELLED");
    expect((await rows(`select count(*)::int as c from approvals where subject_id = '${tx}'`))[0]!.c).toBe(0);
  });

  it("non-finance users and other organisations cannot decide", async () => {
    const tx = await request(U.fin1);
    for (const u of [U.proc, U.auditor, U.stranger, U.other]) await expect(decide(u, tx, "approve")).rejects.toThrow(/finance role required/);
    expect(await state(tx)).toBe("AWAITING_APPROVAL");
  });

  it("rejects anything other than approve or reject", async () => {
    const tx = await request(U.fin1);
    await expect(decide(U.fin2, tx, "maybe")).rejects.toThrow(/approve or reject/);
  });
});
