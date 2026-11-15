import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0014_live_execution.sql: who can request, decide and execute a live testnet payment. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  fin: "00000000-0000-0000-0000-0000000000a2",
  admin: "00000000-0000-0000-0000-0000000000a3",
  admin2: "00000000-0000-0000-0000-0000000000a6",
  auditor: "00000000-0000-0000-0000-0000000000a5",
  stranger: "00000000-0000-0000-0000-0000000000f1",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
let db: PGlite;
let n = 0;

const hex = (len: number, seed: number) => "0x" + seed.toString(16).padStart(len, "0");
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
async function asServer<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role service_role;`);
  try { return await fn(); } finally { await db.exec(`reset role;`); }
}
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];

interface Over { amount?: string; expires?: string; required?: number; org?: string; kind?: string; project?: string }
async function request(user: string, o: Over = {}): Promise<string> {
  n++;
  return as(user, async () => {
    const r = await db.query(
      `select request_live_payment('${o.org ?? ORG}','live-key-${n}','${o.kind ?? "payment"}','0x${"a".repeat(40)}','${hex(64, n)}','0x${"0".repeat(40)}','0x${"2".repeat(40)}',
        ${o.amount ?? "5000000000000000000"},'${hex(64, 1000 + n)}',1,${n},now() + interval '${o.expires ?? "1 hour"}',${o.required ?? 1},'${hex(64, 2000 + n)}',${o.project ?? "null"},'{}'::jsonb) as id`,
    );
    return (r.rows[0] as { id: string }).id;
  });
}
const decide = (user: string, tx: string, d = "approve") => as(user, async () => ((await db.query(`select decide_live_payment('${tx}','${d}','ok','password re-entry') as s`)).rows[0] as { s: string }).s);
const state = async (tx: string) => (await rows(`select state from transactions where id = '${tx}'`))[0]!.state as string;
const claim = (tx: string) => asServer(() => db.query(`select * from live_claim_execution('${tx}')`));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated nologin; create role app_user nologin; grant authenticated to app_user;
    create role service_role nologin bypassrls; create role anon nologin;
    grant usage on schema auth to app_user, service_role;
    -- Supabase's default: every new function in public is executable by the browser-facing roles unless revoked.
    alter default privileges in schema public grant execute on functions to authenticated, service_role;
  `);
  const dir = resolve(__dirname, "../../supabase/migrations");
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql", "0006_milestones.sql", "0014_live_execution.sql", "0015_live_decision_guard.sql"]) await db.exec(readFileSync(resolve(dir, f), "utf8"));
  await db.exec(`grant usage on schema public to authenticated, service_role; grant all on all tables in schema public to authenticated, service_role; grant all on all sequences in schema public to authenticated, service_role;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.fin}','finance_manager'), ('${ORG}','${U.admin}','administrator'),
      ('${ORG}','${U.admin2}','administrator'), ('${ORG}','${U.auditor}','auditor');
  `);
});

