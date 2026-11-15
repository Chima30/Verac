import { redirect } from "next/navigation";
import { Check, FileLock2, Lock, Minus, TriangleAlert } from "lucide-react";
import { Badge, Card, EmptyState, FlashMessages, PageHeader, Source, btnCls, btnDangerCls, fmtUtc, relTime } from "@/components/ui";
import { CopyButton } from "@/components/ui-client";
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

  const readable = docs.filter((d) => canRead.has(d.id)).length;
  const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

  return (
    <>
      <PageHeader title="Document Vault" eyebrow="Security"
        description="Notes and small files sealed in your browser to the members you choose, with post-quantum hybrid encryption (QoreSeal). The server only ever stores ciphertext. Only a chosen reader's own key can open a document."
        badge={<Badge tone="live">ENCRYPTED IN BROWSER</Badge>}
        meta={<><span><strong className="font-semibold text-ink">{docs.length}</strong> document{docs.length === 1 ? "" : "s"}</span><span><strong className="font-semibold text-ink">{readable}</strong> you can open</span><span>{published ? "Your reading key is published" : "No reading key yet"}</span></>}
        actions={published ? <a href="#upload" className={btnCls}>Add a document</a> : undefined} />
      <FlashMessages msg={sp.msg} error={sp.error ?? error?.message} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0">
          {docs.length === 0 ? <EmptyState icon={<FileLock2 size={18} aria-hidden />} title="No documents yet" action={published ? <a href="#upload" className={btnCls}>Add the first document</a> : undefined}>{published ? "Seal a note or a small file to the members who should read it." : "Create and publish your reading key first. Others need it to seal documents to you."}</EmptyState> : (
            <Card title="Library" description="Newest first. Opening a document decrypts it in this browser only." flush>
              <ul className="-mx-5 divide-y divide-line">
                {docs.map((d) => {
                  const mine = canRead.has(d.id);
                  return (
                    <li key={d.id}>
                      <details className="group">
                        <summary className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-2/50">
                          <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-md ${mine ? "bg-accent-soft text-accent-text" : "bg-surface-2 text-subtle"}`}>{mine ? <FileLock2 size={15} /> : <Lock size={15} />}</span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{d.title ?? "Untitled"}</span>
                            <span className="block text-[12.5px] text-muted">{relTime(d.created_at)} · {d.recipients.length} reader{d.recipients.length === 1 ? "" : "s"} · {kb(d.envelope_bytes)} sealed</span></span>
                          {mine ? <Badge tone="info">YOU CAN READ</Badge> : <Badge tone="neutral">NOT A READER</Badge>}
                        </summary>
                        <div className="space-y-3 px-5 pb-4 sm:pl-[4.25rem]">
                          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2">
                            <div><dt className="text-muted">Added</dt><dd>{fmtUtc(d.created_at)}{d.uploaded_by === s.user!.id ? " by you" : ""}</dd></div>
                            <div><dt className="text-muted">Encryption</dt><dd>QoreSeal hybrid (ML-KEM + X25519), sealed per reader</dd></div>
                            <div className="sm:col-span-2"><dt className="text-muted">Ciphertext checksum (SHA-256)</dt><dd className="flex items-center gap-1"><span className="break-all font-mono text-[12px]">{d.ciphertext_sha256}</span><CopyButton value={d.ciphertext_sha256} label="Copy checksum" /></dd></div>
                          </dl>
                          {mine ? <OpenDocument id={d.id} orgId={s.org!.id} userId={s.user!.id} /> : <p className="text-[13px] text-muted">You were not chosen as a reader, so you cannot open it. Ask the uploader to seal a new copy to you.</p>}
                          {(d.uploaded_by === s.user!.id || admin) && (
                            <form action={deleteDocument}><input type="hidden" name="id" value={d.id} /><button className={`${btnDangerCls} min-h-8 text-[12.5px]`}>Delete</button></form>
                          )}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Your reading key" description="Lets others seal documents to you. It stays in this browser."><ReviewerKey orgId={s.org.id} userId={s.user.id} publishedFingerprint={published} publish={publishVaultKey} purpose="Documents" /></Card>
          {published && <Card id="upload" title="Add a document" description="Sealed in your browser before it is uploaded."><UploadForm readers={readers} me={s.user.id} /></Card>}
          <Card title="What is and is not protected">
            <ul className="space-y-2 text-[13px] leading-relaxed">
              <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-[var(--live)]" aria-hidden /><span>Contents are encrypted; the server cannot read them.</span></li>
              <li className="flex gap-2"><Minus size={15} className="mt-0.5 shrink-0 text-subtle" aria-hidden /><span className="text-muted">Titles and reader lists are not encrypted. Owners and administrators can see that a document exists.</span></li>
              <li className="flex gap-2"><Minus size={15} className="mt-0.5 shrink-0 text-subtle" aria-hidden /><span className="text-muted">Checksums are stored but not yet anchored on chain.</span></li>
              <li className="flex gap-2"><TriangleAlert size={15} className="mt-0.5 shrink-0 text-[var(--warn)]" aria-hidden /><span className="text-muted">Lose your reading key and its backup, and your documents cannot be recovered.</span></li>
            </ul>
            <Source>Version history is not kept: a new upload is a new document. QoreSeal is pre-1.0 and its specification awaits external review.</Source>
          </Card>
        </div>
      </div>
    </>
  );
}
