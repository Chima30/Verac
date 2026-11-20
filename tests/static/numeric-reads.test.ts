import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Money columns are numeric(78,0). PostgREST returns numeric as a JSON number, which JavaScript prints as "2e+22" from
 * 10^21 base units (1,000 QOR) up, and BigInt() then throws: that crashed /grants in production. Every Supabase read of
 * such a column must cast it (`amount::text`) and must not use select("*") on a table that has one.
 */
const root = resolve(__dirname, "../..");

function moneyColumns(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (t: string, c: string) => (out.get(t) ?? out.set(t, new Set()).get(t)!).add(c);
  const dir = join(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    for (const m of sql.matchAll(/create table(?: if not exists)?\s+(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\);/gi))
      for (const c of m[2]!.matchAll(/(?:^|,)\s*([a-z_]+)\s+numeric\(78\s*,\s*0\)/gim)) add(m[1]!, c[1]!);
    for (const m of sql.matchAll(/alter table\s+(?:public\.)?([a-z_]+)\s+add column(?: if not exists)?\s+([a-z_]+)\s+numeric\(78/gi)) add(m[1]!, m[2]!);
  }
  return out;
}

function sources(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) acc.push(p);
  }
  return acc;
}

describe("money columns are read as exact text", () => {
  const cols = moneyColumns();

  it("finds the money columns in the migrations", () => {
    expect(cols.get("grants")).toContain("budget");
    expect(cols.get("grant_applications")).toContain("requested_amount");
    expect(cols.get("transactions")).toContain("amount");
  });

  it("no Supabase query reads one as a JSON number", () => {
    const problems: string[] = [];
    const files = ["apps/web", "services", "packages"].flatMap((d) => sources(join(root, d)));
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/from\(\s*"([a-z_]+)"\s*\)\s*\.select\(\s*[`"]([^`"]*)[`"]/g)) {
        const money = cols.get(m[1]!);
        if (!money) continue;
        const where = `${relative(root, file).replace(/\\/g, "/")}:${src.slice(0, m.index).split("\n").length}`;
        const sel = m[2]!.trim();
        if (sel === "*") { problems.push(`${where} select("*") on ${m[1]} (has ${[...money].join(", ")})`); continue; }
        for (const part of sel.split(/,(?![^(]*\))/).map((x) => x.trim().replace(/^[a-z_]+:/, "")))
          if (money.has(part)) problems.push(`${where} ${m[1]}.${part} without ::text`);
      }
    }
    expect(problems).toEqual([]);
  });
});
