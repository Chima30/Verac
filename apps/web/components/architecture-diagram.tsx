/**
 * Verac in one picture: the chain of control from an instruction to a receipt. Server-rendered SVG that follows the
 * theme tokens (peach = a person decides, mint = proven on chain). The same drawing is docs/architecture.svg for the README.
 */
const STEPS: Array<{ title: string; sub?: string; tone: "plain" | "peach" | "mint"; server?: boolean }> = [
  { title: "An instruction or an application", tone: "plain" },
  { title: "Six agents investigate", sub: "AI advises. No payment tool.", tone: "plain", server: true },
  { title: "Fixed rules decide", sub: "Eligible, hold or reject", tone: "plain", server: true },
  { title: "Two administrators sign", sub: "Post-quantum keys, on their own devices", tone: "peach" },
  { title: "QoreChain enforces", sub: "Signatures, caps, vault-only windows", tone: "mint" },
  { title: "A receipt on Live Proof", sub: "Re-read from the chain", tone: "plain" },
];

export function ArchitectureDiagram({ className = "" }: { className?: string }) {
  const W = 560, boxW = 380, x = (W - boxW) / 2, gap = 30;
  let y = 8;
  const boxes = STEPS.map((s) => { const h = s.sub ? 60 : 46; const b = { ...s, y, h }; y += h + gap; return b; });
  const H = y - gap + 8;
  const serverTop = boxes[1]!.y - 30, serverBottom = boxes[2]!.y + boxes[2]!.h + 12;
  const fill = (t: string) => (t === "peach" ? "var(--tint-peach)" : t === "mint" ? "var(--tint-mint)" : "var(--surface)");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" className={`h-auto w-full max-w-[560px] ${className}`}>
      <title>Verac architecture: the chain of control</title>
      <desc>An instruction goes to six agents and fixed rules inside the Verac server, which holds no administrator key. Two administrators sign with post-quantum keys on their own devices, QoreChain enforces signatures, caps and windows, and every result is a receipt on Live Proof.</desc>
      <defs><marker id="arch-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></marker></defs>
      <rect x={x - 24} y={serverTop} width={boxW + 48} height={serverBottom - serverTop} rx="4" fill="none" stroke="var(--border-strong)" strokeDasharray="5 5" />
      <text x={x - 12} y={serverTop + 17} className="fill-[var(--muted)] font-mono text-[11px] font-medium uppercase">Verac server · holds no admin key</text>
      {boxes.map((b, i) => (
        <g key={b.title}>
          <rect x={x} y={b.y} width={boxW} height={b.h} rx="4" fill={fill(b.tone)} stroke={b.tone === "plain" ? "var(--border)" : "none"} />
          <text x={W / 2} y={b.y + (b.sub ? 24 : b.h / 2 + 5)} textAnchor="middle" className={`text-[15px] font-medium ${b.tone === "plain" ? "fill-[var(--text)]" : "fill-[var(--tint-ink)]"}`}>{b.title}</text>
          {b.sub && <text x={W / 2} y={b.y + 44} textAnchor="middle" className={`text-[12.5px] ${b.tone === "plain" ? "fill-[var(--muted)]" : "fill-[var(--tint-sub)]"}`}>{b.sub}</text>}
          {i < boxes.length - 1 && <line x1={W / 2} x2={W / 2} y1={b.y + b.h + 3} y2={boxes[i + 1]!.y - 4} stroke="var(--muted)" strokeWidth="1.25" markerEnd="url(#arch-arrow)" />}
        </g>
      ))}
    </svg>
  );
}
