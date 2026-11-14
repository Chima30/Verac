import { supabaseConfigured } from "./supabase/config";
import { supabaseServer } from "./supabase/server";

export interface OrgInfo {
  id: string; name: string; role: string; treasuryAddress: string | null; contracts: Record<string, string>;
}
export interface Session {
  configured: boolean;
  user: { id: string; email: string | null } | null;
  org: OrgInfo | null;
  error?: string;
}

/** Signed-in user plus their first active organisation. Every query runs as the user, so RLS decides what comes back. */
export async function getSession(withOrg = true): Promise<Session> {
  if (!supabaseConfigured()) return { configured: false, user: null, org: null };
  const sb = await supabaseServer();
  if (!sb) return { configured: false, user: null, org: null };
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return { configured: true, user: null, org: null };
  const user = { id: auth.user.id, email: auth.user.email ?? null };
  if (!withOrg) return { configured: true, user, org: null };

  const { data, error } = await sb
    .from("memberships")
    .select("role, organization:organizations(id,name,treasury_address,contracts)")
    .eq("user_id", user.id).eq("status", "active").order("created_at", { ascending: true }).limit(1);
  if (error) return { configured: true, user, org: null, error: error.message };
  const row = data?.[0] as unknown as { role: string; organization: { id: string; name: string; treasury_address: string | null; contracts: Record<string, string> } | null } | undefined;
  if (!row?.organization) return { configured: true, user, org: null };
  const o = row.organization;
  return { configured: true, user, org: { id: o.id, name: o.name, role: row.role, treasuryAddress: o.treasury_address, contracts: o.contracts ?? {} } };
}
