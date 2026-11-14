import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0011_vault.sql: who can publish keys, choose readers, fetch and delete sealed documents. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  fin: "00000000-0000-0000-0000-0000000000a3",
  emp: "00000000-0000-0000-0000-0000000000f1",
  nokey: "00000000-0000-0000-0000-0000000000f2",
  vendor: "00000000-0000-0000-0000-0000000000b1",
  other: "00000000-0000-0000-0000-0000000000c1",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
const ORG2 = "10000000-0000-0000-0000-00000000000b";
const MLKEM = "ab".repeat(1568), X = "cd".repeat(32), ENV = "e".repeat(300), SHA = "f".repeat(64);
let db: PGlite;

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];
const q = (u: string, sql: string) => as(u, () => db.query(sql));
const arr = (ids: string[]) => (ids.length ? `array[${ids.map((i) => `'${i}'::uuid`).join(",")}]` : "array[]::uuid[]");
async function upload(u: string, readers: string[], title = "Board minutes") {
  const id = randomUUID();
  await q(u, `select upload_vault_document('${ORG}','${id}','${title}','${ENV}','${SHA}', ${arr(readers)})`);
  return id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role app_user nologin; create role authenticated nologin; grant authenticated to app_user;
    grant usage on schema auth to app_user;
  `);
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql", "0006_milestones.sql", "0007_governance.sql", "0008_disputes.sql", "0009_grants.sql", "0010_revenue.sql", "0011_vault.sql"]) await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(`grant usage on schema public to app_user; grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user; grant execute on all functions in schema public to app_user;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}'), ('${ORG2}','Other','${U.other}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.fin}','finance_manager'), ('${ORG}','${U.emp}','employee'), ('${ORG}','${U.nokey}','employee'),
      ('${ORG}','${U.vendor}','vendor'), ('${ORG2}','${U.other}','owner');
  `);
});

describe("reading keys", () => {
  it("any internal member can publish one, once, but vendors and outsiders cannot", async () => {
    for (const u of [U.vendor, U.other]) await expect(q(u, `select publish_my_seal_key('${ORG}','${MLKEM}','${X}')`)).rejects.toThrow(/organisation members only/);
    await expect(q(U.owner, `select publish_my_seal_key('${ORG}','abcd','${X}')`)).rejects.toThrow(/invalid public key/);
    for (const u of [U.owner, U.fin, U.emp]) await q(u, `select publish_my_seal_key('${ORG}','${MLKEM}','${X}')`);
    await q(U.fin, `select publish_my_seal_key('${ORG}','${MLKEM}','${X}')`); // same key again is a no-op
    await expect(q(U.fin, `select publish_my_seal_key('${ORG}','${"12".repeat(1568)}','${X}')`)).rejects.toThrow(/cannot be replaced/);
  });
  it("the reader list is internal members with keys only", async () => {
    const r = await as(U.owner, async () => (await db.query(`select user_id from vault_recipients('${ORG}')`)).rows.map((x) => (x as { user_id: string }).user_id));
    expect(r.sort()).toEqual([U.owner, U.fin, U.emp].sort());
    for (const u of [U.vendor, U.other]) await expect(q(u, `select * from vault_recipients('${ORG}')`)).rejects.toThrow(/organisation members only/);
  });
});

describe("uploading", () => {
  it("only internal members upload, to readers who have keys, including themselves", async () => {
    for (const u of [U.vendor, U.other]) await expect(upload(u, [u])).rejects.toThrow(/organisation members only/);
    await expect(upload(U.owner, [U.fin])).rejects.toThrow(/one of the readers/);
    await expect(upload(U.owner, [U.owner, U.nokey])).rejects.toThrow(/published a reading key/);
    await expect(upload(U.owner, [U.owner, U.vendor])).rejects.toThrow(/published a reading key/);
    await expect(upload(U.owner, [])).rejects.toThrow(/1 to 50 readers/);
    await expect(upload(U.owner, [U.owner], "")).rejects.toThrow(/title/);
    await expect(q(U.owner, `select upload_vault_document('${ORG}','${randomUUID()}','t','short','${SHA}', ${arr([U.owner])})`)).rejects.toThrow(/invalid size/);
    await expect(q(U.owner, `select upload_vault_document('${ORG}','${randomUUID()}','t','${ENV}','nothex', ${arr([U.owner])})`)).rejects.toThrow(/invalid checksum/);
    const id = await upload(U.owner, [U.owner, U.fin]);
    expect((await rows(`select purpose, title, envelope_bytes from documents where id='${id}'`))[0]).toMatchObject({ purpose: "vault", title: "Board minutes", envelope_bytes: 300 });
    expect((await rows(`select count(*)::int as c from document_access where document_id='${id}'`))[0]!.c).toBe(2);
  });
  it("direct writes are denied", async () => {
    await expect(as(U.owner, () => db.exec(`insert into documents(organization_id,purpose,storage_path,ciphertext_sha256,envelope_bytes,uploaded_by) values ('${ORG}','vault','x','${SHA}',1,'${U.owner}')`))).rejects.toThrow(/row-level security/);
    const id = await upload(U.owner, [U.owner]);
    await expect(as(U.owner, () => db.exec(`insert into document_access(organization_id,document_id,user_id,granted_by) values ('${ORG}','${id}','${U.emp}','${U.owner}')`))).rejects.toThrow(/row-level security/);
  });
});

describe("reading and deleting", () => {
  it("only listed readers can fetch the envelope, and every fetch is logged", async () => {
    const id = await upload(U.fin, [U.fin, U.emp]);
    for (const u of [U.fin, U.emp]) await as(u, async () => expect((await db.query(`select envelope_sha256 from vault_document_envelope('${id}')`)).rows[0]).toMatchObject({ envelope_sha256: SHA }));
    for (const u of [U.owner, U.nokey, U.vendor, U.other]) await expect(q(u, `select * from vault_document_envelope('${id}')`)).rejects.toThrow(/not a reader/);
    expect((await rows(`select count(*)::int as c from audit_events where subject='${id}' and action='vault.fetched'`))[0]!.c).toBe(2);
  });
  it("other organisations and non-readers cannot list it, except administrators see that it exists", async () => {
    const id = await upload(U.fin, [U.fin]);
    await as(U.emp, async () => expect((await db.query(`select 1 from documents where id='${id}'`)).rows.length).toBe(0));
    for (const u of [U.vendor, U.other]) await as(u, async () => expect((await db.query(`select 1 from documents where id='${id}'`)).rows.length).toBe(0));
    await as(U.owner, async () => expect((await db.query(`select 1 from documents where id='${id}'`)).rows.length).toBe(1)); // metadata and ciphertext, not plaintext
  });
  it("the uploader or an administrator can delete; others cannot", async () => {
    const id = await upload(U.fin, [U.fin, U.emp]);
    await expect(q(U.emp, `select delete_vault_document('${id}')`)).rejects.toThrow(/not allowed/);
    await expect(q(U.other, `select delete_vault_document('${id}')`)).rejects.toThrow(/not allowed/);
    await q(U.fin, `select delete_vault_document('${id}')`);
    expect((await rows(`select 1 from documents where id='${id}'`)).length).toBe(0);
    const id2 = await upload(U.fin, [U.fin]);
    await q(U.owner, `select delete_vault_document('${id2}')`);
    expect((await rows(`select 1 from documents where id='${id2}'`)).length).toBe(0);
  });
  it("is recorded in the audit log", async () => {
    const id = await upload(U.fin, [U.fin]);
    await as(U.fin, () => db.query(`select * from vault_document_envelope('${id}')`));
    await q(U.fin, `select delete_vault_document('${id}')`);
    expect((await rows(`select action from audit_events where subject='${id}' order by id`)).map((x) => x.action)).toEqual(["vault.uploaded", "vault.fetched", "vault.deleted"]);
  });
});
