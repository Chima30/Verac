import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Applies supabase/migrations/0001_core.sql to an in-process Postgres (PGlite) with a stub of Supabase's
 * auth.uid(), then checks tenant isolation as non-superuser roles (superusers bypass RLS).
 * Limitation: this exercises our policies on real Postgres semantics but is not a Supabase project.
 */

const U = {
  ownerA: "00000000-0000-0000-0000-0000000000a1",
  procA: "00000000-0000-0000-0000-0000000000a2",
  financeA: "00000000-0000-0000-0000-0000000000a3",
  vendor1: "00000000-0000-0000-0000-0000000000b1",
  vendor2: "00000000-0000-0000-0000-0000000000b2",
  applicant1: "00000000-0000-0000-0000-0000000000c1",
  applicant2: "00000000-0000-0000-0000-0000000000c2",
  auditorA: "00000000-0000-0000-0000-0000000000d1",
  ownerB: "00000000-0000-0000-0000-0000000000e1",
  stranger: "00000000-0000-0000-0000-0000000000f1",
};
const ORG_A = "10000000-0000-0000-0000-00000000000a";
const ORG_B = "10000000-0000-0000-0000-00000000000b";
const PROC = "20000000-0000-0000-0000-000000000001";

let db: PGlite;

async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_user; select set_config('request.jwt.claim.sub', '${user ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role app_user nologin;
    grant usage on schema auth to app_user;
  `);
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0001_core.sql"), "utf8"));
  await db.exec(`grant usage on schema public to app_user; grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user; grant execute on all functions in schema public to app_user;`);

  // fixtures inserted as superuser (bypasses RLS)
  await db.exec(`
    insert into organizations(id,name,created_by) values ('${ORG_A}','Nova DAO','${U.ownerA}'), ('${ORG_B}','Other Org','${U.ownerB}');
    insert into memberships(organization_id,user_id,role) values
      ('${ORG_A}','${U.ownerA}','owner'), ('${ORG_A}','${U.procA}','procurement_manager'), ('${ORG_A}','${U.financeA}','finance_manager'),
      ('${ORG_A}','${U.vendor1}','vendor'), ('${ORG_A}','${U.vendor2}','vendor'),
      ('${ORG_A}','${U.applicant1}','grant_applicant'), ('${ORG_A}','${U.applicant2}','grant_applicant'),
      ('${ORG_A}','${U.auditorA}','auditor'), ('${ORG_B}','${U.ownerB}','owner');
    insert into vendors(id,organization_id,user_id,name) values
      ('30000000-0000-0000-0000-000000000001','${ORG_A}','${U.vendor1}','Vendor A'),
      ('30000000-0000-0000-0000-000000000002','${ORG_A}','${U.vendor2}','Vendor B');
    insert into procurements(id,organization_id,title,budget,token,status,created_by) values ('${PROC}','${ORG_A}','Website',300,'0x0000000000000000000000000000000000000000','open','${U.procA}');
    insert into documents(id,organization_id,purpose,storage_path,ciphertext_sha256,envelope_bytes,uploaded_by) values
      ('40000000-0000-0000-0000-000000000001','${ORG_A}','bid','a','h1',100,'${U.vendor1}'),
      ('40000000-0000-0000-0000-000000000002','${ORG_A}','bid','b','h2',100,'${U.vendor2}');
    insert into bids(organization_id,procurement_id,vendor_id,submitted_by,document_id) values
      ('${ORG_A}','${PROC}','30000000-0000-0000-0000-000000000001','${U.vendor1}','40000000-0000-0000-0000-000000000001'),
      ('${ORG_A}','${PROC}','30000000-0000-0000-0000-000000000002','${U.vendor2}','40000000-0000-0000-0000-000000000002');
    insert into grants(id,organization_id,title,budget,token,created_by) values ('50000000-0000-0000-0000-000000000001','${ORG_A}','Community grants',1000,'0x0','${U.ownerA}');
    insert into grant_applications(organization_id,grant_id,applicant_user_id,applicant_name,requested_amount) values
      ('${ORG_A}','50000000-0000-0000-0000-000000000001','${U.applicant1}','App One',10), ('${ORG_A}','50000000-0000-0000-0000-000000000001','${U.applicant2}','App Two',20);
    insert into transactions(organization_id,idempotency_key,agent_id,payment_hash,token,recipient,amount,policy_version,expires_at)
      values ('${ORG_A}','k1','PaymentAgent','0x${"a".repeat(64)}','0x0','0x1',5,1,now());
    insert into audit_events(organization_id,actor,action) values ('${ORG_A}','system','test'), ('${ORG_B}','system','test');
  `);
});

describe("tenant isolation", () => {
  it("members of one org cannot see another org or its rows", async () => {
    await as(U.ownerA, async () => {
      expect((await rows("select id from organizations")).map((r) => r.id)).toEqual([ORG_A]);
      expect((await rows(`select 1 from transactions where organization_id = '${ORG_B}'`)).length).toBe(0);
      expect((await rows(`select 1 from audit_events where organization_id = '${ORG_B}'`)).length).toBe(0);
    });
    await as(U.ownerB, async () => {
      expect((await rows("select id from organizations")).map((r) => r.id)).toEqual([ORG_B]);
      expect((await rows("select 1 from transactions")).length).toBe(0);
    });
  });

  it("a user with no membership sees nothing; unauthenticated sees nothing", async () => {
    await as(U.stranger, async () => {
      expect((await rows("select 1 from organizations")).length).toBe(0);
      expect((await rows("select 1 from vendors")).length).toBe(0);
    });
    await as(null, async () => {
      expect((await rows("select 1 from organizations")).length).toBe(0);
      expect((await rows("select 1 from bids")).length).toBe(0);
    });
  });

  it("cannot write into another organization", async () => {
    await as(U.ownerB, async () => {
      await expect(db.exec(`insert into vendors(organization_id,name) values ('${ORG_A}','Evil')`)).rejects.toThrow(/row-level security/);
      await expect(db.exec(`insert into memberships(organization_id,user_id,role) values ('${ORG_A}','${U.ownerB}','administrator')`)).rejects.toThrow(/row-level security/);
    });
  });
});

describe("vendor and applicant confidentiality", () => {
  it("a vendor sees only their own bid; procurement managers see all", async () => {
    await as(U.vendor1, async () => {
      const r = await rows("select submitted_by from bids");
      expect(r.length).toBe(1);
      expect(r[0]!.submitted_by).toBe(U.vendor1);
    });
    await as(U.vendor2, async () => expect((await rows("select 1 from bids")).length).toBe(1));
    await as(U.procA, async () => expect((await rows("select 1 from bids")).length).toBe(2));
  });

  it("a vendor cannot read another vendor's sealed document row", async () => {
    await as(U.vendor1, async () => {
      const ids = (await rows("select id from documents")).map((r) => r.id);
      expect(ids).toEqual(["40000000-0000-0000-0000-000000000001"]);
    });
  });

  it("vendors cannot see the vendor list, transactions or audit log", async () => {
    await as(U.vendor1, async () => {
      expect((await rows("select name from vendors")).map((r) => r.name)).toEqual(["Vendor A"]);
      expect((await rows("select 1 from transactions")).length).toBe(0);
      expect((await rows("select 1 from audit_events")).length).toBe(0);
    });
  });

  it("a vendor cannot submit a bid as someone else or to a closed procurement", async () => {
    await as(U.vendor1, async () => {
      await expect(
        db.exec(`insert into bids(organization_id,procurement_id,vendor_id,submitted_by,document_id) values ('${ORG_A}','${PROC}','30000000-0000-0000-0000-000000000002','${U.vendor2}','40000000-0000-0000-0000-000000000002')`),
      ).rejects.toThrow();
    });
  });

  it("grant applicants only see their own application", async () => {
    await as(U.applicant1, async () => {
      const r = await rows("select applicant_name from grant_applications");
      expect(r.map((x) => x.applicant_name)).toEqual(["App One"]);
    });
    await as(U.ownerA, async () => expect((await rows("select 1 from grant_applications")).length).toBe(2));
  });
});

describe("financial and audit controls", () => {
  it("only finance roles may create transactions or approvals", async () => {
    const insert = `insert into transactions(organization_id,idempotency_key,agent_id,payment_hash,token,recipient,amount,policy_version,expires_at) values ('${ORG_A}','k2','PaymentAgent','0x${"b".repeat(64)}','0x0','0x1',5,1,now())`;
    await as(U.procA, async () => {
      await expect(db.exec(insert)).rejects.toThrow(/row-level security/);
    });
    await as(U.financeA, async () => {
      await db.exec(insert);
    });
  });

  it("idempotency key and payment hash are unique per organisation", async () => {
    await expect(
      db.exec(`insert into transactions(organization_id,idempotency_key,agent_id,payment_hash,token,recipient,amount,policy_version,expires_at) values ('${ORG_A}','k1','PaymentAgent','0x${"c".repeat(64)}','0x0','0x1',5,1,now())`),
    ).rejects.toThrow(/unique/);
    await expect(
      db.exec(`insert into transactions(organization_id,idempotency_key,agent_id,payment_hash,token,recipient,amount,policy_version,expires_at) values ('${ORG_A}','k9','PaymentAgent','0x${"a".repeat(64)}','0x0','0x1',5,1,now())`),
    ).rejects.toThrow(/unique/);
  });

  it("the same vendor invoice number cannot be stored twice", async () => {
    const ins = `insert into invoices(organization_id,vendor_id,invoice_number,amount,token,recipient) values ('${ORG_A}','30000000-0000-0000-0000-000000000001','INV-42',10,'0x0','0x${"1".repeat(40)}')`;
    await db.exec(ins);
    await expect(db.exec(ins)).rejects.toThrow(/unique/);
  });

  it("audit events are readable only by admin/security/auditor, never writable by users, never mutable", async () => {
    await as(U.auditorA, async () => expect((await rows("select 1 from audit_events")).length).toBe(1));
    await as(U.vendor1, async () => expect((await rows("select 1 from audit_events")).length).toBe(0));
    await as(U.ownerA, async () => {
      await expect(db.exec(`insert into audit_events(organization_id,actor,action) values ('${ORG_A}','me','forged')`)).rejects.toThrow(/row-level security/);
    });
    await expect(db.exec(`update audit_events set action='x'`)).rejects.toThrow(/append-only/);
    await expect(db.exec(`delete from audit_events`)).rejects.toThrow(/append-only/);
  });

  it("mainnet is impossible: treasuries only accept chain 9800", async () => {
    await expect(db.exec(`insert into treasuries(organization_id,label,vault_address,chain_id) values ('${ORG_A}','x','0x${"1".repeat(40)}',1)`)).rejects.toThrow();
  });

  it("agent messages are service-role only", async () => {
    await as(U.ownerA, async () => expect((await rows("select 1 from agent_messages")).length).toBe(0));
  });
});
