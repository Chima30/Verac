import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0018_v2_signed_approvals.sql: V2 payments are approved only by recorded administrator signatures. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  fin: "00000000-0000-0000-0000-0000000000a2",
  admin: "00000000-0000-0000-0000-0000000000a3",
  admin2: "00000000-0000-0000-0000-0000000000a6",
  auditor: "00000000-0000-0000-0000-0000000000a5",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
const VAULT = "0x" + "c".repeat(40);
const SIG = "0x" + "ab".repeat(4627);
const ADMIN_KEY_1 = "0x" + "1".repeat(40), ADMIN_KEY_2 = "0x" + "2".repeat(40);
let db: PGlite;
let n = 0;

const hex64 = (seed: number) => "0x" + seed.toString(16).padStart(64, "0");
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
async function asServer<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role service_role;`);
  try { return await fn(); } finally { await db.exec(`reset role;`); }
}
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];
const state = async (tx: string) => (await rows(`select state from transactions where id = '${tx}'`))[0]!.state as string;

async function requestV2(user: string, required = 2): Promise<{ tx: string; digest: string }> {
  n++;
  const digest = hex64(5000 + n);
  const tx = await as(user, async () => ((await db.query(
    `select request_live_payment_v2('${ORG}','v2-key-${n}','0x${"a".repeat(40)}','${VAULT}','${digest}','0x${"0".repeat(40)}','0x${"2".repeat(40)}',
      1000000000000000000,'${hex64(9000 + n)}',1,${n},now() + interval '1 hour',${required},'{}'::jsonb) as id`,
  )).rows[0] as { id: string }).id);
  return { tx, digest };
}
const record = (tx: string, signer: string, digest: string) =>
  asServer(async () => ((await db.query(`select v2_record_signature('${tx}','${signer}','${digest}','${SIG}','${U.admin}') as n`)).rows[0] as { n: number }).n);

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
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql", "0006_milestones.sql", "0014_live_execution.sql", "0015_live_decision_guard.sql", "0018_v2_signed_approvals.sql"])
    await db.exec(readFileSync(resolve(dir, f), "utf8"));
  await db.exec(readFileSync(resolve(dir, "0018_v2_signed_approvals.sql"), "utf8")); // re-runnable
  await db.exec(`grant usage on schema public to authenticated, service_role; grant all on all tables in schema public to authenticated, service_role; grant all on all sequences in schema public to authenticated, service_role;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.fin}','finance_manager'), ('${ORG}','${U.admin}','administrator'),
      ('${ORG}','${U.admin2}','administrator'), ('${ORG}','${U.auditor}','auditor');
  `);
  await as(U.owner, () => db.query(`select set_admin_signer('${ORG}','${ADMIN_KEY_1}','${U.admin}','admin one',true)`));
  await as(U.owner, () => db.query(`select set_admin_signer('${ORG}','${ADMIN_KEY_2}','${U.admin2}','admin two',true)`));
});

describe("requesting a V2 payment", () => {
  it("creates a live V2 operation awaiting signatures, bound to its digest", async () => {
    const { tx, digest } = await requestV2(U.fin);
    const r = (await rows(`select state, vault_version, vault_address, payment_hash, calldata_hash, required_approvals from transactions where id = '${tx}'`))[0]!;
    expect(r).toMatchObject({ state: "AWAITING_APPROVAL", vault_version: 2, vault_address: VAULT, payment_hash: digest, calldata_hash: digest, required_approvals: 2 });
  });
  it("refuses fewer than two required signatures and non-finance users", async () => {
    await expect(requestV2(U.fin, 1)).rejects.toThrow(/2 to 10 administrator signatures/);
    await expect(requestV2(U.auditor)).rejects.toThrow(/finance role required/);
  });
});

describe("approving a V2 payment", () => {
  it("cannot be approved with a password, only rejected", async () => {
    const { tx } = await requestV2(U.fin);
    await expect(as(U.admin, () => db.query(`select decide_live_payment('${tx}','approve','ok','password re-entry')`))).rejects.toThrow(/approved only by administrators' own ML-DSA-87 signatures/);
    await as(U.admin, () => db.query(`select decide_live_payment('${tx}','reject','not this one','session (rejection)')`));
    expect(await state(tx)).toBe("REJECTED");
  });
  it("is not reachable by signed-in users: only the server records signatures", async () => {
    const { tx, digest } = await requestV2(U.fin);
    await expect(as(U.admin, () => db.query(`select v2_record_signature('${tx}','${ADMIN_KEY_1}','${digest}','${SIG}','${U.admin}')`))).rejects.toThrow(/permission denied/);
  });
  it("becomes APPROVED at the threshold of distinct signers, and refuses duplicates and other digests", async () => {
    const { tx, digest } = await requestV2(U.fin);
    await expect(record(tx, ADMIN_KEY_1, hex64(1))).rejects.toThrow(/different payment/);
    expect(await record(tx, ADMIN_KEY_1, digest)).toBe(1);
    expect(await state(tx)).toBe("AWAITING_APPROVAL");
    await expect(record(tx, ADMIN_KEY_1.toUpperCase().replace("0X", "0x"), digest)).rejects.toThrow(/duplicate key|unique/);
    expect(await record(tx, ADMIN_KEY_2, digest)).toBe(2);
    expect(await state(tx)).toBe("APPROVED");
    await expect(record(tx, "0x" + "3".repeat(40), digest)).rejects.toThrow(/takes no more signatures/);
  });
  it("refuses a signature from the requester's own key (separation of duties)", async () => {
    // ADMIN_KEY_1 is registered to U.admin (beforeAll). An administrator who requests a payment cannot approve it with the key registered to them.
    const { tx, digest } = await (async () => { n++; const d = hex64(7000 + n); const id = await as(U.admin, async () => ((await db.query(
      `select request_live_payment_v2('${ORG}','v2-self-${n}','0x${"a".repeat(40)}','${VAULT}','${d}','0x${"0".repeat(40)}','0x${"2".repeat(40)}',1,'${hex64(1)}',1,${n},now() + interval '1 hour',2,'{}'::jsonb) as id`)).rows[0] as { id: string }).id); return { tx: id, digest: d }; })();
    await expect(record(tx, ADMIN_KEY_1, digest)).rejects.toThrow(/separation of duties/);
    expect(await record(tx, ADMIN_KEY_2, digest)).toBe(1);
  });
});

describe("executing a V2 payment", () => {
  it("is claimed only when enough signatures are recorded, and only once", async () => {
    const { tx, digest } = await requestV2(U.fin);
    await expect(asServer(() => db.query(`select * from live_claim_execution('${tx}')`))).rejects.toThrow(/cannot be executed/);
    await record(tx, ADMIN_KEY_1, digest);
    await record(tx, ADMIN_KEY_2, digest);
    const claimed = await asServer(() => db.query(`select state, vault_version from live_claim_execution('${tx}')`));
    expect(claimed.rows[0]).toMatchObject({ state: "READY", vault_version: 2 });
    await expect(asServer(() => db.query(`select * from live_claim_execution('${tx}')`))).rejects.toThrow(/READY and cannot be executed/);
  });
});

describe("administrator addresses", () => {
  it("only owners and administrators can register them, and only for owners or administrators", async () => {
    await expect(as(U.fin, () => db.query(`select set_admin_signer('${ORG}','0x${"9".repeat(40)}','${U.fin}',null,true)`))).rejects.toThrow(/only an owner or administrator/);
    await expect(as(U.owner, () => db.query(`select set_admin_signer('${ORG}','0x${"9".repeat(40)}','${U.fin}',null,true)`))).rejects.toThrow(/not an owner or administrator/);
  });
  it("signatures and administrator addresses are not visible to an auditor", async () => {
    expect((await as(U.auditor, () => rows(`select * from v2_signatures`))).length).toBe(0);
    expect((await as(U.auditor, () => rows(`select * from admin_signers`))).length).toBe(0);
    expect((await as(U.fin, () => rows(`select * from admin_signers`))).length).toBeGreaterThan(0);
  });
});
