import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** Exercises supabase/migrations/0022_rate_limits.sql: shared counters, only the server may use them. */
let db: PGlite;
const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/0022_rate_limits.sql"), "utf8");

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;`);
  await db.exec(sql);
  await db.exec(sql); // re-runnable
});

const take = async (key: string, win = 60, max = 3) =>
  (await db.query<{ allowed: boolean; hits: number; retry_after_seconds: number }>(`select * from take_rate_limit($1,$2,$3)`, [key, win, max])).rows[0]!;

describe("take_rate_limit", () => {
  it("allows up to the limit in a window, then refuses with a retry time", async () => {
    const r = [await take("ip:1"), await take("ip:1"), await take("ip:1"), await take("ip:1")];
    expect(r.map((x) => x.allowed)).toEqual([true, true, true, false]);
    expect(r[3]!.hits).toBe(4);
    expect(r[3]!.retry_after_seconds).toBeGreaterThanOrEqual(1);
    expect(r[3]!.retry_after_seconds).toBeLessThanOrEqual(60);
  });
  it("keeps separate counters per key", async () => {
    expect((await take("ip:2")).allowed).toBe(true);
    expect((await take("user:2")).hits).toBe(1);
  });
  it("refuses nonsense windows and limits", async () => {
    await expect(take("x", 0, 3)).rejects.toThrow(/bad window/);
    await expect(take("x", 60, 0)).rejects.toThrow(/bad window/);
  });
  it("signed-in users and anonymous visitors cannot call it or read the counters; the server role can call it", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query(`select * from take_rate_limit('k',60,3)`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select * from rate_limit_hits`)).rejects.toThrow(/permission denied/);
      await db.exec(`reset role`);
    }
    await db.exec(`set role service_role`);
    expect((await db.query(`select * from take_rate_limit('svc',60,3)`)).rows.length).toBe(1);
    await db.exec(`reset role`);
  });
});
