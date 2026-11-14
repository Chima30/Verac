import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0006_milestones.sql on top of procurement (0004) and approvals (0003). */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  proc: "00000000-0000-0000-0000-0000000000a2",
  fin1: "00000000-0000-0000-0000-0000000000a3",
  fin2: "00000000-0000-0000-0000-0000000000a4",
  win: "00000000-0000-0000-0000-0000000000b1",
  lose: "00000000-0000-0000-0000-0000000000b2",
  other: "00000000-0000-0000-0000-0000000000c1",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
const ORG2 = "10000000-0000-0000-0000-00000000000b";
const MLKEM = "ab".repeat(1568), X = "cd".repeat(32), ENV = "e".repeat(300), SHA = "f".repeat(64);
const PAYOUT = "0x" + "9".repeat(40);
let db: PGlite;
let n = 0;
let ms1 = "", ms2 = "";

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];
const q = (u: string, sql: string) => as(u, () => db.query(sql));
const evidence = (u: string, ms: string) => q(u, `select submit_milestone_evidence('${ms}','${ENV}','${SHA}')`);
const decide = (u: string, ms: string, d: string) => as(u, async () => ((await db.query(`select decide_milestone('${ms}','${d}','note') as s`)).rows[0] as { s: string }).s);
const status = async (ms: string) => (await rows(`select status from milestones where id='${ms}'`))[0]!.status;
const ev = (to: string, amount: string) => JSON.stringify({ proposal: { to, amount } });
function requestPay(u: string, ms: string, to = PAYOUT, amount = "40000000000000000000", required = 1) {
  n++;
  return as(u, async () => ((await db.query(`select request_milestone_payment('${ms}','0x${n.toString(16).padStart(64, "0")}', ${required}, now() + interval '1 day', '${ev(to, amount)}'::jsonb) as tx`)).rows[0] as { tx: string }).tx);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role app_user nologin; create role authenticated nologin; grant authenticated to app_user;
    grant usage on schema auth to app_user;
  `);
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql", "0006_milestones.sql"]) await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(`grant usage on schema public to app_user; grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user; grant execute on all functions in schema public to app_user;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}'), ('${ORG2}','Other','${U.other}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.proc}','procurement_manager'), ('${ORG}','${U.fin1}','finance_manager'), ('${ORG}','${U.fin2}','finance_manager'),
      ('${ORG}','${U.win}','vendor'), ('${ORG}','${U.lose}','vendor'), ('${ORG2}','${U.other}','owner');
  `);
  // run a procurement to "awarded" with two milestones (40 + 20 QOR)
  await q(U.proc, `select publish_seal_key('${ORG}','${MLKEM}','${X}')`);
  const t = (await as(U.proc, () => db.query(`insert into procurements(organization_id,title,requirements,budget,token,status,created_by) values ('${ORG}','Site','reqs',100000000000000000000,'0x0','draft','${U.proc}') returning id`))).rows[0] as { id: string };
  await q(U.proc, `select open_tender('${t.id}')`);
  const bw = ((await as(U.win, () => db.query(`select submit_bid('${t.id}','Winner Co','${ENV}','${SHA}') as b`))).rows[0] as { b: string }).b;
  await q(U.lose, `select submit_bid('${t.id}','Loser Co','${ENV}','${SHA}')`);
  await q(U.proc, `select close_bidding('${t.id}')`);
  await q(U.proc, `select award_procurement('${t.id}','${bw}','[{"title":"Design","amount":"40000000000000000000"},{"title":"Build","amount":"20000000000000000000"}]'::jsonb)`);
  const ms = await rows(`select id, idx from milestones where parent_id='${t.id}' order by idx`);
  ms1 = ms[0]!.id as string; ms2 = ms[1]!.id as string;
});

describe("payout address", () => {
  it("only a vendor with a vendor record can set it, in a valid format, and every change is recorded", async () => {
    await expect(q(U.proc, `select set_my_payout_address('${ORG}','${PAYOUT}')`)).rejects.toThrow(/vendor role required/);
    await expect(q(U.win, `select set_my_payout_address('${ORG}','0x123')`)).rejects.toThrow(/payout address must be/);
    await q(U.win, `select set_my_payout_address('${ORG}','${PAYOUT.toUpperCase().replace("0X", "0x")}')`);
    await q(U.win, `select set_my_payout_address('${ORG}','${PAYOUT}')`); // same address again is a no-op
    expect((await rows(`select payout_address from vendors where user_id='${U.win}'`))[0]!.payout_address).toBe(PAYOUT);
    expect((await rows(`select count(*)::int as c from vendor_address_history`))[0]!.c).toBe(1);
  });
});

describe("evidence and review", () => {
  it("only the awarded vendor can submit, in order, and only once per round", async () => {
    await expect(evidence(U.lose, ms1)).rejects.toThrow(/only the awarded vendor/);
    await expect(evidence(U.proc, ms1)).rejects.toThrow(/only the awarded vendor/);
    await expect(evidence(U.win, ms2)).rejects.toThrow(/must be accepted first/);
    await evidence(U.win, ms1);
    expect(await status(ms1)).toBe("evidence_submitted");
    await expect(evidence(U.win, ms1)).rejects.toThrow(/not pending/);
  });

  it("reviewers (and only they) can read the evidence ciphertext", async () => {
    const r = await as(U.proc, async () => (await db.query(`select * from milestone_evidence('${ms1}')`)).rows);
    expect((r[0] as { envelope: string }).envelope).toBe(ENV);
    for (const u of [U.fin1, U.win, U.lose, U.other]) await expect(q(u, `select * from milestone_evidence('${ms1}')`)).rejects.toThrow(/procurement role required/);
  });

  it("a rejection sends it back for new evidence; an acceptance unlocks the next milestone", async () => {
    await expect(decide(U.fin1, ms1, "approve")).rejects.toThrow(/procurement role required/);
    await expect(decide(U.win, ms1, "approve")).rejects.toThrow(/procurement role required/);
    await expect(decide(U.proc, ms1, "maybe")).rejects.toThrow(/approve or reject/);
    expect(await decide(U.proc, ms1, "reject")).toBe("pending");
    expect((await rows(`select evidence_document_id from milestones where id='${ms1}'`))[0]!.evidence_document_id).toBeNull();
    await evidence(U.win, ms1);
    expect(await decide(U.proc, ms1, "approve")).toBe("approved");
    await expect(decide(U.proc, ms1, "approve")).rejects.toThrow(/not awaiting review/);
    await evidence(U.win, ms2); // now allowed
    expect(await status(ms2)).toBe("evidence_submitted");
  });

  it("the vendor sees only their own milestones; the losing bidder and other organisations see none", async () => {
    expect((await as(U.win, async () => (await db.query(`select 1 from milestones`)).rows)).length).toBe(2);
    expect((await as(U.lose, async () => (await db.query(`select 1 from milestones`)).rows)).length).toBe(0);
    expect((await as(U.other, async () => (await db.query(`select 1 from milestones`)).rows)).length).toBe(0);
  });
});

describe("payment request for an accepted milestone", () => {
  it("only finance roles, only for an accepted milestone, only to the vendor's recorded address and exact amount", async () => {
    await expect(requestPay(U.proc, ms1)).rejects.toThrow(/finance role required/);
    await expect(requestPay(U.fin1, ms2)).rejects.toThrow(/must be accepted/);
    await expect(requestPay(U.fin1, ms1, "0x" + "8".repeat(40))).rejects.toThrow(/recorded payout address/);
    await expect(requestPay(U.fin1, ms1, PAYOUT, "50000000000000000000")).rejects.toThrow(/amount does not match/);
    const tx = await requestPay(U.fin1, ms1);
    expect((await rows(`select state, recipient, amount::text as amount, source from transactions where id='${tx}'`))[0]).toMatchObject({ state: "AWAITING_APPROVAL", recipient: PAYOUT, amount: "40000000000000000000", source: "SIMULATION" });
    await expect(requestPay(U.fin1, ms1)).rejects.toThrow(/already exists/);
    await expect(as(U.fin1, () => db.query(`select decide_payment('${tx}','approve')`))).rejects.toThrow(/separation of duties/);
    expect(((await as(U.fin2, () => db.query(`select decide_payment('${tx}','approve') as s`))).rows[0] as { s: string }).s).toBe("APPROVED");
  });

  it("an address change after acceptance is caught: the old address no longer matches", async () => {
    const NEW = "0x" + "7".repeat(40);
    await q(U.win, `select set_my_payout_address('${ORG}','${NEW}')`);
    expect((await rows(`select count(*)::int as c from vendor_address_history`))[0]!.c).toBe(2);
    expect((await rows(`select action from audit_events where action='vendor.payout_address_set' order by id`)).length).toBe(2);
    await db.exec(`update transactions set state='REJECTED' where evaluation->>'milestone_id'='${ms1}'`); // free the milestone for a new request
    await expect(requestPay(U.fin1, ms1, PAYOUT)).rejects.toThrow(/recorded payout address/);
    await requestPay(U.fin1, ms1, NEW);
  });

  it("direct writes to milestones stay denied", async () => {
    expect((await as(U.proc, () => db.query(`update milestones set status='released' where id='${ms1}' returning id`))).rows.length).toBe(0);
    await expect(as(U.proc, () => db.exec(`insert into milestones(organization_id,parent_type,parent_id,idx,title,amount) values ('${ORG}','procurement','${ms1}',9,'x',1)`))).rejects.toThrow(/row-level security/);
  });
});

describe("payout info helper", () => {
  it("finance and procurement roles can read it; vendors and other organisations cannot", async () => {
    const r = await as(U.fin1, async () => (await db.query(`select * from milestone_payout_info('${ms1}')`)).rows[0] as Record<string, unknown>);
    expect(r).toMatchObject({ vendor_name: "Winner Co", idx: 1 });
    await as(U.proc, async () => expect((await db.query(`select 1 from milestone_payout_info('${ms1}')`)).rows.length).toBe(1));
    for (const u of [U.win, U.lose, U.other]) await expect(q(u, `select * from milestone_payout_info('${ms1}')`)).rejects.toThrow(/not allowed/);
  });
});
