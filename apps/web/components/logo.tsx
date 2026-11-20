/**
 * Verac's mark: a V drawn as a verification tick (one short stroke, one long), in a black square with 4px corners, with
 * the periwinkle dash that marks "you are here" across the system. The same geometry is the favicon (app/icon.svg).
 */
export function LogoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden className={`shrink-0 ${className}`}>
      <rect width="32" height="32" rx="4" className="fill-[var(--primary)]" />
      <path d="M8.5 15.5 L13.5 23 L24 8.5" fill="none" strokeWidth="3.2" strokeLinecap="square" strokeLinejoin="miter" className="stroke-[var(--primary-ink)]" />
      <rect x="6.5" y="10" width="6" height="2.4" fill="#bdbbff" />
    </svg>
  );
}

/** Mark plus wordmark. `hideText` hides the word where the collapsed sidebar has no room. */
export function Logo({ name = "Verac", hideText = false, size = 30 }: { name?: string; hideText?: boolean; size?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <LogoMark size={size} />
      <span className={`truncate text-[20px] font-medium leading-none tracking-[-0.03em] ${hideText ? "lg:collapsed:hidden" : ""}`}>{name}</span>
    </span>
  );
}
