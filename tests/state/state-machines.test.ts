import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { OPERATION_STATES, STATE_MACHINES, canMove, canTransition, describeMachines, machineFor, nextMoves, renderStateMachinesMarkdown, stateOf, type MachineDef } from "../../packages/shared-types/src/index";

/**
 * Keeps packages/shared-types/src/state-machines.ts honest. It fails when:
 *   - the database allows states the registry does not list, or the other way round (every migration is replayed);
 *   - any SQL function or server code writes a state that no declared transition reaches, or a "reserved" state;
 *   - a machine has a dead end, an unreachable state, or a move out of a terminal state;
 *   - the agent pipeline's own transition table allows a move the registry does not declare.
 */
const root = resolve(__dirname, "../..");
const machines = Object.values(STATE_MACHINES) as MachineDef[];
let dbStates: Map<string, string[]>;

beforeAll(async () => {
  const db = new PGlite();
  await db.exec(`create schema auth; create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create role authenticated nologin; create role service_role nologin bypassrls; create role anon nologin;`);
  const dir = join(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
  const r = await db.query<{ t: string; d: string }>(`select conrelid::regclass::text t, pg_get_constraintdef(oid) d from pg_constraint where contype = 'c'`);
  dbStates = new Map();
  for (const { t, d } of r.rows) {
    const m = /^CHECK \(\((status|state) = ANY \(ARRAY\[(.*)\]\)\)\)$/.exec(d.replace(/::text(\[\])?/g, ""));
    if (m) dbStates.set(`${t}.${m[1]}`, [...m[2]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort());
  }
}, 180_000);

describe("the registry matches the database", () => {
  it("covers every status and state column the database constrains", () => {
    const missing = [...dbStates.keys()].filter((k) => !machines.some((m) => `${m.table}.${m.column}` === k));
    expect(missing).toEqual([]);
  });
  it.each(machines.map((m) => [m.id, m] as const))("%s lists exactly the database's allowed values", (_id, m) => {
    expect(Object.keys(m.states).sort()).toEqual(dbStates.get(`${m.table}.${m.column}`));
  });
});

describe("every machine is well formed", () => {
  it.each(machines.map((m) => [m.id, m] as const))("%s: moves use real states, terminal states have no way out, nothing is unreachable or stuck", (_id, m) => {
    const keys = Object.keys(m.states);
    for (const t of m.transitions) {
      expect(keys).toContain(t.to);
      if (t.from !== "new") for (const f of t.from) expect(keys).toContain(f);
    }
    for (const [k, s] of Object.entries(m.states)) {
      const out = m.transitions.filter((t) => t.from !== "new" && t.from.includes(k));
      const into = m.transitions.filter((t) => t.to === k);
      if (s.reserved) { expect(into, `${m.id}.${k} is reserved, so nothing may move into it`).toEqual([]); continue; }
      expect(into.length, `${m.id}.${k} can never be reached`).toBeGreaterThan(0);
      if (s.terminal) expect(out, `${m.id}.${k} is terminal but has moves out`).toEqual([]);
      else if (!s.steady) expect(out.length, `${m.id}.${k} is not terminal or steady but has no move out`).toBeGreaterThan(0);
      else expect(out, `${m.id}.${k} is steady, so it should have no move out (otherwise drop the flag)`).toEqual([]);
    }
  });
});

// ------------------------------------------------------------------------------------------------------------ writes
function sources(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) acc.push(p);
  }
  return acc;
}
/** Every literal state written in SQL (update … set, insert … values) and in server code (.update/.insert/.upsert). */
function literalWrites(): Array<{ table: string; column: string; value: string; where: string }> {
  const out: Array<{ table: string; column: string; value: string; where: string }> = [];
  const dir = join(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, f), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/update\s+([a-z_]+)\s+set\s+([\s\S]*?)(?:\swhere\s|;)/gi))
      for (const c of ["status", "state"]) for (const v of m[2]!.matchAll(new RegExp(`(?:^|[\\s,])${c}\\s*=\\s*'([A-Za-z_]+)'`, "g"))) out.push({ table: m[1]!, column: c, value: v[1]!, where: f });
    for (const m of sql.matchAll(/insert\s+into\s+([a-z_]+)\s*\(([^)]*)\)\s*values\s*\(([^;]*?)\)\s*(?:returning|;|on\s)/gi)) {
      const cols = m[2]!.split(",").map((s) => s.trim());
      const vals = m[3]!.split(/,(?![^(]*\))/);
      for (const c of ["status", "state"]) { const i = cols.indexOf(c); const v = i >= 0 ? /^\s*'([A-Za-z_]+)'\s*$/.exec(vals[i] ?? "") : null; if (v) out.push({ table: m[1]!, column: c, value: v[1]!, where: f }); }
    }
  }
  for (const file of ["apps/web", "services", "packages"].flatMap((d) => sources(join(root, d)))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/from\("([a-z_]+)"\)\s*\.(?:update|insert|upsert)\(\s*\{([^}]*)\}/g))
      for (const c of ["status", "state"]) { const v = new RegExp(`\\b${c}:\\s*"([A-Za-z_]+)"`).exec(m[2]!); if (v) out.push({ table: m[1]!, column: c, value: v[1]!, where: relative(root, file).replace(/\\/g, "/") }); }
  }
  return out;
}

