# Verac design system

A research console on white paper: black type, hairlines instead of shadows, 4px corners, pastel tiles that name a
category, mono labels and buttons, and one black band per page for the evidence. Dark mode is black, not blue.

- Tokens: `apps/web/app/globals.css`
- Server-safe components: `apps/web/components/ui.tsx`
- Client components (copy, hash, count-up, slide-in panel): `apps/web/components/ui-client.tsx`
- Logo and favicon: `apps/web/components/logo.tsx`, `apps/web/app/icon.svg`
- Shell: `apps/web/components/shell.tsx` · Navigation and role-gated actions: `apps/web/lib/nav.ts`
- Product record for design work: `apps/web/PRODUCT.md`

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg`, `--surface` | #ffffff | #000000, #0a0a0a | Page and cards |
| `--text` | #000000 | #ffffff | Headings and body |
| `--muted` | #4d4d4d | #b3b3b3 | Continuation lines, descriptions, metadata |
| `--border` | #d6d6d6 | #2a2a2a | Hairlines, table dividers, inputs |
| `--accent` | #bdbbff | #bdbbff | Periwinkle punctuation only: the active-page dash, focus, labels on black. Never a surface or body text on white |
| `--tint-sky` | #c1dff9 | #10263d | Figures about treasury money |
| `--tint-peach` | #ffdccd | #3a2216 | Figures waiting for a person |
| `--tint-blush` | #fde3f6 | #36182f | Figures about grants |
| `--tint-mint` | #c8f6f9 | #0e3336 | Proven on chain; also the active tab or stage |
| `--live` / `--warn` / `--bad` / `--sim` | on mint / peach / red / sky fills | deepened | Status words (LIVE TESTNET, REQUIRES APPROVAL, FAILED, SIMULATION) |
| `--band` | #000000 | #000000 | The dark band: charts and the Live Proof verdict |

Colour carries meaning, never decoration. The one gradient in the product is the treasury balance chart's orange
glow (`#ff8a3d` to transparent), drawn only from real vault history.

## Type

- **Inter Tight** for everything people read, weights 400 and 500 only (heavier classes resolve to 500). Page titles 40px
  (28px on phones) at -0.02em; the dashboard headline 64px at -0.03em, one black line and one grey continuation line.
  Body 15–18px at -0.01em, line height 1.3–1.4.
- **Geist Mono** for labels, buttons, badges, table headers, amounts and hashes: 11px labels and 13px buttons, weight 500,
  uppercase, slightly positive tracking (`.label-mono`).
- Figures use tabular numbers.

## Shape, depth and layout

- 4px corners on every card, tile, button, badge, input and panel. Pills only for dots.
- No shadows except the sticky top bar's soft horizontal glow (`--shadow-nav`).
- Content up to 1680px wide (side margins grow on large screens); paragraphs keep a readable line length. Every page: header (title, one plain line, status badge, main buttons), an alert banner only when
  something needs doing, a row of tinted figures, the work at full width, then collapsible "How it works" rows.
- Forms never sit in a side column: they open in a **slide-in panel** (`Panel`), from the right on desktop and from the
  bottom on phones. Any link to `#<panel id>` opens it, so server-rendered buttons need no client code.
- Modules agents do not drive sit under **Labs**, collapsed in the sidebar, and say so on every page.

## Components

| Component | Use |
|---|---|
| `PageHeader` | Title, one plain line, badge, meta and actions. No label above the title |
| `Stat` (`tint`), `StatRow` | Pastel figure tiles; numbers count up once; rows arrive one after another |
| `Card`, `SectionHeading`, `Metric`, `KV` | White surfaces with hairlines, figures and facts |
| `Badge`, `StatusDot`, `Notice`, `FlashMessages` | Status and messages. Badge wording is a product rule: never LIVE TESTNET unless it was read from or ran on the chain |
| `Pipeline` | Stages as one joined strip; the current stage is filled mint |
| `ProofStamp` | A confirmed transaction: mono hash on mint with a tick that draws itself |
| `Panel` | The slide-in panel for forms (native `<dialog>`: focus trapped, Escape closes) |
| `HowItWorks` | A process explained in one line that opens |
| `EmptyState`, `Skeleton`, `CardSkeleton` | Empty and loading states that invite the next step |
| Buttons | `btnCls` (black, mono, uppercase), `btnSecondaryCls` (hairline), `btnGhostCls`, `btnDangerCls`; `chipCls` tabs fill mint when active |

## Motion

Purposeful, short, and off under `prefers-reduced-motion`: the page rises into place once (header, then figures, then
content), figures count up, panels slide in, proof ticks draw themselves, the balance chart draws its line in. Nothing
loops, and nothing hides content while waiting to animate.

## Charts

Charts sit in `ChartCard`, the black band. `InteractiveAreaChart` draws the treasury balance as a glowing orange area under
a thin orange line, with vertical markers carrying their real values, mono axis labels and no gridlines; arrow keys scrub
it. `BarChart` draws grouped bars without client JavaScript, with a hidden table for screen readers. Data comes only from
real records; `ChartEmpty` says why there is nothing to draw.

## Accessibility

WCAG 2.1 AA: body text at least 4.5:1 in both themes (the periwinkle accent is never body text on white), visible focus
rings, keyboard use everywhere (panels are native dialogs), screen-reader text for counted-up figures and proof stamps,
and pages usable on phones and at 200% zoom.