describe("requesting a live payment", () => {
  it("lets a finance role request and starts at AWAITING_APPROVAL as a live testnet operation", async () => {
    const tx = await request(U.fin);
    const r = (await rows(`select state, source, kind, agent_account, calldata_hash from transactions where id = '${tx}'`))[0]!;
    expect(r.state).toBe("AWAITING_APPROVAL");
    expect(r.source).toBe("LIVE_TESTNET");
    expect(r.kind).toBe("payment");
    expect(r.calldata_hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("refuses anyone without a finance role", async () => {
    await expect(request(U.auditor)).rejects.toThrow(/finance role required/);
    await expect(request(U.stranger)).rejects.toThrow(/finance role required/);
  });
  it("refuses more than 10 QOR, and exactly 10 is the most", async () => {
    await expect(request(U.fin, { amount: "10000000000000000001" })).rejects.toThrow(/limited to 10 QOR/);
    await expect(request(U.fin, { amount: "10000000000000000000" })).resolves.toBeTruthy();
    await expect(request(U.fin, { amount: "0" })).rejects.toThrow(/limited to 10 QOR/);
  });
  it("refuses an expiry more than 24 hours away or already past", async () => {
    await expect(request(U.fin, { expires: "25 hours" })).rejects.toThrow(/within the next 24 hours/);
    await expect(request(U.fin, { expires: "-1 minute" })).rejects.toThrow(/within the next 24 hours/);
  });
  it("needs a project id for escrow funding", async () => {
    await expect(request(U.fin, { kind: "escrow_fund" })).rejects.toThrow(/project id/);
    await expect(request(U.fin, { kind: "escrow_fund", project: "1" })).resolves.toBeTruthy();
  });
  it("cannot be used by a signed-in user to write the table directly", async () => {
    const tx = await request(U.fin);
    await expect(as(U.fin, () => db.exec(`update transactions set state = 'APPROVED' where id = '${tx}'`))).resolves.not.toThrow();
    expect(await state(tx)).toBe("AWAITING_APPROVAL"); // RLS filtered the update to zero rows
  });
});

describe("deciding", () => {
  it("only an owner or administrator can decide a live payment, never the requester", async () => {
    const tx = await request(U.fin);
    await expect(decide(U.fin, tx)).rejects.toThrow(/only an owner or administrator/);
    await expect(decide(U.auditor, tx)).rejects.toThrow(/only an owner or administrator/);
    expect(await decide(U.admin, tx)).toBe("APPROVED");
    const own = await request(U.admin);
    await expect(decide(U.admin, own)).rejects.toThrow(/separation of duties/);
  });
  it("records the authentication method and the exact payment hash with the decision", async () => {
    const tx = await request(U.fin);
    await decide(U.admin, tx);
    const ev = (await rows(`select evidence from approvals where subject_id = '${tx}'`))[0]!.evidence as Record<string, string>;
    expect(ev.auth_method).toBe("password re-entry");
    expect(ev.payment_hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("needs every required approval from different administrators", async () => {
    const tx = await request(U.fin, { required: 2 });
    expect(await decide(U.admin, tx)).toBe("AWAITING_APPROVAL");
    await expect(decide(U.admin, tx)).rejects.toThrow(/already decided/);
    expect(await decide(U.admin2, tx)).toBe("APPROVED");
  });
  it("a rejection is final", async () => {
    const tx = await request(U.fin);
    expect(await decide(U.admin, tx, "reject")).toBe("REJECTED");
    await expect(decide(U.admin2, tx)).rejects.toThrow(/already REJECTED/);
  });
  it("cannot be approved through the generic decide_payment, which has no password step or administrator rule", async () => {
    const tx = await request(U.fin);
    const generic = (user: string, d = "approve") => as(user, async () => (await db.query(`select decide_payment('${tx}','${d}','sneaky') as s`)).rows[0]);
    await expect(generic(U.admin)).rejects.toThrow(/live payment/);
    await expect(generic(U.owner)).rejects.toThrow(/live payment/);
    await expect(generic(U.admin, "reject")).rejects.toThrow(/live payment/);
    expect(await state(tx)).toBe("AWAITING_APPROVAL");
    expect(await rows(`select 1 from approvals where subject_id = '${tx}'`)).toHaveLength(0);
    expect(await decide(U.admin, tx)).toBe("APPROVED"); // the proper path still works
  });
  it("still lets the generic path decide ordinary simulation requests", async () => {
    n++;
    const sim = await as(U.fin, async () => ((await db.query(`select request_payment_approval('${ORG}','sim-ok-${n}','PaymentAgent','${hex(64, 9500 + n)}','0x${"0".repeat(40)}','0x${"2".repeat(40)}',500000000000,1,now() + interval '1 hour',1,'{}'::jsonb) as id`)).rows[0] as { id: string }).id);
    const s = await as(U.admin, async () => ((await db.query(`select decide_payment('${sim}','approve') as s`)).rows[0] as { s: string }).s);
    expect(s).toBe("APPROVED");
  });
  it("does not accept a decision on a simulation record", async () => {
    n++;
    const sim = await as(U.fin, async () => ((await db.query(`select request_payment_approval('${ORG}','sim-${n}','PaymentAgent','${hex(64, 9000 + n)}','0x${"0".repeat(40)}','0x${"2".repeat(40)}',500000000000,1,now() + interval '1 hour',1,'{}'::jsonb) as id`)).rows[0] as { id: string }).id);
    await expect(decide(U.admin, sim)).rejects.toThrow(/not a live operation/);
  });
});

describe("server-only execution", () => {
  it("signed-in users cannot call any server function", async () => {
    const tx = await request(U.fin);
    await decide(U.admin, tx);
    for (const sql of [
      `select live_claim_execution('${tx}')`, `select live_record_relay('${tx}','0x${"1".repeat(64)}')`, `select live_record_submitted('${tx}','0x${"1".repeat(64)}')`,
      `select live_record_outcome('${tx}', true, 1, 'x')`, `select live_record_failure('${tx}', 'x')`, `select live_raise_alert('${ORG}','x','${tx}','{}'::jsonb)`,
    ]) await expect(as(U.admin, () => db.query(sql))).rejects.toThrow(/permission denied/);
    expect(await state(tx)).toBe("APPROVED");
  });
  it("runs the full path APPROVED -> READY -> SUBMITTED -> CONFIRMED and keeps the evidence", async () => {
    const tx = await request(U.fin);
    await decide(U.admin, tx);
    await claim(tx);
    expect(await state(tx)).toBe("READY");
    await asServer(() => db.query(`select live_record_relay('${tx}','0x${"a".repeat(64)}')`));
    await asServer(() => db.query(`select live_record_submitted('${tx}','0x${"b".repeat(64)}')`));
    expect(await state(tx)).toBe("SUBMITTED");
    await asServer(() => db.query(`select live_record_outcome('${tx}', true, 12345, null)`));
    const r = (await rows(`select state, tx_hash, onchain_approval_tx, block_number, confirmed_at from transactions where id = '${tx}'`))[0]!;
    expect(r).toMatchObject({ state: "CONFIRMED", tx_hash: "0x" + "b".repeat(64), onchain_approval_tx: "0x" + "a".repeat(64) });
    expect(Number(r.block_number)).toBe(12345);
    expect(r.confirmed_at).toBeTruthy();
    const actions = (await rows(`select action from audit_events where subject = '${tx}' order by id`)).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["live_payment.requested", "payment.approve", "live_payment.claimed", "live_payment.approval_relayed", "live_payment.submitted", "live_payment.confirmed"]));
  });
  it("cannot claim an operation that is not approved, and cannot claim one twice (no duplicate payment)", async () => {
    const pending = await request(U.fin);
    await expect(claim(pending)).rejects.toThrow(/AWAITING_APPROVAL/);
    const tx = await request(U.fin);
    await decide(U.admin, tx);
    await claim(tx);
    await expect(claim(tx)).rejects.toThrow(/READY and cannot be executed/);
  });
  it("cannot claim a rejected operation", async () => {
    const tx = await request(U.fin);
    await decide(U.admin, tx, "reject");
    await expect(claim(tx)).rejects.toThrow(/REJECTED/);
  });
  it("refuses to confirm something that was never submitted", async () => {
    const tx = await request(U.fin);
    await decide(U.admin, tx);
    await claim(tx);
    await expect(asServer(() => db.query(`select live_record_outcome('${tx}', true, 1, null)`))).rejects.toThrow(/not submitted/);
  });
  it("records a revert as FAILED with the reason, never as CONFIRMED", async () => {
    const tx = await request(U.fin);
    await decide(U.admin, tx);
    await claim(tx);
    await asServer(() => db.query(`select live_record_submitted('${tx}','0x${"c".repeat(64)}')`));
    await asServer(() => db.query(`select live_record_outcome('${tx}', false, 99, 'Reverted on chain: ExceedsPerTxCap')`));
    const r = (await rows(`select state, failure_reason, confirmed_at from transactions where id = '${tx}'`))[0]!;
    expect(r).toMatchObject({ state: "FAILED", failure_reason: "Reverted on chain: ExceedsPerTxCap", confirmed_at: null });
  });
  it("records a failure before submission and cancels an expired approval", async () => {
    const tx = await request(U.fin);
    await decide(U.admin, tx);
    await asServer(() => db.query(`select live_record_failure('${tx}','Simulation failed: InsufficientApprovals')`));
    expect(await state(tx)).toBe("FAILED");
    const old = await request(U.fin);
    await decide(U.admin, old);
    await db.exec(`update transactions set expires_at = now() - interval '1 minute' where id = '${old}'`);
    await expect(claim(old)).rejects.toThrow(/expired/);
  });
  it("a security alert is visible to security roles and not to ordinary employees", async () => {
    const tx = await request(U.fin);
    await asServer(() => db.query(`select live_raise_alert('${ORG}','calldata_mismatch','${tx}','{"why":"test"}'::jsonb)`));
    expect(((await as(U.admin, () => db.query(`select kind from security_alerts`))).rows as Array<{ kind: string }>).map((x) => x.kind)).toContain("calldata_mismatch");
    expect((await as(U.auditor, () => db.query(`select kind from security_alerts`))).rows).toHaveLength(0);
  });
});

describe("idempotency", () => {
  it("the same idempotency key cannot create a second operation", async () => {
    n++;
    const call = () => as(U.fin, () => db.query(`select request_live_payment('${ORG}','same-key','payment','0x${"a".repeat(40)}','${hex(64, 777000 + n)}','0x${"0".repeat(40)}','0x${"2".repeat(40)}',1000,'${hex(64, 5)}',1,1,now() + interval '1 hour',1,'${hex(64, 6)}',null,'{}'::jsonb)`));
    await call();
    await expect(call()).rejects.toThrow(/duplicate key|unique/);
  });
  it("the same payment hash cannot be requested twice", async () => {
    n++;
    const h = hex(64, 888000 + n);
    const call = (k: string) => as(U.fin, () => db.query(`select request_live_payment('${ORG}','${k}','payment','0x${"a".repeat(40)}','${h}','0x${"0".repeat(40)}','0x${"2".repeat(40)}',1000,'${hex(64, 5)}',1,1,now() + interval '1 hour',1,'${hex(64, 6)}',null,'{}'::jsonb)`));
    await call("k-one");
    await expect(call("k-two")).rejects.toThrow(/duplicate key|unique/);
  });
});
