# Verac design system

Graphite neutrals, one restrained teal accent, and colour that only ever carries meaning. The direction and its reasoning are in `docs/design/UI_AUDIT_2026-11-15.md`.

- Tokens: `apps/web/app/globals.css`
- Server-safe components: `apps/web/components/ui.tsx`
- Client components (copy, hash): `apps/web/components/ui-client.tsx`
- Shell: `apps/web/components/shell.tsx`
- Command palette: `apps/web/components/command-palette.tsx`
- Navigation and role-gated actions: `apps/web/lib/nav.ts`

## Tokens

High contrast in both themes: a pure white or black canvas, near-black or near-white text, bright secondary text, and saturated colour kept for icon tiles and status.

| Token (Tailwind name) | Light | Dark | Use |
|---|---|---|---|
| `--bg` (`bg-bg`) | #ffffff | #000000 | Page |
| `--surface` (`bg-surface`) | #ffffff | #0b0b0c | Cards, inputs, menus |
| `--surface-2` / `--surface-3` | #f4f4f5 / #e9e9ec | #151517 / #1f1f22 | Hover, wells, skeletons |
| `--border` (`border-line`) / `--border-strong` | #e4e4e7 / #c9c9cf | #212124 / #34343a | Hairlines |
| `--text` (`text-ink`) | #09090b | #fafafa | Headings and body |
| `--muted` / `--subtle` | #3f3f46 / #71717a | #d4d4d8 / #a1a1aa | Descriptions, metadata |
| `--primary` (`bg-primary`) | #09090b | #f4f4f5 | Primary button: black on light, white on dark |
| `--accent` | #0f9488 | #2dd4bf | Active navigation, focus, links |
| `--tile-*` | blue, green, teal, violet, orange, pink, amber, red, slate | same | `IconTile` fills with white glyphs |
| `--live` `--sim` `--warn` `--bad` `--info` | | | Status only |

The semantic colours never decorate. Green is for things the chain confirmed, not for any positive number. Simulation is blue so it can never be mistaken for live (green) or a warning (amber).

**Type.** Geist (400 to 800) for the interface: page titles 32px bold, card titles 15.5px bold, body 15px and Geist Mono for hashes, addresses and identifiers. Body text is 14.5px, metadata 12–12.5px; nothing in the app body is smaller. Figures use tabular numbers.

**Radii.** Controls 6–8px, cards 12px, overlays 16px.

**Motion.** 140–200ms on one easing, using transform and opacity only, and switched off under `prefers-reduced-motion`.

**Theme.** Light, dark or system, stored by next-themes under `verac-theme` and applied before first paint. The collapsed sidebar is restored before paint from `verac-sidebar`.

## Components

| Component | Use |
|---|---|
| `PageHeader` | Title, plain-language description, and optional `eyebrow`, `badge`, `meta` and `actions`. A title that matches a navigation label gets its icon tile automatically. |
| `IconTile` | A saturated square with a white icon. Each page has a tile colour in `lib/nav.ts`; `Card` takes `icon` and `tile`. |
| `Card` | Titled surface with optional `description`, `right`, `footer`, and `flush` for edge-to-edge tables. |
| `Stat`, `Metric` | `Stat` is a bordered figure; `Metric` is a figure inside a larger panel. |
| `Badge`, `StatusDot` | Status. Badge wording is a product rule: LIVE TESTNET, SIMULATION, PENDING, REQUIRES APPROVAL, FAILED, UNAVAILABLE. Never label something LIVE TESTNET unless the page just read it from the chain or it really ran there. |
| `Notice`, `FlashMessages` | Inline messages (info, warn, bad, live, sim). |
| `Steps` | Vertical progression: `done`, `current`, `todo`, `blocked`, `failed`, or `step` (a numbered, neutral description of a process). |
| `Pipeline` | Stages left to right, either as counts per stage or as the current stage of one item. |
| `EmptyState`, `CardSkeleton`, `Skeleton` | Empty and loading states that keep the layout stable. |
| `KV`, `ShortHash`, `Hash` (with copy), `CopyButton`, `Source` | Facts and evidence. `Source` says where a number comes from. |
| `.data-table` | The one table style: sticky header, hairline rows, `.num` for right-aligned figures. |
| Buttons and chips | `btnCls` (primary), `btnSecondaryCls`, `btnGhostCls`, `btnDangerCls`, `chipCls(active)`. Fields use `inputCls` and `labelCls`. |

## Shell

- **Sidebar.** Five groups, each collapsible and persisted. It collapses to icons with tooltips (preference persisted), and becomes a focus-trapped drawer on mobile.
- **Top bar.** Organisation menu, breadcrumb, live Diana network status (polled every 60s while the tab is visible), approvals bell with a count, theme switch and account menu.
- **Command palette.** Ctrl/Cmd+K or `/` opens it. It searches pages and the actions your role may take, and the page enforces the same rule again on the server.
- **Route states.** `app/(app)/loading.tsx` and `app/(app)/error.tsx` handle loading and errors. Errors offer a read-only retry and never retry an action.

## Do and don't

| Do | Don't |
|---|---|
| Say where each figure comes from. | Show an estimate or a cached number as live. |
| Use a table when people compare rows. | Turn every list into a grid of identical cards. |
| Show an empty state that explains why it is empty and what to do next. | Write "Something went wrong" when the cause is known. |
| Label simulated and live results differently every time. | Use green for anything that merely looks positive. |
| Keep one primary action per area. | Add glows, gradients or decorative motion. |

## Charts

Every chart sits in `ChartCard` (`components/charts/chart-card.tsx`): a deep surface with a soft light at the top edge, forced to the dark tokens with `.theme-dark`, so charts look the same in both app themes.

- **`InteractiveAreaChart`** (`components/ui/interactive-area-chart.tsx`) draws a bold headline value and a change pill, compact pill range tabs, a smooth line with a soft glow and gradient fill, a dashed quiet grid, a resting end dot and a dark glass tooltip. Arrow keys scrub it.
- **`BarChart`** (`components/charts/bar-chart.tsx`) draws grouped bars without a chart library or client JavaScript. It shows a tooltip on hover or focus and carries a visually hidden table for screen readers.
- **`ChartEmpty`** says why there is nothing to draw. **`ChartSkeleton`** keeps a real chart's proportions while it loads.
- Data comes only from real records: `lib/charts.ts` turns the vault's dated balance steps into inflows and outflows, and revenue records into paid versus owed by due month. Both have unit tests.

## Sign-in and ambient motion

- The sign-in page (`app/login/page.tsx`) is always light (`.theme-light`). It has an editorial headline, concentric rings radiating from the form card (`.bg-rings`, with two slow ripples in `.rings-ripple`), faint connected dots and the form card. On phones the form comes straight after the headline.
- `Ambient` (`components/ambient.tsx`) draws three radial light fields drifting over 26–38 seconds and one faint turning ring, using pure CSS. Only `transform`, `rotate` and `translate` are animated, it takes no pointer events, it uses no `filter: blur`, and it is frozen under `prefers-reduced-motion`. The ring is hidden on phones. The dashboard header uses a masked, softer version.
