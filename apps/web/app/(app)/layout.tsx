import { Shell } from "@/components/shell";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

/** Payment requests waiting for a person, live and simulated, read through row-level security. Null when it cannot be read. */
async function pendingApprovals(orgId: string): Promise<number | null> {
  const sb = await supabaseServer();
  if (!sb) return null;
  const { count, error } = await sb.from("transactions").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("state", "AWAITING_APPROVAL");
  return error ? null : count ?? 0;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession(true);
  const pending = s.org ? await pendingApprovals(s.org.id) : null;
  return (
    <Shell productName={process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Verac"} account={{ configured: s.configured, email: s.user?.email ?? null }}
      org={s.org ? { name: s.org.name, role: s.org.role } : null} pending={pending}>
      {children}
    </Shell>
  );
}
