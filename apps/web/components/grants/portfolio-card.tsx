import Link from "next/link";
import { Badge, Card, Metric, Source } from "@/components/ui";
import { formatQor } from "@/lib/approvals";
import type { Alert } from "@/lib/grants/portfolio";

export function PortfolioCard({ p, alerts }: {
  p: { awardedCount: number; committedWei: bigint; releasedWei: bigint; requestedWei: bigint; remainingWei: bigint; milestones: number; releasedMilestones: number; overdue: number; completionRate: number | null };
  alerts: Alert[];
}) {
  return (
    <Card title="Grant portfolio" description="From recorded awards, milestones and on-chain confirmed payments. Nothing estimated.">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-5">
        <Metric label="Funded projects" value={p.awardedCount} />
        <Metric label="Committed" value={<>{formatQor(p.committedWei.toString())} <span className="text-[12px] font-medium text-muted">QOR</span></>} />
        <Metric label="Released on chain" value={<>{formatQor(p.releasedWei.toString())} <span className="text-[12px] font-medium text-muted">QOR</span></>} tone={p.releasedWei > 0n ? "live" : undefined} sub={p.requestedWei > 0n ? `${formatQor(p.requestedWei.toString())} QOR requested` : undefined} />
        <Metric label="Milestones released" value={p.completionRate === null ? "–" : `${p.completionRate}%`} sub={`${p.releasedMilestones} of ${p.milestones}`} />
        <Metric label="Overdue milestones" value={p.overdue} tone={p.overdue ? "warn" : undefined} />
      </dl>
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-[13px] font-medium">Alerts</p>
        {alerts.length === 0 ? <p className="mt-1 text-[13px] text-muted">Nothing needs attention right now.</p> : (
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {alerts.slice(0, 12).map((a, i) => <li key={i} className="flex gap-2"><Badge tone={a.severity === "high" ? "failed" : a.severity === "medium" ? "pending" : "neutral"}>{a.severity.toUpperCase()}</Badge><Link className="hover:underline" href={`/grants/applications/${a.applicationId}#milestones`}>{a.text}</Link></li>)}
          </ul>
        )}
        <Source>Repository activity is re-read weekly by the scheduled monitor (/api/cron/grants-monitor). A quiet repository is information, not a failure.</Source>
      </div>
    </Card>
  );
}
