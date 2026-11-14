import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0005_payroll.sql together with the approval flow from 0003. */

const U = {
  fin1: "00000000-0000-0000-0000-0000000000a2",
  fin2: "00000000-0000-0000-0000-0000000000a3",
  proc: "00000000-0000-0000-0000-0000000000a4",
  other: "00000000-0000-0000-0000-0000000000b1",
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
const items = JSON.stringify([{ name: "Ada", address: "0x" + "1".repeat(40), amountQor: 100 }, { name: "Bob", address: "0x" + "2".repeat(40), amountQor: 50 }]);

function submit(user: string, period: string, required = 1, org = ORG): Promise<string> {
  n++;
  return as(user, async () => ((await db.query(`select submit_payroll_batch('${org}','${period}','${items}'::jsonb, 150000000000000000000, '0x${n.toString(16).padStart(64, "0")}', ${required}, now() + interval '1 day') as tx`)).rows[0] as { tx: string }).tx);
}
const decide = (user: string, tx: string, d: string) => as(user, async () => ((await db.query(`select decide_payment('${tx}','${d}') as s`)).rows[0] as { s: string }).s);
const batch = async (period: string) => (await rows(`select status from payroll_batches where organization_id='${ORG}' and period='${period}'`))[0]?.status;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role app_user nologin; create role authenticated nologin; grant authenticated to app_user;
    grant usage on schema auth to app_user;
  `);
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql"]) await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(`grant usage on schema public to app_user; grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user; grant execute on all functions in schema public to app_user;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.fin1}'), ('${ORG2}','Other','${U.other}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.fin1}','finance_manager'), ('${ORG}','${U.fin2}','finance_manager'), ('${ORG}','${U.proc}','procurement_manager'), ('${ORG2}','${U.other}','owner');
  `);
});

describe("payroll batches", () => {
  it("only finance roles in the organisation can submit; the batch waits for approval", async () => {
    await expect(submit(U.proc, "2026-01")).rejects.toThrow(/finance role required/);
    await expect(submit(U.other, "2026-01")).rejects.toThrow(/finance role required/);
    const tx = await submit(U.fin1, "2026-01");
    expect(await batch("2026-01")).toBe("awaiting_approval");
    expect((await rows(`select state, recipient, source, agent_id from transactions where id='${tx}'`))[0]).toMatchObject({ state: "AWAITING_APPROVAL", recipient: "payroll:2026-01", source: "SIMULATION", agent_id: "PayrollAgent" });
    expect((await rows(`select action from audit_events where action='payroll.submitted'`)).length).toBeGreaterThan(0);
  });

  it("validates the period and size, and allows only one live batch per period", async () => {
    await expect(submit(U.fin1, "2026-13")).rejects.toThrow(/period must look like/);
    await expect(as(U.fin1, () => db.query(`select submit_payroll_batch('${ORG}','2026-02','[]'::jsonb, 1, '0x${"9".repeat(64)}', 1, now() + interval '1 day')`))).rejects.toThrow(/1 to 200 lines/);
    await submit(U.fin1, "2026-03");
    await expect(submit(U.fin1, "2026-03")).rejects.toThrow(/already exists \(awaiting_approval\)/);
  });

  it("approval by a different finance member approves the batch; the submitter cannot", async () => {
    const tx = await submit(U.fin1, "2026-04");
    await expect(decide(U.fin1, tx, "approve")).rejects.toThrow(/separation of duties/);
    expect(await batch("2026-04")).toBe("awaiting_approval");
    expect(await decide(U.fin2, tx, "approve")).toBe("APPROVED");
    expect(await batch("2026-04")).toBe("approved");
    await expect(submit(U.fin1, "2026-04")).rejects.toThrow(/already exists \(approved\)/);
  });

  it("a rejected batch fails, and the period can be submitted again with a corrected batch", async () => {
    const tx = await submit(U.fin1, "2026-05");
    expect(await decide(U.fin2, tx, "reject")).toBe("REJECTED");
    expect(await batch("2026-05")).toBe("failed");
    const again = await submit(U.fin1, "2026-05");
    expect(again).not.toBe(tx);
    expect(await batch("2026-05")).toBe("awaiting_approval");
    expect((await rows(`select count(*)::int as c from payroll_batches where period='2026-05'`))[0]!.c).toBe(1);
  });

  it("an identical batch hash cannot be submitted twice", async () => {
    const hash = "0x" + "e".repeat(64);
    const q = (period: string) => as(U.fin1, () => db.query(`select submit_payroll_batch('${ORG}','${period}','${items}'::jsonb, 150000000000000000000, '${hash}', 1, now() + interval '1 day')`));
    await q("2026-06");
    await expect(q("2026-07")).rejects.toThrow(/identical batch/);
  });

  it("an expired request marks the batch failed", async () => {
    n++;
    const tx = await as(U.fin1, async () => ((await db.query(`select submit_payroll_batch('${ORG}','2026-08','${items}'::jsonb, 1, '0x${n.toString(16).padStart(64, "0")}', 1, now() + interval '1 second') as tx`)).rows[0] as { tx: string }).tx);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await decide(U.fin2, tx, "approve")).toBe("CANCELLED");
    expect(await batch("2026-08")).toBe("failed");
  });

  it("direct writes to batches are denied; only internal roles can read them", async () => {
    await expect(as(U.fin1, () => db.exec(`insert into payroll_batches(organization_id,period,items,total,token,created_by) values ('${ORG}','2030-01','[]',1,'0x0','${U.fin1}')`))).rejects.toThrow(/row-level security/);
    expect((await as(U.fin1, () => db.query(`update payroll_batches set status='paid' where period='2026-04' returning id`))).rows.length).toBe(0);
    expect((await as(U.other, async () => (await db.query(`select 1 from payroll_batches`)).rows)).length).toBe(0);
    expect((await as(U.fin2, async () => (await db.query(`select 1 from payroll_batches`)).rows)).length).toBeGreaterThan(0);
  });
});
