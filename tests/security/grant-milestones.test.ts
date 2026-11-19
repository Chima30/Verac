import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0021_grant_milestones.sql: evidence, review, funding records, release only on chain confirmation. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  adm: "00000000-0000-0000-0000-0000000000a5",
  adm2: "00000000-0000-0000-0000-0000000000a6",
  fin: "00000000-0000-0000-0000-0000000000a3",
  a1: "00000000-0000-0000-0000-0000000000e1",
  a2: "00000000-0000-0000-0000-0000000000e2",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
const QOR = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
let db: PGlite;
let APP: string, MS1: string, MS2: string;

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
async function asServer<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role service_role;`);
  try { return await fn(); } finally { await db.exec(`reset role;`); }
}
const q = (u: string, sql: string, p: unknown[] = []) => as(u, () => db.query(sql, p));
const one = async (u: string, sql: string, p: unknown[] = []) => ((await q(u, sql, p)).rows[0] as { v: unknown }).v;
const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as Record<string, unknown>[];
const evidence = (u: string, ms: string, desc = "Indexer deployed against Diana; endpoints documented.", links: unknown[] = ["https://github.com/alpha-labs/indexer/releases/tag/v0.1.0"], txs: unknown[] = []) =>
  q(u, `select submit_grant_milestone_evidence($1,$2,$3::jsonb,$4::jsonb)`, [ms, desc, JSON.stringify(links), JSON.stringify(txs)]);

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
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql", "0006_milestones.sql", "0007_governance.sql", "0008_disputes.sql", "0009_grants.sql", "0014_live_execution.sql", "0015_live_decision_guard.sql", "0016_agent_workflows.sql", "0019_grants_portal.sql", "0020_grant_reviews.sql", "0021_grant_milestones.sql"])
    await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0021_grant_milestones.sql"), "utf8")); // re-runnable
  await db.exec(`grant usage on schema public to authenticated, service_role; grant all on all tables in schema public to authenticated, service_role; grant all on all sequences in schema public to authenticated, service_role;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.adm}','administrator'), ('${ORG}','${U.adm2}','administrator'), ('${ORG}','${U.fin}','finance_manager'),
      ('${ORG}','${U.a1}','grant_applicant'), ('${ORG}','${U.a2}','grant_applicant');
  `);
  const g = await one(U.owner, `select create_grant_round('${ORG}','Round',${QOR(20000)},'d','r',array['software'],now() + interval '30 days',null,null) as v`);
  const content = {
    overview: "An open-source indexer for grant programmes.", problem: "Grant managers cannot see delivery evidence in one place.", solution: "Index milestone transactions and expose an API.",
    team: "Two engineers.", technical: "TypeScript service with CI.", metrics: "Three programmes using it.", links: {}, contracts: [], transactions: [],
    budget: [{ item: "Engineering", amount: QOR(4000) }],
    milestones: [{ title: "MVP", deliverable: "Indexer running against Diana.", verification: "Public endpoint.", due: future(30), amount: QOR(2000) }, { title: "API", deliverable: "API v1 released with docs.", verification: "Release tag.", due: future(60), amount: QOR(2000) }],
    declarations: { accurate: true, rights: true, conflicts_disclosed: true },
  };
  APP = (await one(U.a1, `select save_grant_application($1,'Alpha','software',$2,$3,$4::jsonb) as v`, [g, QOR(4000), "0x" + "4".repeat(40), JSON.stringify(content)])) as string;
  await q(U.a1, `select submit_grant_application($1,null)`, [APP]);
  await q(U.adm, `select decide_application($1,'recommend','Strong and complete')`, [APP]);
  await q(U.owner, `select award_application($1,$2::jsonb)`, [APP, JSON.stringify([{ title: "MVP", amount: QOR(2000) }, { title: "API", amount: QOR(2000) }])]);
  const ms = await rows(`select id from milestones where parent_type = 'grant' and parent_id = $1 order by idx`, [APP]);
  MS1 = ms[0]!.id as string; MS2 = ms[1]!.id as string;
});

describe("milestone evidence", () => {
  it("only the recipient submits, in order, with valid links", async () => {
    await expect(evidence(U.a2, MS1)).rejects.toThrow(/only the grant recipient/);
    await expect(evidence(U.a1, MS2)).rejects.toThrow(/milestone 1 must be approved first/);
    await expect(evidence(U.a1, MS1, "too short")).rejects.toThrow(/20 to 6000/);
    await expect(evidence(U.a1, MS1, undefined, ["http://insecure.example"])).rejects.toThrow(/https/);
    expect(await one(U.a1, `select submit_grant_milestone_evidence($1,$2,'[]'::jsonb,'[]'::jsonb) as v`, [MS1, "Indexer deployed against Diana with documented endpoints."])).toBe(1);
    expect((await rows(`select status from milestones where id = $1`, [MS1]))[0]!.status).toBe("evidence_submitted");
  });
});

describe("milestone decisions", () => {
  it("needs an administrator without a conflict and a reason; rejection sends it back for a new attempt", async () => {
    await expect(q(U.fin, `select decide_grant_milestone($1,'approve','Looks done')`, [MS1])).rejects.toThrow(/owner or administrator/);
    await q(U.adm2, `select declare_grant_conflict($1,'Former colleague of the team')`, [APP]);
    await expect(q(U.adm2, `select decide_grant_milestone($1,'approve','Looks done')`, [MS1])).rejects.toThrow(/conflict of interest/);
    await expect(q(U.adm, `select decide_grant_milestone($1,'approve','')`, [MS1])).rejects.toThrow(/reason/);
    expect(await one(U.adm, `select decide_grant_milestone($1,'reject','The endpoint link is missing') as v`, [MS1])).toBe("pending");
    expect(await one(U.a1, `select submit_grant_milestone_evidence($1,$2,$3::jsonb,'[]'::jsonb) as v`, [MS1, "Indexer deployed; endpoint and release linked below.", JSON.stringify(["https://alpha.example.org/api"])])).toBe(2);
    expect(await one(U.adm, `select decide_grant_milestone($1,'approve','Endpoint responds and the release exists') as v`, [MS1])).toBe("approved");
  });
});

describe("funding", () => {
  it("records are written only by the server, for approved milestones, once", async () => {
    await expect(q(U.adm, `select record_grant_funding($1,'requested','treasury_v2','[]'::jsonb,null,$2)`, [MS1, U.adm])).rejects.toThrow(/permission denied/);
    await expect(asServer(() => db.query(`select record_grant_funding($1,'awaiting_authorised_path','none','["over cap"]'::jsonb,null,$2)`, [MS2, U.adm]))).rejects.toThrow(/approved milestone/);
    await asServer(() => db.query(`select record_grant_funding($1,'awaiting_authorised_path','none','["2,000 QOR is above the agent''s 1 QOR per-payment cap; it is not split"]'::jsonb,null,$2)`, [MS1, U.adm]));
    expect((await rows(`select status, route from grant_funding_records where milestone_id = $1`, [MS1]))[0]).toMatchObject({ status: "awaiting_authorised_path", route: "none" });
  });
  it("marks the milestone released only when the linked payment is confirmed on chain", async () => {
    await db.exec(`insert into transactions(id, organization_id, idempotency_key, agent_id, state, payment_hash, token, recipient, amount, policy_version, expires_at, source)
      values ('20000000-0000-0000-0000-000000000001', '${ORG}', 'grant-ms-1', 'PaymentAgent', 'AWAITING_APPROVAL', '0x${"ab".repeat(32)}', '0x${"0".repeat(40)}', '0x${"4".repeat(40)}', ${QOR(2000)}, 1, now() + interval '1 hour', 'LIVE_TESTNET')`);
    await asServer(() => db.query(`select record_grant_funding($1,'requested','treasury_v2','[]'::jsonb,'20000000-0000-0000-0000-000000000001',$2)`, [MS1, U.adm]));
    await expect(asServer(() => db.query(`select record_grant_funding($1,'requested','treasury_v2','[]'::jsonb,null,$2)`, [MS1, U.adm]))).rejects.toThrow(/already requested or confirmed/);
    await db.exec(`update transactions set state = 'APPROVED' where id = '20000000-0000-0000-0000-000000000001'`);
    expect((await rows(`select status from milestones where id = $1`, [MS1]))[0]!.status).toBe("approved");
    await db.exec(`update transactions set state = 'CONFIRMED', tx_hash = '0x${"cd".repeat(32)}', block_number = 123 where id = '20000000-0000-0000-0000-000000000001'`);
    expect((await rows(`select status, release_tx_hash from milestones where id = $1`, [MS1]))[0]).toMatchObject({ status: "released", release_tx_hash: "0x" + "cd".repeat(32) });
    expect((await rows(`select status, tx_hash, block_number from grant_funding_records where transaction_id = '20000000-0000-0000-0000-000000000001'`))[0]).toMatchObject({ status: "confirmed", block_number: 123 });
  });
  it("the recipient sees their funding records but not another applicant's", async () => {
    expect((await as(U.a1, () => db.query(`select id from grant_funding_records`))).rows.length).toBeGreaterThan(0);
    expect((await as(U.a2, () => db.query(`select id from grant_funding_records`))).rows.length).toBe(0);
  });
});
