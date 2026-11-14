import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0004_procurement.sql: roles, sealed-bid visibility, lifecycle, award rules. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  proc1: "00000000-0000-0000-0000-0000000000a2",
  proc2: "00000000-0000-0000-0000-0000000000a3",
  fin: "00000000-0000-0000-0000-0000000000a4",
  v1: "00000000-0000-0000-0000-0000000000b1",
  v2: "00000000-0000-0000-0000-0000000000b2",
  other: "00000000-0000-0000-0000-0000000000c1",
  stranger: "00000000-0000-0000-0000-0000000000f1",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
const ORG2 = "10000000-0000-0000-0000-00000000000b";
const MLKEM = "ab".repeat(1568);
const X = "cd".repeat(32);
const ENV = "e".repeat(300);
const SHA = "f".repeat(64);
let db: PGlite;

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];
const one = async (user: string, sql: string) => as(user, async () => (await db.query(sql)).rows[0] as Record<string, unknown>);

async function newTender(creator = U.proc1, status = "draft"): Promise<string> {
  return as(creator, async () => {
    const r = await db.query(`insert into procurements(organization_id,title,requirements,budget,token,status,created_by) values ('${ORG}','Website','Build a site',1000000000000000000000,'0x0000000000000000000000000000000000000000','${status}','${creator}') returning id`);
    return (r.rows[0] as { id: string }).id;
  });
}
const openT = (u: string, id: string, deadline = "null") => as(u, () => db.query(`select open_tender('${id}', ${deadline})`));
const bid = (u: string, id: string, name = "Vendor") => as(u, async () => ((await db.query(`select submit_bid('${id}','${name}','${ENV}','${SHA}') as b`)).rows[0] as { b: string }).b);
const close = (u: string, id: string) => as(u, () => db.query(`select close_bidding('${id}')`));
const status = async (id: string) => (await rows(`select status from procurements where id='${id}'`))[0]!.status;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role app_user nologin; create role authenticated nologin; grant authenticated to app_user;
    grant usage on schema auth to app_user;
  `);
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql"]) await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(`grant usage on schema public to app_user; grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user; grant execute on all functions in schema public to app_user;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}'), ('${ORG2}','Other','${U.other}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.proc1}','procurement_manager'), ('${ORG}','${U.proc2}','procurement_manager'),
      ('${ORG}','${U.fin}','finance_manager'), ('${ORG}','${U.v1}','vendor'), ('${ORG}','${U.v2}','vendor'), ('${ORG2}','${U.other}','owner');
  `);
});

describe("reading keys", () => {
  it("only procurement roles publish, once, with valid key shapes", async () => {
    await expect(as(U.fin, () => db.query(`select publish_seal_key('${ORG}','${MLKEM}','${X}')`))).rejects.toThrow(/procurement role required/);
    await expect(as(U.v1, () => db.query(`select publish_seal_key('${ORG}','${MLKEM}','${X}')`))).rejects.toThrow(/procurement role required/);
    await expect(as(U.proc1, () => db.query(`select publish_seal_key('${ORG}','abcd','${X}')`))).rejects.toThrow(/check constraint/);
    await as(U.proc1, () => db.query(`select publish_seal_key('${ORG}','${MLKEM}','${X}')`));
    await expect(as(U.proc1, () => db.query(`select publish_seal_key('${ORG}','${MLKEM}','${X}')`))).rejects.toThrow(/cannot be replaced/);
  });
});

describe("tender lifecycle", () => {
  it("direct writes are denied; only procurement roles can create drafts", async () => {
    await expect(as(U.fin, () => db.exec(`insert into procurements(organization_id,title,budget,token,created_by) values ('${ORG}','x',1,'0x0','${U.fin}')`))).rejects.toThrow(/row-level security/);
    await expect(as(U.proc1, () => db.exec(`insert into procurements(organization_id,title,budget,token,status,created_by) values ('${ORG}','x',1,'0x0','awarded','${U.proc1}')`))).rejects.toThrow(/row-level security/);
    const id = await newTender();
    expect((await as(U.proc1, () => db.query(`update procurements set status='awarded' where id='${id}' returning id`))).rows.length).toBe(0);
    expect(await status(id)).toBe("draft");
  });

  it("open, bid, close, award in order; each step enforces its rules", async () => {
    const id = await newTender();
    await expect(bid(U.v1, id)).rejects.toThrow(/not open/);
    await expect(openT(U.fin, id)).rejects.toThrow(/procurement role required/);
    await expect(openT(U.proc1, id, "now() - interval '1 hour'")).rejects.toThrow(/future/);
    await openT(U.proc1, id);
    expect(await status(id)).toBe("open");
    await expect(openT(U.proc1, id)).rejects.toThrow(/already open/);

    await expect(close(U.proc1, id)).rejects.toThrow(/no bids/);
    const b1 = await bid(U.v1, id, "Vendor One");
    await expect(bid(U.v1, id)).rejects.toThrow(/already submitted/);
    const b2 = await bid(U.v2, id, "Vendor Two");
    await expect(bid(U.proc1, id)).rejects.toThrow(/vendor role required/);
    await expect(bid(U.stranger, id)).rejects.toThrow(/vendor role required/);

    await expect(as(U.proc1, () => db.query(`select * from procurement_bids('${id}')`))).rejects.toThrow(/stay sealed/);
    await expect(close(U.v1, id)).rejects.toThrow(/procurement role required/);
    expect((await close(U.proc2, id)).rows.length).toBe(1);
    await expect(bid(U.v2, id)).rejects.toThrow(/not open/);

    const seen = await as(U.proc1, async () => (await db.query(`select * from procurement_bids('${id}')`)).rows);
    expect(seen.length).toBe(2);
    expect(seen.map((r) => (r as { envelope: string }).envelope)).toEqual([ENV, ENV]);
    await expect(as(U.fin, () => db.query(`select * from procurement_bids('${id}')`))).rejects.toThrow(/procurement role required/);
    await expect(as(U.v1, () => db.query(`select * from procurement_bids('${id}')`))).rejects.toThrow(/procurement role required/);

    const ms = (a: string[]) => JSON.stringify(a.map((x, i) => ({ title: `M${i + 1}`, amount: x }))).replace(/'/g, "''");
    const award = (u: string, bidId: string, m: string) => as(u, () => db.query(`select award_procurement('${id}','${bidId}','${m}'::jsonb)`));
    await expect(award(U.fin, b1, ms(["1"]))).rejects.toThrow(/procurement role required/);
    await expect(award(U.proc1, "00000000-0000-0000-0000-000000000999", ms(["1"]))).rejects.toThrow(/does not belong/);
    await expect(award(U.proc1, b1, ms(["600000000000000000000", "600000000000000000000"]))).rejects.toThrow(/more than the tender budget/);
    await expect(award(U.proc1, b1, "[]")).rejects.toThrow(/1 to 10/);
    await expect(award(U.proc1, b1, ms(["0"]))).rejects.toThrow(/positive/);
    await expect(award(U.proc1, b1, ms(["1.5"]))).rejects.toThrow(/whole number/);
    expect(await status(id)).toBe("review");
    expect(((await award(U.proc1, b2, ms(["400000000000000000000", "500000000000000000000"]))).rows[0] as { award_procurement: number }).award_procurement).toBe(2);
    expect(await status(id)).toBe("awarded");
    expect((await rows(`select award_bid_id from procurements where id='${id}'`))[0]!.award_bid_id).toBe(b2);
    expect((await rows(`select idx, amount::text from milestones where parent_id='${id}' order by idx`)).map((r) => r.amount)).toEqual(["400000000000000000000", "500000000000000000000"]);
    await expect(award(U.proc1, b1, ms(["1"]))).rejects.toThrow(/must be in review/);
    expect((await rows(`select action from audit_events where subject='${id}' order by id`)).map((r) => r.action)).toEqual([
      "procurement.opened", "procurement.bid_submitted", "procurement.bid_submitted", "procurement.bidding_closed", "procurement.awarded",
    ]);
  });

  it("a deadline in the past stops new bids", async () => {
    const id = await newTender();
    await openT(U.proc1, id, "now() + interval '1 second'");
    await new Promise((r) => setTimeout(r, 1500));
    await expect(bid(U.v1, id)).rejects.toThrow(/deadline has passed/);
  });
});

describe("who sees what", () => {
  it("a vendor sees only their own bid row and cannot read ciphertext or the document directly", async () => {
    const id = await newTender();
    await openT(U.proc1, id);
    await bid(U.v1, id, "A");
    await bid(U.v2, id, "B");
    await as(U.v1, async () => {
      expect((await db.query(`select 1 from bids where procurement_id='${id}'`)).rows.length).toBe(1);
      expect((await db.query(`select 1 from documents where purpose='bid' and uploaded_by <> '${U.v1}'`)).rows.length).toBe(0);
    });
    // reviewers cannot read the envelope column directly either: documents are limited to uploader and admins
    await as(U.proc1, async () => expect((await db.query(`select envelope from documents where purpose='bid'`)).rows.length).toBe(0));
  });

  it("vendors see non-draft tenders; drafts stay internal; other organisations see nothing", async () => {
    const draft = await newTender();
    await as(U.v1, async () => expect((await db.query(`select 1 from procurements where id='${draft}'`)).rows.length).toBe(0));
    await openT(U.proc1, draft);
    await as(U.v1, async () => expect((await db.query(`select 1 from procurements where id='${draft}'`)).rows.length).toBe(1));
    await as(U.other, async () => expect((await db.query(`select 1 from procurements`)).rows.length).toBe(0));
    await expect(as(U.other, () => db.query(`select * from procurement_reviewer_keys('${draft}')`))).rejects.toThrow(/unknown tender/);
  });

  it("members can fetch reviewer public keys; only active procurement-role holders are listed", async () => {
    const id = await newTender();
    const keys = await as(U.v1, async () => (await db.query(`select * from procurement_reviewer_keys('${id}')`)).rows);
    expect(keys.length).toBe(1);
    expect((keys[0] as { user_id: string }).user_id).toBe(U.proc1);
    await db.exec(`update memberships set status='revoked' where user_id='${U.proc1}'`);
    expect((await as(U.v1, async () => (await db.query(`select * from procurement_reviewer_keys('${id}')`)).rows)).length).toBe(0);
    await db.exec(`update memberships set status='active' where user_id='${U.proc1}'`);
  });
});

describe("opening needs a reader", () => {
  it("refuses to open a tender when no reviewer has published a key", async () => {
    await db.exec(`delete from org_seal_keys`);
    const id = await newTender();
    await expect(openT(U.proc1, id)).rejects.toThrow(/reading key first/);
    await as(U.proc1, () => db.query(`select publish_seal_key('${ORG}','${MLKEM}','${X}')`));
    await openT(U.proc1, id);
  });
});
