import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0016_agent_workflows.sql: invoices, vendors, workflow lifecycle, worker lease, payment link. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000b1",
  fin: "00000000-0000-0000-0000-0000000000b2",
  admin: "00000000-0000-0000-0000-0000000000b3",
  auditor: "00000000-0000-0000-0000-0000000000b5",
  vendor: "00000000-0000-0000-0000-0000000000b7",
  stranger: "00000000-0000-0000-0000-0000000000f2",
};
const ORG = "10000000-0000-0000-0000-00000000000b";
const OTHER = "10000000-0000-0000-0000-00000000000c";
const GOOD = "0x200cad3c9de63d3613a33fc20b1ef31cb4dbf5af", BAD = "0x" + "9".repeat(40);
let db: PGlite;

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
async function asServer<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role service_role;`);
  try { return await fn(); } finally { await db.exec(`reset role;`); }
}
const one = async (sql: string) => (await db.query(sql)).rows[0] as Record<string, unknown>;
const val = async (user: string, sql: string) => as(user, async () => Object.values(await one(sql))[0]);

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
  const dir = resolve(__dirname, "../../supabase/migrations");
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql", "0006_milestones.sql", "0014_live_execution.sql", "0015_live_decision_guard.sql", "0008_disputes.sql", "0016_agent_workflows.sql", "0017_demo_reset.sql"]) await db.exec(readFileSync(resolve(dir, f), "utf8"));
  // It must be safe to apply twice.
  await db.exec(readFileSync(resolve(dir, "0016_agent_workflows.sql"), "utf8"));
  await db.exec(readFileSync(resolve(dir, "0017_demo_reset.sql"), "utf8")); // later migrations re-apply on top, as in production
  await db.exec(`grant usage on schema public to authenticated, service_role; grant all on all tables in schema public to authenticated, service_role; grant all on all sequences in schema public to authenticated, service_role;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}'), ('${OTHER}','Other DAO','${U.stranger}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.fin}','finance_manager'), ('${ORG}','${U.admin}','administrator'),
      ('${ORG}','${U.auditor}','auditor'), ('${ORG}','${U.vendor}','vendor'), ('${OTHER}','${U.stranger}','owner');
  `);
});

describe("vendors and invoices", () => {
  it("lets finance record a vendor and an invoice, and keeps payout changes in history", async () => {
    const v = (await val(U.fin, `select upsert_vendor('${ORG}', null, 'Nova Design', '${GOOD}', true)`)) as string;
    const inv = await val(U.fin, `select record_invoice('${ORG}','${v}','INV-1', 1000000000000000000, '${GOOD}', current_date, current_date + 7, null, null)`);
    expect(inv).toMatch(/^[0-9a-f-]{36}$/);
    await val(U.fin, `select upsert_vendor('${ORG}', '${v}', 'Nova Design', '${BAD}', true)`);
    expect((await one(`select count(*)::int as n from vendor_address_history where vendor_id = '${v}'`)).n).toBe(2);
  });
  it("refuses roles without finance rights and other organisations", async () => {
    await expect(val(U.auditor, `select upsert_vendor('${ORG}', null, 'X', null, false)`)).rejects.toThrow(/finance role required/);
    await expect(val(U.vendor, `select record_invoice('${ORG}', null, 'INV-9', 1, '${GOOD}', null, null, null, null)`)).rejects.toThrow(/finance role required/);
    await expect(val(U.stranger, `select record_invoice('${ORG}', null, 'INV-9', 1, '${GOOD}', null, null, null, null)`)).rejects.toThrow(/finance role required/);
  });
  it("refuses a duplicate invoice number for the same vendor and bad input", async () => {
    const v = (await val(U.fin, `select upsert_vendor('${ORG}', null, 'Dup Co', '${GOOD}', true)`)) as string;
    await val(U.fin, `select record_invoice('${ORG}','${v}','D-1', 1, '${GOOD}', null, null, null, null)`);
    await expect(val(U.fin, `select record_invoice('${ORG}','${v}','D-1', 1, '${GOOD}', null, null, null, null)`)).rejects.toThrow(/duplicate key|unique/);
    await expect(val(U.fin, `select record_invoice('${ORG}','${v}','D-2', 0, '${GOOD}', null, null, null, null)`)).rejects.toThrow(/amount/);
    await expect(val(U.fin, `select record_invoice('${ORG}','${v}','D-3', 1, 'not-an-address', null, null, null, null)`)).rejects.toThrow(/recipient/);
  });
});

describe("workflows", () => {
  it("starts idempotently: the same key returns the same workflow", async () => {
    const a = await val(U.fin, `select start_invoice_workflow('${ORG}', 'Review our outstanding invoices', 'key-12345678')`);
    const b = await val(U.fin, `select start_invoice_workflow('${ORG}', 'Review our outstanding invoices', 'key-12345678')`);
    expect(a).toBe(b);
    expect((await one(`select state, kind, agent_id from agent_tasks where id = '${a}'`))).toMatchObject({ state: "QUEUED", kind: "invoice_review", agent_id: "Coordinator" });
  });
  it("needs a finance role to start", async () => {
    await expect(val(U.auditor, `select start_invoice_workflow('${ORG}', 'Review invoices', 'key-aaaaaaaa')`)).rejects.toThrow(/finance role required/);
  });
  it("lets internal members read workflows but never advance them", async () => {
    const t = await val(U.fin, `select start_invoice_workflow('${ORG}', 'Review invoices', 'key-read-1234')`);
    expect(await val(U.auditor, `select count(*)::int from agent_tasks where id = '${t}'`)).toBe(1);
    expect(await val(U.stranger, `select count(*)::int from agent_tasks where id = '${t}'`)).toBe(0);
    await as(U.fin, () => db.exec(`update agent_tasks set state = 'COMPLETED' where id = '${t}'`));
    expect((await one(`select state from agent_tasks where id = '${t}'`)).state).toBe("QUEUED");
    await expect(val(U.fin, `select claim_workflow('${t}', 30)`)).rejects.toThrow(/permission denied/);
  });
  it("gives the worker lease to one claimant at a time, and again after it expires", async () => {
    const t = await val(U.fin, `select start_invoice_workflow('${ORG}', 'Review invoices', 'key-lease-1234')`);
    const first = await asServer(() => one(`select (claim_workflow('${t}', 30)).id as id`));
    const second = await asServer(() => one(`select (claim_workflow('${t}', 30)).id as id`));
    expect(first.id).toBe(t);
    expect(second.id).toBeNull();
    await db.exec(`update agent_tasks set lease_until = now() - interval '1 second' where id = '${t}'`); // a crashed worker
    expect((await asServer(() => one(`select (claim_workflow('${t}', 30)).id as id`))).id).toBe(t);
    expect((await one(`select state, attempts from agent_tasks where id = '${t}'`))).toMatchObject({ state: "RUNNING", attempts: 2 });
  });
  it("lets the requester cancel, but not a member from elsewhere", async () => {
    const t = await val(U.fin, `select start_invoice_workflow('${ORG}', 'Review invoices', 'key-cancel-1234')`);
    await expect(val(U.stranger, `select cancel_invoice_workflow('${t}')`)).rejects.toThrow(/not allowed/);
    expect(await val(U.fin, `select cancel_invoice_workflow('${t}')`)).toBe("CANCELLED");
    expect((await asServer(() => one(`select (claim_workflow('${t}', 30)).id as id`))).id).toBeNull();
  });
});

describe("an invoice follows its payment", () => {
  it("is marked paid only when the linked payment is confirmed, and released when the payment ends unpaid", async () => {
    const v = (await val(U.fin, `select upsert_vendor('${ORG}', null, 'Pay Co', '${GOOD}', true)`)) as string;
    const inv = await val(U.fin, `select record_invoice('${ORG}','${v}','P-1', 1000000000000000000, '${GOOD}', null, null, null, null)`);
    const tx = await as(U.fin, async () => (await one(
      `select request_live_payment('${ORG}','wf-key-1','payment','0x${"a".repeat(40)}','0x${"1".repeat(64)}','0x${"0".repeat(40)}','${GOOD}',
        1000000000000000000,'0x${"2".repeat(64)}',1,7,now() + interval '1 hour',1,'0x${"3".repeat(64)}',null,'{}'::jsonb) as id`)).id);
    await db.exec(`update invoices set transaction_id = '${tx}' where id = '${inv}'`);
    await db.exec(`update transactions set state = 'SUBMITTED' where id = '${tx}'`);
    expect((await one(`select status from invoices where id = '${inv}'`)).status).toBe("received");
    await db.exec(`update transactions set state = 'CONFIRMED' where id = '${tx}'`);
    expect((await one(`select status from invoices where id = '${inv}'`)).status).toBe("paid");

    const inv2 = await val(U.fin, `select record_invoice('${ORG}','${v}','P-2', 1000000000000000000, '${GOOD}', null, null, null, null)`);
    const tx2 = await as(U.fin, async () => (await one(
      `select request_live_payment('${ORG}','wf-key-2','payment','0x${"a".repeat(40)}','0x${"4".repeat(64)}','0x${"0".repeat(40)}','${GOOD}',
        1000000000000000000,'0x${"5".repeat(64)}',1,8,now() + interval '1 hour',1,'0x${"6".repeat(64)}',null,'{}'::jsonb) as id`)).id);
    await db.exec(`update invoices set transaction_id = '${tx2}' where id = '${inv2}'`);
    await db.exec(`update transactions set state = 'REJECTED' where id = '${tx2}'`);
    expect((await one(`select status, transaction_id from invoices where id = '${inv2}'`))).toMatchObject({ status: "held", transaction_id: null });
  });
});

describe("demo scenario", () => {
  it("is administrator-only, labelled, and loads once", async () => {
    await expect(val(U.fin, `select seed_invoice_demo('${ORG}', '${GOOD}', '${BAD}')`)).rejects.toThrow(/administrator required/);
    await val(U.admin, `select seed_invoice_demo('${ORG}', '${GOOD}', '${BAD}')`);
    const r = await one(`select count(*)::int as n, bool_and(is_demo) as demo from invoices where organization_id = '${ORG}' and invoice_number like 'DEMO-%'`);
    expect(r).toMatchObject({ n: 3, demo: true });
    await expect(val(U.admin, `select seed_invoice_demo('${ORG}', '${GOOD}', '${BAD}')`)).rejects.toThrow(/already loaded/);
  });
});

describe("demo reset", () => {
  it("clears open demo data, keeps anything linked to a payment, and reloads with 1.25 QOR for invoice A", async () => {
    const before = await one(`select count(*)::int as n from invoices where organization_id = '${ORG}' and is_demo`);
    expect(before.n).toBe(3);
    // Pretend invoice C already has a payment request: it must survive the reset.
    const kept = (await one(`select id from invoices where organization_id = '${ORG}' and invoice_number = 'DEMO-C-7'`)).id as string;
    const tx = (await one(`select id from transactions where organization_id = '${ORG}' limit 1`)).id as string;
    await db.exec(`update invoices set transaction_id = '${tx}' where id = '${kept}'`);
    await expect(val(U.fin, `select clear_invoice_demo('${ORG}')`)).rejects.toThrow(/administrator required/);
    const r = (await val(U.admin, `select clear_invoice_demo('${ORG}')`)) as { invoices: number };
    expect(r.invoices).toBe(2);
    expect((await one(`select count(*)::int as n from invoices where id = '${kept}'`)).n).toBe(1);
    await val(U.admin, `select seed_invoice_demo('${ORG}', '${GOOD}', '${BAD}')`);
    const a = await one(`select amount::text as amount from invoices where organization_id = '${ORG}' and invoice_number = 'DEMO-A-101' and transaction_id is null`);
    expect(a.amount).toBe("1250000000000000000");
  });
});
