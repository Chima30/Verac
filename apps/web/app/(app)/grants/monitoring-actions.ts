"use server";
import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/live/service";
import { getSession } from "@/lib/session";

/** Turns the weekly repository-activity check for a round's funded projects on or off (owners and administrators). */
export async function setMonitoring(f: FormData) {
  const s = await getSession();
  if (!s.user || !s.org) redirect("/login?next=/grants");
  const id = String(f.get("id") ?? "");
  const back = (kind: "msg" | "error", text: string): never => redirect(`/grants/${id}?${kind}=${encodeURIComponent(text)}`);
  if (!["owner", "administrator"].includes(s.org!.role)) back("error", "Only owners and administrators can change monitoring.");
  const value = String(f.get("repo_activity")) === "off" ? "off" : "weekly";
  let db;
  try { db = serviceClient(); } catch { back("error", "The server's database key is not configured."); }
  // The round must belong to the caller's organisation; the update is scoped to it.
  const { data: g } = await db!.from("grants").select("id,rules").eq("id", id).eq("organization_id", s.org!.id).maybeSingle();
  if (!g) back("error", "Round not found.");
  const rules = { ...((g!.rules as Record<string, unknown> | null) ?? {}), monitoring: { ...(((g!.rules as { monitoring?: object } | null)?.monitoring) ?? {}), repo_activity: value } };
  const { error } = await db!.from("grants").update({ rules }).eq("id", id).eq("organization_id", s.org!.id);
  if (error) back("error", error.message);
  await db!.from("audit_events").insert({ organization_id: s.org!.id, actor: s.user!.id, action: "grant.monitoring_set", subject: id, detail: { repo_activity: value } });
  back("msg", value === "off" ? "Weekly repository check switched off for this round." : "Weekly repository check switched on for this round's funded projects.");
}
