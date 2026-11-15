import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ReviewerKey } from "@/components/procurement/reviewer-key";
import { OpenDocument } from "@/components/vault/open-document";
import { UploadForm, type Reader } from "@/components/vault/upload-form";
import { keyFingerprint } from "@/lib/seal-server";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { deleteDocument, publishVaultKey } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document Vault" };

const EXTERNAL = ["vendor", "grant_applicant"];
interface Doc { id: string; title: string | null; uploaded_by: string; created_at: string; envelope_bytes: number; ciphertext_sha256: string; recipients: string[] }

export default async function Vault({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const s = await getSession();
  if (!s.configured) return (<><PageHeader title="Document Vault" description="Encrypted documents for chosen readers." badge={<Badge tone="unavailable" />} /><EmptyState title="Supabase is not connected">The vault lives in your database. See docs/SUPABASE_SETUP.md.</EmptyState></>);
  if (!s.user) redirect("/login?next=/vault");
  if (!s.org) redirect("/onboarding");
  if (EXTERNAL.includes(s.org.role)) return (<><PageHeader title="Document Vault" description="Encrypted documents for chosen readers." badge={<Badge tone="neutral">MEMBERS ONLY</Badge>} /><EmptyState title="Not available for your role">The vault is for organisation members.</EmptyState></>);
  const sp = await searchParams;
  const sb = (await supabaseServer())!;
  const admin = ["owner", "administrator"].includes(s.org.role);

  const { data: mine } = await sb.from("org_seal_keys").select("mlkem_public,x25519_public").eq("organization_id", s.org.id).eq("user_id", s.user.id).maybeSingle();
  const published = mine ? keyFingerprint(mine.mlkem_public, mine.x25519_public) : null;
  const { data: rd } = published ? await sb.rpc("vault_recipients", { p_org: s.org.id }) : { data: [] };
  const readers = (rd ?? []) as Reader[];

  const { data: dd, error } = await sb.from("documents").select("id,title,uploaded_by,created_at,envelope_bytes,ciphertext_sha256,recipients").eq("organization_id", s.org.id).eq("purpose", "vault").order("created_at", { ascending: false });
  const docs = (dd ?? []) as unknown as Doc[];
  const { data: acc } = await sb.from("document_access").select("document_id").eq("user_id", s.user.id);
  const canRead = new Set((acc ?? []).map((a) => a.document_id as string));

  return (
    <>
      <PageHeader title="Document Vault" description="Notes and small files sealed in your browser to the members you choose, using post-quantum hybrid encryption (QoreSeal). The server stores ciphertext only. Only a chosen reader's own key can open a document." badge={<Badge tone="live">ENCRYPTED IN BROWSER</Badge>} />
      {sp.msg && <p role="status" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--live)_25%,transparent)] bg-[var(--live-bg)] px-4 py-3 text-[13.5px]">{sp.msg}</p>}
      {(sp.error || error) && <p role="alert" className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-bg)] px-4 py-3 text-[13.5px] text-[var(--bad)]">{sp.error ?? error?.message}</p>}

      <Card title="Your reading key" className="mb-4"><ReviewerKey orgId={s.org.id} userId={s.user.id} publishedFingerprint={published} publish={publishVaultKey} purpose="Documents" /></Card>

      {published && <Card id="upload" title="Add a document" className="mb-4"><UploadForm readers={readers} me={s.user.id} /></Card>}

      {docs.length === 0 ? <EmptyState title="No documents">{published ? "Add the first one above." : "Create and publish your reading key first."}</EmptyState> : (
        <div className="space-y-3">{docs.map((d) => (
          <Card key={d.id} title={d.title ?? "Untitled"} right={canRead.has(d.id) ? <Badge tone="live">YOU CAN READ</Badge> : <Badge tone="neutral">NOT A READER</Badge>}>
            <p className="text-[12.5px] text-muted">{new Date(d.created_at).toUTCString()} · {d.recipients.length} reader{d.recipients.length === 1 ? "" : "s"} · {d.envelope_bytes.toLocaleString()} bytes sealed · checksum <span className="font-mono">{d.ciphertext_sha256.slice(0, 16)}…</span></p>
            {canRead.has(d.id) ? <div className="mt-3"><OpenDocument id={d.id} orgId={s.org!.id} userId={s.user!.id} /></div> : <p className="mt-2 text-[13.5px] text-muted">You were not chosen as a reader, so you cannot open it. Ask the uploader to share a new sealed copy.</p>}
            {(d.uploaded_by === s.user!.id || admin) && (
              <form action={deleteDocument} className="mt-3"><input type="hidden" name="id" value={d.id} /><button className="inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-3 text-[12.5px] font-medium text-ink hover:border-line-strong hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50">Delete</button></form>
            )}
          </Card>
        ))}</div>
      )}
      <p className="mt-4 text-[12.5px] text-muted">Titles and who-can-read lists are not encrypted, and owners and administrators can see that a document exists. Checksums are stored but are not anchored on-chain (PENDING). If you lose your reading key and its backup, your documents cannot be recovered. QoreSeal is pre-1.0 and its specification awaits external review.</p>
    </>
  );
}
