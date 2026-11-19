import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0020_grant_reviews.sql on top of 0009 and 0019. */

const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  adm: "00000000-0000-0000-0000-0000000000a5",
  adm2: "00000000-0000-0000-0000-0000000000a6",
  sec: "00000000-0000-0000-0000-0000000000a7",
  a1: "00000000-0000-0000-0000-0000000000e1",
  a2: "00000000-0000-0000-0000-0000000000e2",
};
const ORG = "10000000-0000-0000-0000-00000000000a";
const QOR = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
let db: PGlite;

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

function content(amount: number) {
  return {
    overview: "An open-source indexer for QoreChain grant programmes.", problem: "Grant managers cannot see delivery evidence in one place.",
    solution: "Index milestone transactions and expose them via an API.", team: "Two engineers.", technical: "TypeScript service, CI on every commit.",
    metrics: "Three programmes using it.", links: {}, contracts: [], transactions: [],
    budget: [{ item: "Engineering", amount: QOR(amount) }],
    milestones: [{ title: "MVP", deliverable: "Indexer running against Diana.", verification: "Public endpoint.", due: future(30), amount: QOR(amount) }],
    declarations: { accurate: true, rights: true, conflicts_disclosed: true },
  };
}

let G: string;
async function submitted(user: string, amount: number): Promise<string> {
  const a = (await one(user, `select save_grant_application($1,'Project',$2,$3,$4,$5::jsonb) as v`, [G, "software", QOR(amount), "0x" + "4".repeat(40), JSON.stringify(content(amount))])) as string;
  await q(user, `select submit_grant_application($1,null)`, [a]);
  return a;
}
async function serverReview(app: string): Promise<string> {
  const rubric = (await rows(`select id, version from grant_rubrics where grant_id = $1 order by version desc limit 1`, [G]))[0]!;
  return asServer(async () => ((await db.query(
    `insert into grant_reviews(organization_id, application_id, application_version, rubric_id, rubric_version, scores, scored_points, scored_max, applicable_max, recommendation, report)
     values ($1,$2,1,$3,$4,$5::jsonb,30,40,100,'further_review','{}'::jsonb) returning id`,
    [ORG, app, rubric.id, rubric.version, JSON.stringify([{ key: "relevance", label: "Relevance", max: 20, score: 15, state: "scored" }, { key: "budget", label: "Budget", max: 10, score: null, state: "missing" }])],
  )).rows[0] as { id: string }).id);
}

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
  for (const f of ["0001_core.sql", "0002_creator_membership.sql", "0003_approvals.sql", "0004_procurement.sql", "0005_payroll.sql", "0006_milestones.sql", "0007_governance.sql", "0008_disputes.sql", "0009_grants.sql", "0016_agent_workflows.sql", "0019_grants_portal.sql", "0020_grant_reviews.sql"])
    await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0020_grant_reviews.sql"), "utf8")); // re-runnable
  await db.exec(`grant usage on schema public to authenticated, service_role; grant all on all tables in schema public to authenticated, service_role; grant all on all sequences in schema public to authenticated, service_role;`);
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG}','Nova DAO','${U.owner}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG}','${U.owner}','owner'), ('${ORG}','${U.adm}','administrator'), ('${ORG}','${U.adm2}','administrator'), ('${ORG}','${U.sec}','security_reviewer'),
      ('${ORG}','${U.a1}','grant_applicant'), ('${ORG}','${U.a2}','grant_applicant');
  `);
  G = (await one(U.owner, `select create_grant_round('${ORG}','Web3 Developer Grants',${QOR(20000)},'d','r',array['software','research'],now() + interval '30 days',null,null) as v`)) as string;
});

describe("evidence, reports and flags", () => {
  it("only the server writes them; applicants cannot read them; reviewers can", async () => {
    const app = await submitted(U.a1, 4000);
    await expect(q(U.adm, `insert into grant_evidence(organization_id,application_id,application_version,source,subject,claim,status,reason,url,retrieved_at) values ($1,$2,1,'web','x','c','VERIFIED','r','https://x',now())`, [ORG, app])).rejects.toThrow(/row-level security|permission/);
    await asServer(() => db.query(`insert into grant_evidence(organization_id,application_id,application_version,source,subject,claim,status,reason,url,retrieved_at) values ($1,$2,1,'github','https://github.com/a/b','exists','UNAVAILABLE','404 or private','https://api.github.com/repos/a/b',now())`, [ORG, app]));
    await asServer(() => db.query(`insert into grant_risk_flags(organization_id,application_id,code,severity,message) values ($1,$2,'SIMILAR_TEXT','medium','Similar to another application')`, [ORG, app]));
    expect((await as(U.a1, () => db.query(`select * from grant_evidence`))).rows.length).toBe(0);
    expect((await as(U.a1, () => db.query(`select * from grant_risk_flags`))).rows.length).toBe(0);
    expect((await as(U.sec, () => db.query(`select * from grant_evidence where application_id = $1`, [app]))).rows.length).toBe(1);
    await expect(asServer(() => db.query(`insert into grant_evidence(organization_id,application_id,application_version,source,subject,claim,status,reason,url,retrieved_at) values ($1,$2,1,'web','x','c','PROBABLY_FINE','r','https://x',now())`, [ORG, app]))).rejects.toThrow(/check/);
  });
  it("reports are append-only and the first one locks the rubric", async () => {
    const app = await submitted(U.a2, 3000);
    expect((await rows(`select locked_at from grant_rubrics where grant_id = $1`, [G]))[0]!.locked_at).toBeNull();
    const r = await serverReview(app);
    expect((await rows(`select locked_at from grant_rubrics where grant_id = $1`, [G]))[0]!.locked_at).not.toBeNull();
    await expect(asServer(() => db.query(`update grant_reviews set recommendation = 'strong_candidate' where id = $1`, [r]))).rejects.toThrow(/append-only/);
    await expect(q(U.adm, `select set_grant_rubric($1,$2::jsonb,null)`, [G, JSON.stringify([{ key: "relevance", label: "Relevance", max: 100 }])])).rejects.toThrow(/give a reason/);
  });
  it("a reviewer dismisses or confirms a flag only with a reason", async () => {
    const f = (await rows(`select id from grant_risk_flags limit 1`))[0]!.id as string;
    await expect(q(U.adm, `select decide_grant_flag($1,'dismissed','')`, [f])).rejects.toThrow(/reason/);
    await expect(q(U.a1, `select decide_grant_flag($1,'dismissed','not fraud')`, [f])).rejects.toThrow(/not allowed/);
    await q(U.sec, `select decide_grant_flag($1,'dismissed','Both projects legitimately reuse the same open-source template')`, [f]);
    expect((await rows(`select status, decided_by from grant_risk_flags where id = $1`, [f]))[0]).toMatchObject({ status: "dismissed", decided_by: U.sec });
  });
});

describe("clarification requests", () => {
  it("the AI drafts, a reviewer edits and sends, the applicant sees it, answers, amends and resubmits", async () => {
    const app = (await rows(`select id from grant_applications where applicant_user_id = $1 and grant_id = $2`, [U.a1, G]))[0]!.id as string;
    const c = (await asServer(async () => (await db.query(`insert into grant_clarifications(organization_id,application_id,questions,drafted_by) values ($1,$2,'[{"question":"Please break down the engineering budget line.","about":"budget"}]'::jsonb,'GrantCoordinator') returning id`, [ORG, app])).rows[0] as { id: string })).id;
    expect((await as(U.a1, () => db.query(`select * from grant_clarifications where id = $1`, [c]))).rows.length).toBe(0); // drafts are not visible to applicants
    await expect(q(U.sec, `select send_grant_clarification($1,$2::jsonb)`, [c, "[]"])).rejects.toThrow(/owner or administrator/);
    await expect(q(U.adm, `select send_grant_clarification($1,$2::jsonb)`, [c, JSON.stringify([{ question: "short" }])])).rejects.toThrow(/10 to 600/);
    await q(U.adm, `select send_grant_clarification($1,$2::jsonb)`, [c, JSON.stringify([{ question: "Your budget has one line for 4,000 QOR of engineering. Please break it down by role and weeks.", about: "budget" }])]);
    expect((await rows(`select status, amendment_open from grant_applications where id = $1`, [app]))[0]).toMatchObject({ status: "clarification_requested", amendment_open: true });
    expect((await as(U.a1, () => db.query(`select questions from grant_clarifications where id = $1`, [c]))).rows.length).toBe(1);
    await expect(q(U.a2, `select answer_grant_clarification($1,'not mine')`, [c])).rejects.toThrow(/only the applicant/);
    await q(U.a1, `select answer_grant_clarification($1,'Two engineers for eight weeks at 250 QOR per engineer-week.')`, [c]);
    const amended = content(4000);
    amended.budget = [{ item: "Engineer A, 8 weeks at 250 QOR", amount: QOR(2000) }, { item: "Engineer B, 8 weeks at 250 QOR", amount: QOR(2000) }];
    await q(U.a1, `select save_grant_application($1,'Project','software',$2,$3,$4::jsonb)`, [G, QOR(4000), "0x" + "4".repeat(40), JSON.stringify(amended)]);
    expect(await one(U.a1, `select submit_grant_application($1,'Split the engineering budget by person') as v`, [app])).toBe(2);
    expect((await rows(`select status from grant_applications where id = $1`, [app]))[0]!.status).toBe("under_review");
    expect((await rows(`select status, response from grant_clarifications where id = $1`, [c]))[0]).toMatchObject({ status: "answered" });
  });
});

describe("conflicts, overrides and decisions", () => {
  it("a declared conflict blocks recommending, overriding and flag decisions for that person only", async () => {
    const app = (await rows(`select id from grant_applications where applicant_user_id = $1 and grant_id = $2`, [U.a1, G]))[0]!.id as string;
    const review = await serverReview(app);
    await q(U.adm, `select declare_grant_conflict($1,'I advised this team last year')`, [app]);
    await expect(q(U.adm, `select decide_application($1,'recommend','Looks solid')`, [app])).rejects.toThrow(/conflict of interest/);
    await expect(q(U.adm, `select override_grant_score($1,'relevance',18,'Reviewed the roadmap in detail')`, [review])).rejects.toThrow(/conflict of interest/);
    await expect(q(U.adm2, `select override_grant_score($1,'relevance',25,'Too high for the maximum')`, [review])).rejects.toThrow(/between 0 and 20/);
    await expect(q(U.adm2, `select override_grant_score($1,'relevance',18,'short')`, [review])).rejects.toThrow(/at least 10/);
    await q(U.adm2, `select override_grant_score($1,'relevance',18,'Roadmap is more specific than the AI read suggests')`, [review]);
    expect(await one(U.adm2, `select decide_application($1,'recommend','Strong, budget now explained') as v`, [app])).toBe("recommended");
  });
  it("the recommender cannot award; a conflicted administrator cannot award; awards stay within the budget", async () => {
    const app = (await rows(`select id from grant_applications where applicant_user_id = $1 and grant_id = $2`, [U.a1, G]))[0]!.id as string;
    const ms = JSON.stringify([{ title: "Engineer A", amount: QOR(2000) }, { title: "Engineer B", amount: QOR(2000) }]);
    await expect(q(U.adm2, `select award_application($1,$2::jsonb)`, [app, ms])).rejects.toThrow(/different administrator/);
    await expect(q(U.adm, `select award_application($1,$2::jsonb)`, [app, ms])).rejects.toThrow(/conflict of interest/);
    expect(await one(U.owner, `select award_application($1,$2::jsonb) as v`, [app, ms])).toBe(2);
    // A second award that would pass the 20,000 QOR budget is refused in the same transaction.
    const big = await submitted(U.a2, 3000).catch(async () => (await rows(`select id from grant_applications where applicant_user_id = $1 and grant_id = $2`, [U.a2, G]))[0]!.id as string);
    await db.exec(`update grants set budget = ${QOR(5000)} where id = '${G}'`);
    await q(U.adm, `select decide_application($1,'recommend','Reasonable request')`, [big]).catch(() => undefined);
    await expect(q(U.owner, `select award_application($1,$2::jsonb)`, [big, JSON.stringify([{ title: "MVP", amount: QOR(3000) }])])).rejects.toThrow(/pass the round budget/);
  });
});

describe("the grant-review workflow", () => {
  it("is started by administrators, idempotent, and claimed only by the server", async () => {
    const k = "grant-wf-key-0001";
    const t1 = await one(U.adm, `select start_grant_workflow($1,$2,'Review all applications in the current round',$3) as v`, [ORG, G, k]);
    expect(await one(U.adm, `select start_grant_workflow($1,$2,'Review all applications in the current round',$3) as v`, [ORG, G, k])).toBe(t1);
    await expect(q(U.a1, `select start_grant_workflow($1,$2,'Review',$3)`, [ORG, G, "grant-wf-key-0002"])).rejects.toThrow(/owner or administrator/);
    await expect(q(U.adm, `select claim_grant_workflow($1,30)`, [t1])).rejects.toThrow(/permission denied/);
    const claimed = await asServer(() => db.query(`select id, state from claim_grant_workflow($1,30)`, [t1]));
    expect(claimed.rows[0]).toMatchObject({ id: t1, state: "RUNNING" });
    expect((await asServer(() => db.query(`select id from claim_grant_workflow($1,30)`, [t1]))).rows[0]).toMatchObject({ id: null }); // lease held
  });
});
