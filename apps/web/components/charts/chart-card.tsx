import type { ReactNode } from "react";
import { BarChart3 } from "lucide-react";

/**
 * The one container for every chart in Verac: a deep surface with a soft light along the top edge, generous padding
 * and the dark tokens applied inside (`theme-dark`), so charts read the same in the light and the dark app theme.
 */
export function ChartCard({ title, description, right, children, footer, className = "", id, label }: {
  /** Leave out when the chart draws its own label and value (the area chart does). */
  title?: ReactNode; description?: ReactNode; right?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string; id?: string;
  /** Accessible name when there is no visible title. */
  label?: string;
}) {
  return (
    <section id={id} aria-label={title ? undefined : label} className={`theme-dark chart-card min-w-0 scroll-mt-24 rounded-[4px] p-6 sm:p-8 ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[18px] font-medium tracking-[-0.01em]">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] leading-relaxed text-subtle">{description}</p>}
          </div>
          {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
        </div>
      )}
      {children}
      {footer && <p className="mt-5 border-t border-white/[0.06] pt-3.5 text-[12px] leading-relaxed text-subtle">{footer}</p>}
    </section>
  );
}

/** Honest empty chart: says why there is nothing to draw. Never a placeholder line. */
export function ChartEmpty({ title, children, height = 220 }: { title: string; children?: ReactNode; height?: number }) {
  return (
    <div className="grid place-items-center rounded-[4px] border border-dashed border-white/15 px-6 text-center" style={{ minHeight: height }}>
      <div>
        <BarChart3 size={22} className="mx-auto text-subtle" aria-hidden />
        <p className="mt-3 text-[14px] font-semibold">{title}</p>
        {children && <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-subtle">{children}</p>}
      </div>
    </div>
  );
}

/** Loading state with the proportions of a real chart card, so nothing jumps when data arrives. */
export function ChartSkeleton({ height = 220, className = "", label = "Loading chart" }: { height?: number; className?: string; label?: string }) {
  return (
    <div role="status" aria-label={label} className={`theme-dark chart-card rounded-[4px] p-6 sm:p-8 ${className}`}>
      <div className="skeleton h-3 w-28" />
      <div className="skeleton mt-3 h-9 w-44" />
      <div className="skeleton mt-6 w-full !rounded-xl opacity-60" style={{ height }} />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-subtle">
      {items.map((i) => <li key={i.label} className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full" style={{ background: i.color }} />{i.label}</li>)}
    </ul>
  );
}
