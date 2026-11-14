import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { MODULES } from "@/lib/modules";

export function generateStaticParams() {
  return Object.keys(MODULES).map((k) => ({ slug: k.split("/") }));
}
export const dynamicParams = false;

export default async function ModulePage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const info = MODULES[slug.join("/")];
  if (!info) notFound();
  return (
    <>
      <PageHeader title={info.title} description={info.description} badge={<Badge tone="pending" />} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Already in the repository">
          <ul className="list-disc space-y-1.5 pl-5 text-sm">{info.exists.map((e) => <li key={e}>{e}</li>)}</ul>
        </Card>
        <Card title="Not built yet">
          <ul className="list-disc space-y-1.5 pl-5 text-sm">{info.missing.map((e) => <li key={e}>{e}</li>)}</ul>
        </Card>
      </div>
      {info.agent && <p className="mt-4 text-sm text-muted">Responsible component: <span className="font-mono">{info.agent}</span>. This page has no working controls yet, so none are shown.</p>}
    </>
  );
}
