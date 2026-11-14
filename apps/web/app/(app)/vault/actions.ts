"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

export interface ActionResult { error?: string; envelope?: string; sha256?: string }

async function ctx() {
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/vault");
  return { s: s as typeof s & { org: NonNullable<typeof s.org> }, sb: sb! };
}

export async function publishVaultKey(mlkem: string, x25519: string): Promise<ActionResult> {
  const { s, sb } = await ctx();
  const { error } = await sb.rpc("publish_my_seal_key", { p_org: s.org.id, p_mlkem: mlkem, p_x25519: x25519 });
  if (error) return { error: error.message };
  revalidatePath("/vault");
  return {};
}

export async function uploadDocument(id: string, title: string, envelope: string, sha256: string, readers: string[]): Promise<ActionResult> {
  const { s, sb } = await ctx();
  const { error } = await sb.rpc("upload_vault_document", { p_org: s.org.id, p_id: id, p_title: title, p_envelope: envelope, p_sha256: sha256, p_recipients: readers });
  if (error) return { error: error.message };
  revalidatePath("/vault");
  return {};
}

export async function fetchDocument(id: string): Promise<ActionResult> {
  const { sb } = await ctx();
  const { data, error } = await sb.rpc("vault_document_envelope", { p_id: id });
  if (error) return { error: error.message };
  const row = (data as Array<{ envelope: string; envelope_sha256: string }> | null)?.[0];
  return row ? { envelope: row.envelope, sha256: row.envelope_sha256 } : { error: "Document not found." };
}

export async function deleteDocument(formData: FormData) {
  const { sb } = await ctx();
  const { error } = await sb.rpc("delete_vault_document", { p_id: String(formData.get("id") ?? "") });
  redirect(`/vault?${error ? "error" : "msg"}=${encodeURIComponent(error ? error.message : "Document deleted. Copies already downloaded are not affected.")}`);
}
