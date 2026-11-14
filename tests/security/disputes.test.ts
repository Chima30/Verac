import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0008_disputes.sql on top of procurement (0004) and milestones (0006). */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  proc: "00000000-0000-0000-0000-0000000000a2",
  fin1: "00000000-0000-0000-0000-0000000000a3",
  fin2: "00000000-0000-0000-0000-0000000000a4",
  adm: "00000000-0000-0000-0000-0000000000a5",
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
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql", "0006_milestones.sql", "0007_governance.sql", "0008_disputes.sql"]) await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(`grant usage on schema public to app_user; grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user; grant execute on all functions in schema public to app_user;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}'), ('${ORG2}','Other','${U.other}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.proc}','procurement_manager'), ('${ORG}','${U.fin1}','finance_manager'), ('${ORG}','${U.fin2}','finance_manager'),
      ('${ORG}','${U.adm}','administrator'), ('${ORG}','${U.win}','vendor'), ('${ORG}','${U.lose}','vendor'), ('${ORG2}','${U.other}','owner');
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

const open = (u: string, ms: string, reason = "The delivered work does not match the agreed scope.") => as(u, async () => ((await db.query(`select open_dispute('${ms}','${reason}') as id`)).rows[0] as { id: string }).id);
const resolve_ = (u: string, id: string, outcome: string, note = "Reviewed both sides.") => q(u, `select resolve_dispute('${id}','${outcome}','${note}')`);
let d1 = "", d2 = "";

describe("opening", () => {
  it("only the awarded vendor or a procurement reviewer can open one, with a real reason", async () => {
    for (const u of [U.lose, U.fin1, U.other]) await expect(open(u, ms1)).rejects.toThrow(/not allowed|unknown/);
    await expect(open(U.win, ms1, "too short")).rejects.toThrow(/10 to 2000/);
    d1 = await open(U.win, ms1);
    expect(await status(ms1)).toBe("disputed");
    expect((await rows(`select previous_status, status from disputes where id='${d1}'`))[0]).toMatchObject({ previous_status: "pending", status: "open" });
  });
  it("a milestone already in dispute cannot be disputed again", async () => {
    await expect(open(U.win, ms1)).rejects.toThrow(/disputed milestone cannot be disputed/);
  });
  it("direct writes are denied", async () => {
    await expect(as(U.win, () => db.exec(`insert into disputes(organization_id,milestone_id,opened_by) values ('${ORG}','${ms2}','${U.win}')`))).rejects.toThrow(/row-level security/);
    expect((await as(U.owner, () => db.query(`update disputes set status='resolved' where id='${d1}' returning id`))).rows.length).toBe(0);
    await expect(as(U.win, () => db.exec(`insert into dispute_notes(organization_id,dispute_id,author,author_role,body) values ('${ORG}','${d1}','${U.win}','x','y')`))).rejects.toThrow(/row-level security/);
  });
});

describe("statements and visibility", () => {
  it("the opener and reviewers can add statements; nobody else can", async () => {
    await q(U.win, `select add_dispute_note('${d1}','We delivered the design on the agreed date.')`);
    await q(U.proc, `select add_dispute_note('${d1}','The design misses two requirements.')`);
    for (const u of [U.lose, U.fin1, U.other]) await expect(q(u, `select add_dispute_note('${d1}','hello')`)).rejects.toThrow(/not allowed/);
    await expect(q(U.win, `select add_dispute_note('${d1}','')`)).rejects.toThrow(/1 to 2000/);
    expect((await rows(`select count(*)::int as c from dispute_notes where dispute_id='${d1}'`))[0]!.c).toBe(3);
  });
  it("the opener and internal members can read; other vendors and organisations cannot", async () => {
    for (const u of [U.win, U.proc, U.owner]) await as(u, async () => expect((await db.query(`select 1 from dispute_notes where dispute_id='${d1}'`)).rows.length).toBe(3));
    for (const u of [U.lose, U.other]) await as(u, async () => { expect((await db.query(`select 1 from disputes`)).rows.length).toBe(0); expect((await db.query(`select 1 from dispute_notes`)).rows.length).toBe(0); });
  });
  it("only owners and administrators save the AI summary", async () => {
    await expect(q(U.proc, `select save_dispute_summary('${d1}','{"summary":"x"}'::jsonb)`)).rejects.toThrow(/owner or administrator required/);
    await q(U.adm, `select save_dispute_summary('${d1}','{"summary":"x"}'::jsonb)`);
  });
});

describe("resolution", () => {
  it("the vendor, reviewers and finance cannot resolve", async () => {
    for (const u of [U.win, U.proc, U.fin1, U.lose, U.other]) await expect(resolve_(u, d1, "reject_work")).rejects.toThrow(/owner or administrator required/);
  });
  it("needs a valid outcome and a reason", async () => {
    await expect(resolve_(U.adm, d1, "pay_everything")).rejects.toThrow(/outcome must be/);
    await expect(resolve_(U.adm, d1, "reject_work", "no")).rejects.toThrow(/short reason/);
  });
  it("rejecting the work sends the milestone back to waiting for new evidence, and the vendor can resubmit", async () => {
    await resolve_(U.adm, d1, "reject_work");
    expect(await status(ms1)).toBe("pending");
    expect((await rows(`select status, resolution->>'outcome' as o, resolution->>'on_chain' as oc from disputes where id='${d1}'`))[0]).toMatchObject({ status: "resolved", o: "reject_work", oc: "false" });
    await expect(resolve_(U.adm, d1, "accept_work")).rejects.toThrow(/already resolved/);
    await expect(q(U.win, `select add_dispute_note('${d1}','more')`)).rejects.toThrow(/resolved/);
    await evidence(U.win, ms1);
    expect(await status(ms1)).toBe("evidence_submitted");
  });
  it("accepting the work makes the milestone accepted, and an opener cannot resolve their own dispute", async () => {
    d2 = await open(U.owner, ms2);
    expect(await status(ms2)).toBe("disputed");
    await expect(resolve_(U.owner, d2, "accept_work")).rejects.toThrow(/someone else must resolve/);
    await resolve_(U.adm, d2, "accept_work");
    expect(await status(ms2)).toBe("approved");
  });
  it("an evidence-submitted milestone can be disputed and keeps its previous status", async () => {
    // ms1 is evidence_submitted now
    const d = await open(U.proc, ms1, "Evidence links do not open and the vendor is not responding.");
    expect((await rows(`select previous_status from disputes where id='${d}'`))[0]!.previous_status).toBe("evidence_submitted");
  });
  it("is fully recorded in the audit log", async () => {
    const a = (await rows(`select action from audit_events where subject='${d1}' order by id`)).map((x) => x.action);
    expect(a).toEqual(["dispute.opened", "dispute.note_added", "dispute.note_added", "dispute.summary_saved", "dispute.resolved"]);
  });
});