describe("the code only writes declared states", () => {
  const writes = literalWrites();
  it("finds the writes it is meant to check", () => {
    expect(writes.length).toBeGreaterThan(40);
    expect(writes.some((w) => w.table === "grant_applications" && w.value === "clarification_requested")).toBe(true);
  });
  it("every state written in SQL or server code is the target of a declared transition, and never a reserved state", () => {
    const problems: string[] = [];
    for (const w of writes) {
      const m = machineFor(w.table, w.column);
      if (!m) continue; // a column called status on a table without a state machine (for example a CASE inside another table's update)
      const s = (m.states as Record<string, { reserved?: string }>)[w.value];
      if (!s) problems.push(`${w.where}: ${w.table}.${w.column} = '${w.value}' is not a state of ${m.id}`);
      else if (s.reserved) problems.push(`${w.where}: writes reserved state ${m.id}.${w.value}`);
      else if (!m.transitions.some((t) => t.to === w.value)) problems.push(`${w.where}: no declared transition reaches ${m.id}.${w.value}`);
    }
    expect(problems).toEqual([]);
  });
});

describe("the agent pipeline agrees with the registry", () => {
  it("every move the pipeline allows is a declared payment transition", () => {
    for (const from of OPERATION_STATES) for (const to of OPERATION_STATES) if (canTransition(from, to)) expect(canMove("payment", from, to), `${from} -> ${to}`).toBe(true);
  });
});

describe("helpers", () => {
  it("describe a state and what can happen next, without throwing on unknown values", () => {
    expect(stateOf("grant_application", "recommended")).toMatchObject({ label: "Recommended", tone: "approval", known: true });
    expect(stateOf("grant_application", "something_new")).toMatchObject({ label: "something new", tone: "neutral", known: false });
    expect(nextMoves("grant_application", "recommended").map((t) => t.to).sort()).toEqual(["awarded", "rejected"]);
    expect(canMove("payment", "CONFIRMED", "FAILED")).toBe(false);
  });
});

describe("what agents and developers read", () => {
  it("docs/STATE_MACHINES.md is up to date (run pnpm state:docs)", () => {
    expect(readFileSync(join(root, "docs/STATE_MACHINES.md"), "utf8").replace(/\r\n/g, "\n")).toBe(renderStateMachinesMarkdown());
  });
  it("the JSON for /api/state-machines covers every machine and is plain data", () => {
    const j = JSON.parse(JSON.stringify(describeMachines())) as Array<{ id: string; states: unknown[]; transitions: unknown[] }>;
    expect(j.map((m) => m.id).sort()).toEqual(Object.keys(STATE_MACHINES).sort());
    expect(j.every((m) => m.states.length > 0 && m.transitions.length > 0)).toBe(true);
  });
});
