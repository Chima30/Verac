import Link from "next/link";
import { redirect } from "next/navigation";
import { ApplicationForm, type AppFormValue } from "@/components/grants/application-form";
import { Badge, EmptyState, FlashMessages, Notice, PageHeader } from "@/components/ui";
import { formatQor } from "@/lib/approvals";
import { weiToQorInput, wei, type AppRow, type RoundRow } from "@/lib/grants";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { saveApplication } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grant application" };

export default async function Apply({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await getSession();
  if (!s.user) redirect(`/login?next=/grants/${id}/apply`);
  if (!s.org) redirect("/onboarding");
  const sb = (await supabaseServer())!;
  if (s.org.role !== "grant_applicant") return <EmptyState title="Applicants only">Only members with the grant applicant role can apply. <Link className="underline" href={`/grants/${id}`}>Back to the round</Link>.</EmptyState>;

  const { data: g } = await sb.from("grants").select("id,title,budget,status,description,requirements,categories,deadline,max_request").eq("id", id).maybeSingle();
  if (!g) return <EmptyState title="Round not found">It may have been closed, or it belongs to another organisation.</EmptyState>;
  const round = g as unknown as RoundRow;
  const { data: mine } = await sb.from("grant_applications").select("*").eq("grant_id", id).eq("applicant_user_id", s.user.id).maybeSingle();
  const a = mine as unknown as AppRow | null;
  if (a && a.status !== "draft" && !a.amendment_open) redirect(`/grants/applications/${a.id}`);
  const closed = round.status !== "open" || (round.deadline && new Date(round.deadline) <= new Date());
  if (!a && closed) return <EmptyState title="Applications are closed">This round is not accepting new applications. <Link className="underline" href={`/grants/${id}`}>Back to the round</Link>.</EmptyState>;

  const c = a?.content ?? {};
  const initial: AppFormValue = {
    name: a?.applicant_name && a.applicant_name !== "Untitled draft" ? a.applicant_name : "",
    category: a?.category ?? "", amountQor: a ? weiToQorInput(a.requested_amount) : "", recipient: a?.recipient_address ?? "",
    content: {
      overview: c.overview ?? "", problem: c.problem ?? "", solution: c.solution ?? "", team: c.team ?? "", experience: c.experience ?? "",
      technical: c.technical ?? "", metrics: c.metrics ?? "", timeline: c.timeline ?? "",
      links: { website: c.links?.website ?? "", docs: c.links?.docs ?? "", demo: c.links?.demo ?? "", repos: c.links?.repos ?? [] },
      contracts: c.contracts ?? [], transactions: c.transactions ?? [],
      budget: (c.budget ?? []).map((b) => ({ item: b.item, amountQor: weiToQorInput(b.amount) })),
      milestones: (c.milestones ?? []).map((m) => ({ title: m.title, deliverable: m.deliverable, verification: m.verification, due: m.due, amountQor: weiToQorInput(m.amount) })),
      declarations: { accurate: !!c.declarations?.accurate, rights: !!c.declarations?.rights, conflicts_disclosed: !!c.declarations?.conflicts_disclosed },
    },
  };
  if (!initial.content.budget.length) initial.content.budget = [{ item: "", amountQor: "" }];
  if (!initial.content.milestones.length) initial.content.milestones = [{ title: "", deliverable: "", verification: "", due: "", amountQor: "" }];

  return (
    <>
      <PageHeader title={a?.amendment_open ? "Amend your application" : "Apply"} eyebrow={round.title}
        description={`Budget ${formatQor(wei(round.budget))} QOR${round.max_request ? `, at most ${formatQor(wei(round.max_request))} QOR per application` : ""}${round.deadline ? `, closes ${new Date(round.deadline).toLocaleDateString()}` : ""}.`}
        badge={<Badge tone={a ? "neutral" : "info"}>{a ? (a.amendment_open ? "AMENDMENT OPEN" : "DRAFT") : "NEW"}</Badge>} />
      <FlashMessages msg={sp.msg} error={sp.error} />
      {round.requirements && <Notice tone="info" title="Programme requirements" className="mb-6"><p className="whitespace-pre-wrap">{round.requirements}</p></Notice>}
      {a?.amendment_open && <Notice tone="warn" className="mb-6">A reviewer opened your application for one amendment. Answer their questions in the relevant sections, then resubmit. Your earlier versions stay on record.</Notice>}
      <div className="rounded-lg border border-line bg-surface p-5 shadow-card md:p-7">
        <ApplicationForm grantId={id} categories={round.categories ?? ["software", "research", "education", "community", "other"]} initial={initial} amending={!!a?.amendment_open} action={saveApplication} />
      </div>
    </>
  );
}
