import { CardSkeleton, Skeleton } from "@/components/ui";

/** Shown while a page's server data loads. Same proportions as a real page so nothing jumps when it arrives. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading page">
      <div className="mb-8 space-y-3"><Skeleton className="h-3 w-28" /><Skeleton className="h-7 w-64" /><Skeleton className="h-3.5 w-full max-w-xl" /></div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <CardSkeleton rows={7} className="h-[24rem] xl:col-span-8" />
        <CardSkeleton rows={5} className="xl:col-span-4" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
