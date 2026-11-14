import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0007_governance.sql: roles, one vote each, deadlines, quorum and pass threshold. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  m1: "00000000-0000-0000-0000-0000000000d1",
  m2: "00000000-0000-0000-0000-0000000000d2",
  m3: "00000000-0000-0000-0000-0000000000d3",
  fin: "00000000-0000-0000-0000-0000000000a3",
  vendor: "00000000-0000-0000-0000-0000000000b1",
  other: "00000000-0000-0000-0000-0000000000c1",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
const ORG2 = "10000000-0000-0000-0000-00000000000b";
let db: PGlite;

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];
const q = (u: string, sql: string) => as(u, () => db.query(sql));
const create = (u: string, quorum = 1, pct = 50, org = ORG) => as(u, async () => ((await db.query(`select create_proposal('${org}','Fund a thing','Spend 500 QOR on a community event.', ${quorum}, ${pct}) as id`)).rows[0] as { id: string }).id);
const vote = (u: string, id: string, c: string) => q(u, `select cast_vote('${id}','${c}')`);
const status = async (id: string) => (await rows(`select status from governance_proposals where id='${id}'`))[0]!.status;
const finalize = (u: string, id: string) => as(u, async () => ((await db.query(`select finalize_proposal('${id}') as s`)).rows[0] as { s: string }).s);
/** Open voting, then move the deadline into the past so it can be finalised without waiting. */
async function openAndExpire(id: string) { await q(U.owner, `select open_voting('${id}', 24)`); }
const expire = (id: string) => db.exec(`update governance_proposals set voting_ends_at = now() - interval '1 minute' where id='${id}'`);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role app_user nologin; create role authenticated nologin; grant authenticated to app_user;
    grant usage on schema auth to app_user;
  `);
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql", "0006_milestones.sql", "0007_governance.sql"]) await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(`grant usage on schema public to app_user; grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user; grant execute on all functions in schema public to app_user;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}'), ('${ORG2}','Other','${U.other}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.m1}','dao_member'), ('${ORG}','${U.m2}','dao_member'), ('${ORG}','${U.m3}','dao_member'),
      ('${ORG}','${U.fin}','finance_manager'), ('${ORG}','${U.vendor}','vendor'), ('${ORG2}','${U.other}','owner');
  `);
});

describe("proposals", () => {
  it("only owners and administrators create them, with valid bounds; they are application votes", async () => {
    await expect(create(U.m1)).rejects.toThrow(/owner or administrator required/);
    await expect(create(U.fin)).rejects.toThrow(/owner or administrator required/);
    await expect(create(U.other)).rejects.toThrow(/owner or administrator required/);
    await expect(create(U.owner, 0)).rejects.toThrow(/check constraint/);
    await expect(create(U.owner, 1, 49)).rejects.toThrow(/check constraint/);
    await expect(q(U.owner, `select create_proposal('${ORG}','x','too short',1,50)`)).rejects.toThrow(/3 to 160/);
    const id = await create(U.owner);
    expect((await rows(`select kind, status from governance_proposals where id='${id}'`))[0]).toMatchObject({ kind: "application_vote", status: "discussion" });
  });

  it("direct writes are denied", async () => {
    await expect(as(U.owner, () => db.exec(`insert into governance_proposals(organization_id,title,body,created_by) values ('${ORG}','x','y',  '${U.owner}')`))).rejects.toThrow(/row-level security/);
    const id = await create(U.owner);
    expect((await as(U.owner, () => db.query(`update governance_proposals set status='passed' where id='${id}' returning id`))).rows.length).toBe(0);
    await expect(as(U.m1, () => db.exec(`insert into votes(organization_id,proposal_id,voter,choice) values ('${ORG}','${id}','${U.m1}','for')`))).rejects.toThrow(/row-level security/);
  });

  it("DAO members can read proposals; vendors and other organisations cannot", async () => {
    const id = await create(U.owner);
    await as(U.m1, async () => expect((await db.query(`select 1 from governance_proposals where id='${id}'`)).rows.length).toBe(1));
    await as(U.vendor, async () => expect((await db.query(`select 1 from governance_proposals`)).rows.length).toBe(0));
    await as(U.other, async () => expect((await db.query(`select 1 from governance_proposals`)).rows.length).toBe(0));
  });

  it("the AI analysis can be saved by admins only, while the proposal is still open", async () => {
    const id = await create(U.owner);
    await expect(q(U.m1, `select save_proposal_analysis('${id}','{"summary":"x"}'::jsonb)`)).rejects.toThrow(/owner or administrator required/);
    await q(U.owner, `select save_proposal_analysis('${id}','{"summary":"x"}'::jsonb)`);
    expect((await rows(`select analysis->>'summary' as s from governance_proposals where id='${id}'`))[0]!.s).toBe("x");
  });
});

describe("voting", () => {
  it("voting opens once, and only from discussion", async () => {
    const id = await create(U.owner);
    await expect(vote(U.m1, id, "for")).rejects.toThrow(/not open/);
    await expect(q(U.m1, `select open_voting('${id}', 24)`)).rejects.toThrow(/owner or administrator required/);
    await expect(q(U.owner, `select open_voting('${id}', 0)`)).rejects.toThrow(/1 to 720/);
    await openAndExpire(id);
    expect(await status(id)).toBe("voting");
    await expect(q(U.owner, `select open_voting('${id}', 24)`)).rejects.toThrow(/from discussion/);
  });

  it("members vote once; others cannot vote at all", async () => {
    const id = await create(U.owner);
    await openAndExpire(id);
    await vote(U.m1, id, "for");
    await expect(vote(U.m1, id, "against")).rejects.toThrow(/already voted/);
    await expect(vote(U.m2, id, "maybe")).rejects.toThrow(/for, against or abstain/);
    for (const u of [U.fin, U.vendor, U.other]) await expect(vote(u, id, "for")).rejects.toThrow(/only DAO members/);
    await vote(U.owner, id, "abstain"); // owners and administrators may vote
    expect((await rows(`select count(*)::int as c from votes where proposal_id='${id}'`))[0]!.c).toBe(2);
  });

  it("no voting after the deadline, and no finalising before it", async () => {
    const id = await create(U.owner);
    await openAndExpire(id);
    await expect(finalize(U.m1, id)).rejects.toThrow(/still open/);
    await expire(id);
    await expect(vote(U.m1, id, "for")).rejects.toThrow(/not open/);
  });
});

describe("tally", () => {
  const run = async (votes: Array<[string, string]>, quorum: number, pct: number) => {
    const id = await create(U.owner, quorum, pct);
    await openAndExpire(id);
    for (const [u, c] of votes) await vote(u, id, c);
    await expire(id);
    const s = await finalize(U.m1, id);
    return { s, result: (await rows(`select result from governance_proposals where id='${id}'`))[0]!.result as Record<string, unknown>, id };
  };

  it("passes with quorum and a majority; abstentions count for quorum but not the majority", async () => {
    const r = await run([[U.m1, "for"], [U.m2, "for"], [U.m3, "abstain"]], 3, 50);
    expect(r.s).toBe("passed");
    expect(r.result).toMatchObject({ for: 2, against: 0, abstain: 1, quorum_met: true });
  });
  it("fails without quorum even if everyone voting agrees", async () => {
    const r = await run([[U.m1, "for"]], 2, 50);
    expect(r.s).toBe("failed");
    expect(r.result).toMatchObject({ quorum_met: false });
  });
  it("a tie fails, and so does a vote of only abstentions", async () => {
    expect((await run([[U.m1, "for"], [U.m2, "against"]], 1, 50)).s).toBe("failed");
    expect((await run([[U.m1, "abstain"]], 1, 50)).s).toBe("failed");
  });
  it("a higher threshold needs a bigger majority", async () => {
    const v: Array<[string, string]> = [[U.m1, "for"], [U.m2, "for"], [U.m3, "against"]]; // 2 of 3 = 66.7%
    expect((await run(v, 1, 66)).s).toBe("passed");
    expect((await run(v, 1, 67)).s).toBe("failed");
  });
  it("is recorded in the audit log and cannot be finalised twice", async () => {
    const r = await run([[U.m1, "for"]], 1, 50);
    expect(r.s).toBe("passed");
    await expect(finalize(U.m1, r.id)).rejects.toThrow(/not in voting/);
    expect((await rows(`select action from audit_events where subject='${r.id}' order by id`)).map((x) => x.action)).toEqual([
      "governance.proposal_created", "governance.voting_opened", "governance.vote_cast", "governance.finalized",
    ]);
  });
  it("vendors and other organisations cannot finalise", async () => {
    const id = await create(U.owner);
    await openAndExpire(id);
    await expire(id);
    await expect(finalize(U.vendor, id)).rejects.toThrow(/not allowed/);
    await expect(finalize(U.other, id)).rejects.toThrow(/not allowed/);
  });
});
