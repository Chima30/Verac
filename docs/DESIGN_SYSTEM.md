# Verac design system

Graphite neutrals, one restrained teal accent, and colour that only ever carries meaning. The direction and its reasoning are in `docs/design/UI_AUDIT_2026-11-15.md`.

- Tokens: `apps/web/app/globals.css`
- Server-safe components: `apps/web/components/ui.tsx`
- Client components (copy, hash): `apps/web/components/ui-client.tsx`
- Shell: `apps/web/components/shell.tsx`
- Command palette: `apps/web/components/command-palette.tsx`
- Navigation and role-gated actions: `apps/web/lib/nav.ts`

## Tokens

| Token (Tailwind name) | Light | Dark | Use |
|---|---|---|---|
| `--bg` (`bg-bg`) | #f6f6f3 | #0e0f11 | Page |
| `--surface` (`bg-surface`) | #ffffff | #15171a | Cards, inputs, menus |
| `--surface-2` / `--surface-3` | #f0f0ec / #e8e8e3 | #1b1e22 / #23272c | Hover, wells, skeletons |
| `--border` (`border-line`) / `--border-strong` | #e2e2dc / #cfcfc7 | #272a2f / #363a41 | Hairlines, hover borders |
| `--text` (`text-ink`) | #17191c | #ebebe8 | Body text |
| `--muted` / `--subtle` | #5f636a / #8a8e95 | #9b9fa6 / #6f737a | Secondary text, metadata |
| `--accent` (`bg-accent`) | #0d6b66 | #4dbdb2 | Primary action, active nav, focus |
| `--live` | green | green | Confirmed on testnet |
| `--sim` | slate blue | slate blue | Simulation: recorded in the app only |
| `--warn` | amber | amber | Needs a person, medium risk |
| `--bad` | red | red | Failed, refused, high risk |
| `--info` | teal tint | teal tint | Neutral information about a state |

The semantic colours never decorate. Green is for things the chain confirmed, not for any positive number. Simulation is blue so it can never be mistaken for live (green) or a warning (amber).

**Type.** Geist (400, 500, 600) for the interface and Geist Mono for hashes, addresses and identifiers. Body text is 14.5px, metadata 12–12.5px; nothing in the app body is smaller. Figures use tabular numbers.

**Radii.** Controls 6–8px, cards 12px, overlays 16px.

**Motion.** 140–200ms on one easing, using transform and opacity only, and switched off under `prefers-reduced-motion`.

**Theme.** Light, dark or system, stored by next-themes under `verac-theme` and applied before first paint. The collapsed sidebar is restored before paint from `verac-sidebar`.

## Components

| Component | Use |
|---|---|
| `PageHeader` | Title, plain-language description, and optional `eyebrow`, `badge`, `meta` and `actions`. |
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
