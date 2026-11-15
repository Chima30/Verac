/**
 * Slow ambient light behind a hero area: three soft fields that drift and one faint turning ring.
 * Pure CSS (see .ambient in globals.css): transform-only animation, no pointer events, frozen under reduced motion.
 */
export function Ambient({ ring = true, className = "" }: { ring?: boolean; className?: string }) {
  return (
    <div aria-hidden className={`ambient ${className}`}>
      <span className="orb orb-a" />
      <span className="orb orb-b" />
      <span className="orb orb-c" />
      {ring && <span className="ring" />}
    </div>
  );
}
