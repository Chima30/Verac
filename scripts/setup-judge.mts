/**
 * Creates (or repairs) the read-only judge account: a Supabase user who is an "auditor" in ONE demo organisation.
 * Auditors read what administrators read and the database refuses every change they attempt (migration 0023 and
 * tests/security/auditor-read.test.ts). Run it on your own computer; it needs the service-role key, which never leaves it.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/setup-judge.mts                 list organisations
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/setup-judge.mts --org <id>      dry run
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/setup-judge.mts --org <id> --apply
 *
 * With --apply it writes JUDGE_EMAIL and JUDGE_PASSWORD to .secrets/judge.txt (git-ignored, not printed). Add both to
 * Vercel as Sensitive variables and redeploy; "Enter as a judge" then appears on /start.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const APPLY = argv.includes("--apply");
const die = (m: string): never => { console.error(`REFUSED: ${m}`); process.exit(1); };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || die("set NEXT_PUBLIC_SUPABASE_URL");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || die("set SUPABASE_SERVICE_ROLE_KEY (from Supabase → Project settings → API)");
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const email = (flag("--email") ?? "judge.verac@example.com").toLowerCase();

const org = flag("--org");
if (!org) {
  const { data, error } = await sb.from("organizations").select("id,name,created_at").order("created_at");
  if (error) die(error.message);
  console.log("Organisations (pick the demo one, with sample data and no personal details):");
  for (const o of data ?? []) {
    const [{ count: members }, { count: rounds }, { count: invoices }] = await Promise.all([
      sb.from("memberships").select("*", { count: "exact", head: true }).eq("organization_id", o.id),
      sb.from("grants").select("*", { count: "exact", head: true }).eq("organization_id", o.id),
      sb.from("invoices").select("*", { count: "exact", head: true }).eq("organization_id", o.id),
    ]);
    console.log(`  ${o.id}  ${o.name}  (${members ?? 0} members, ${rounds ?? 0} grant rounds, ${invoices ?? 0} invoices)`);
  }
  console.log("\nThen: … --org <id>   (dry run), and add --apply to create the account.");
  process.exit(0);
}

const { data: o, error: oe } = await sb.from("organizations").select("id,name").eq("id", org).maybeSingle();
if (oe || !o) die(`organisation ${org} not found`);
const { data: members } = await sb.from("memberships").select("user_id,role").eq("organization_id", org);
console.log(`${APPLY ? "APPLY" : "DRY RUN"}  judge account ${email} as a read-only auditor in "${o!.name}" (${org})`);
console.log(`  The judge will see this organisation's records, including the email addresses of its ${members?.length ?? 0} member(s) on the Team page.`);

// Find an existing user with this email (paged listing; demo projects are small).
let userId: string | null = null;
for (let page = 1; page <= 20 && !userId; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
  if (error) die(error.message);
  userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
  if (data.users.length < 200) break;
}
const elsewhere = userId ? (await sb.from("memberships").select("organization_id,role").eq("user_id", userId)).data ?? [] : [];
if (elsewhere.some((m) => m.organization_id !== org)) die(`${email} already belongs to another organisation; use --email to pick a fresh address`);
if (elsewhere.some((m) => m.organization_id === org && m.role !== "auditor")) die(`${email} already has the role ${elsewhere[0]!.role} here; it must be auditor only`);
console.log(`  user: ${userId ? "exists, password will be reset" : "will be created"}; membership: ${elsewhere.length ? "already auditor" : "will be added as auditor"}`);
if (!APPLY) { console.log("Nothing was changed. Re-run with --apply."); process.exit(0); }

const password = randomBytes(24).toString("base64url");
if (userId) {
  const { error } = await sb.auth.admin.updateUserById(userId, { password, email_confirm: true });
  if (error) die(error.message);
} else {
  const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { purpose: "read-only judge account" } });
  if (error || !data.user) die(error?.message ?? "could not create the user");
  userId = data.user!.id;
}
if (!elsewhere.length) {
  const { error } = await sb.from("memberships").insert({ organization_id: org, user_id: userId, role: "auditor", status: "active" });
  if (error) die(`membership: ${error.message}`);
}
const out = resolve(root, ".secrets/judge.txt");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `# Read-only judge account for Verac. Add both lines to Vercel as Sensitive variables, then redeploy.\nJUDGE_EMAIL=${email}\nJUDGE_PASSWORD=${password}\n`, { mode: 0o600 });
console.log(`Done. ${email} is an auditor in "${o!.name}". The settings for Vercel are in ${out} (not printed).`);
