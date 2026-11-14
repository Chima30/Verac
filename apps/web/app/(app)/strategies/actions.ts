"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SavedStrategySchema } from "@qoreops/policy-engine";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export interface SaveResult { error?: string; ok?: boolean }

async function ctx() {
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/strategies");
  return { s: s as typeof s & { org: NonNullable<typeof s.org> }, sb: sb! };
}

/** Re-validates on the server. Only the typed inputs are stored; the database forces SIMULATION and paused. */
export async function saveStrategy(raw: unknown): Promise<SaveResult> {
  const { s, sb } = await ctx();
  const p = SavedStrategySchema.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid strategy." };
  const { error } = await sb.rpc("save_strategy", { p_org: s.org.id, p_kind: p.data.kind, p_config: { name: p.data.name, input: p.data.input } });
  if (error) return { error: error.message };
  revalidatePath("/strategies"); revalidatePath("/arbitrage");
  return { ok: true };
}

export async function cancelStrategy(formData: FormData) {
  const { sb } = await ctx();
  const back = String(formData.get("back") ?? "/strategies") === "/arbitrage" ? "/arbitrage" : "/strategies";
  const { error } = await sb.rpc("cancel_strategy", { p_id: String(formData.get("id") ?? "") });
  redirect(`${back}?${error ? "error" : "msg"}=${encodeURIComponent(error ? error.message : "Saved simulation cancelled.")}`);
}
