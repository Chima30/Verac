/**
 * SERVER ONLY. Checks the server's settings by name and shape, never by value: the result says which settings are
 * missing or malformed so a misconfiguration is caught at start-up and in /api/health instead of mid-payment.
 * Nothing here returns or logs a value.
 */

type Shape = "url" | "jwt" | "hex32" | "mldsa87Public" | "mldsa87Secret" | "address" | "bool" | "text";
interface Setting { name: string; shape: Shape; note?: string }
interface Group { id: string; label: string; required: boolean; settings: Setting[]; enabledBy?: string }

/** Groups of settings. A group is "on" when its first setting (or `enabledBy`) is set; then all of it must be valid. */
export const GROUPS: Group[] = [
  { id: "database", label: "Database (Supabase): sign-in and organisation data", required: false, settings: [
    { name: "NEXT_PUBLIC_SUPABASE_URL", shape: "url" }, { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", shape: "text" },
  ] },
  { id: "server", label: "Server database key", required: false, settings: [{ name: "SUPABASE_SERVICE_ROLE_KEY", shape: "text", note: "needed for agents, live payments, grants and shared rate limits" }] },
  { id: "agents", label: "Agent message signing", required: false, settings: [{ name: "AGENT_MESSAGE_ROOT_SECRET", shape: "text" }] },
  { id: "ai", label: "AI (Gemini)", required: false, settings: [{ name: "GEMINI_API_KEY", shape: "text" }] },
  { id: "live", label: "Live testnet payments (TreasuryVault)", required: false, enabledBy: "LIVE_EXECUTION_ENABLED", settings: [
    { name: "AGENT_EVM_PRIVATE_KEY", shape: "hex32" }, { name: "AGENT_MLDSA_PUBLIC_KEY", shape: "mldsa87Public" }, { name: "AGENT_MLDSA_SECRET_KEY", shape: "mldsa87Secret" },
    { name: "APPROVER_EVM_PRIVATE_KEY", shape: "hex32" }, { name: "APPROVER_MLDSA_PUBLIC_KEY", shape: "mldsa87Public" }, { name: "APPROVER_MLDSA_SECRET_KEY", shape: "mldsa87Secret" },
  ] },
  { id: "v2", label: "TreasuryVault V2 (post-quantum approvals)", required: false, settings: [
    { name: "V2_VAULT_ADDRESS", shape: "address" }, { name: "V2_AGENT_EVM_PRIVATE_KEY", shape: "hex32" },
    { name: "V2_AGENT_MLDSA_PUBLIC_KEY", shape: "mldsa87Public" }, { name: "V2_AGENT_MLDSA_SECRET_KEY", shape: "mldsa87Secret" },
  ] },
  { id: "cron", label: "Scheduled jobs", required: false, settings: [{ name: "CRON_SECRET", shape: "text", note: "Vercel sends it to /api/cron/*" }] },
  { id: "github", label: "GitHub evidence (higher rate limit)", required: false, settings: [{ name: "GITHUB_TOKEN", shape: "text" }] },
  { id: "judge", label: "Read-only judge account", required: false, settings: [{ name: "JUDGE_EMAIL", shape: "text" }, { name: "JUDGE_PASSWORD", shape: "text", note: "an auditor in the demo organisation; see docs/JUDGE_ACCOUNT.md" }] },
];

const hexLen = (v: string, bytes: number) => new RegExp(`^(0x)?[0-9a-fA-F]{${bytes * 2}}$`).test(v);
/** ML-DSA-87 sizes (FIPS 204): public key 2,592 bytes, secret key 4,896 bytes; accepted as hex or base64. */
const sized = (v: string, bytes: number) => hexLen(v, bytes) || (/^[A-Za-z0-9+/=]+$/.test(v) && Math.floor((v.replace(/=+$/, "").length * 3) / 4) === bytes);
const CHECK: Record<Shape, (v: string) => boolean> = {
  url: (v) => /^https:\/\/[^\s/]+/.test(v) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(v),
  jwt: (v) => v.split(".").length === 3,
  hex32: (v) => hexLen(v, 32),
  mldsa87Public: (v) => sized(v, 2592),
  mldsa87Secret: (v) => sized(v, 4896),
  address: (v) => /^0x[0-9a-fA-F]{40}$/.test(v),
  bool: (v) => v === "true" || v === "false",
  text: (v) => v.length >= 8,
};

export type SettingState = "set" | "missing" | "malformed";
export interface GroupReport { id: string; label: string; required: boolean; state: "ready" | "off" | "incomplete"; problems: Array<{ name: string; state: SettingState; note?: string }> }

export function checkConfig(env: Record<string, string | undefined> = process.env): { ok: boolean; groups: GroupReport[] } {
  const groups = GROUPS.map((g): GroupReport => {
    const states = g.settings.map((s) => {
      const v = env[s.name]?.trim();
      return { name: s.name, state: (!v ? "missing" : CHECK[s.shape](v) ? "set" : "malformed") as SettingState, note: s.note };
    });
    const on = g.required || (g.enabledBy ? env[g.enabledBy]?.trim() === "true" : states[0]!.state !== "missing");
    const problems = states.filter((s) => s.state !== "set");
    return { id: g.id, label: g.label, required: g.required, state: !on ? "off" : problems.length ? "incomplete" : "ready", problems: on ? problems : [] };
  });
  return { ok: groups.every((g) => g.state !== "incomplete"), groups };
}

/** One line per problem, for server logs at start-up. Names only. */
export function configWarnings(env: Record<string, string | undefined> = process.env): string[] {
  return checkConfig(env).groups.flatMap((g) => g.problems.map((p) => `[config] ${g.label}: ${p.name} is ${p.state}${p.note ? ` (${p.note})` : ""}`));
}
