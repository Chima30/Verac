# Verac design system

The tokens live in `apps/web/app/globals.css`, the shared components in `apps/web/components/ui.tsx` and the shell in `apps/web/components/shell.tsx`. This file says what they are for, so new pages reuse them instead of inventing values.

## Direction

- **Product.** A control room where finance and operations teams give AI agents limited, auditable authority on QoreChain testnet.
- **Character.** Exact, calm, a little severe.
- **World.** Ledgers and instrument panels.
- **Moment.** One large instrument reading on the dashboard (the latest block), nothing else on the chrome competes with it.
- **Signature.** A small square tick before every status label, like a tick mark in a ledger.

## Tokens

### Colour

One tinted neutral ramp, one accent. Semantic colours only ever carry meaning.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #f7f7f5 | #121414 | Page |
| `--surface` | #ffffff | #1a1d1d | Cards, sidebar, inputs |
| `--surface-2` | #f0f0ec | #222626 | Hover and active rows |
| `--border` | #deded8 | #2f3434 | Hairlines |
| `--text` | #1b1d1f | #ececE8 | Primary text |
| `--muted` | #5d6368 | #9aa1a5 | Secondary text, labels |
| `--accent` | #0f6b62 | #4fb8aa | Primary action, focus ring |
| `--live`, `--sim`, `--warn`, `--bad` and their `-bg` | | | Status only |

Accent text on the accent background meets 4.5:1 contrast. Never use a hue gradient, glow or coloured shadow.

### Type

IBM Plex Sans for the interface, IBM Plex Mono for figures, hashes and addresses. Weights 400 and 500 (600 only for rare emphasis). Body 15px.

| Role | Size | Where |
|---|---|---|
| Page title | 24px / 500, tight tracking | `PageHeader` |
| Large figure | 36px mono / 500 | `Stat large` |
| Figure | 20px mono | `Stat` |
| Body | 15px | everywhere |
| Small | 14px and 13px mono | descriptions, key-value rows |
| Label | 12px, sentence case | nav sections, field labels |
| Status | 11px, tracked capitals | `Badge` only |

Tables and definition lists use tabular figures so numbers align.

### Spacing

A 4px grid. Card padding 20px, page padding 16 on phones and 32 on desktop, gap between cards 16, nav rows 32px tall with 2px between them, section labels 24px above and 8px below.

### Radius

Controls 8px, cards 12px (set through `--radius-md` and `--radius-lg`, so `rounded-md` and `rounded-lg` follow them). A control inside a card keeps 8px.

### Motion

150ms, one easing curve (`cubic-bezier(0.2, 0, 0, 1)`). Only colour, background, border, opacity and transform change. A press scales to 0.98. Nothing loops, bounces or animates layout. Reduced-motion users get none.

## Components

### Badge

Status label. The wording is a product rule, so a reader can always tell what is real.

| Tone | Label | Means |
|---|---|---|
| `live` | LIVE TESTNET | Read from, or done on, Diana testnet |
| `sim` | SIMULATION | Recorded in this app only. No QOR moves |
| `pending` | PENDING | Not built or not finished |
| `approval` | REQUIRES APPROVAL | Waiting for a human |
| `failed` | FAILED | Did not succeed |
| `unavailable` | UNAVAILABLE | Cannot be reached or not configured |
| `neutral` | custom text | Informational, for example DECRYPTED ONLY IN YOUR BROWSER |

Do not label something LIVE TESTNET unless the page just read it from the chain or the action really ran there.

### Card, Stat, KV, EmptyState, PageHeader

`Card` has an optional title row with a right slot for a badge. `Stat` is a label, a figure and a short note, with `large` for the one figure that matters on a screen. `KV` is for facts, `EmptyState` says what is missing and what to do next. `PageHeader` is a title, an optional badge and one sentence of description.

### Buttons and inputs

`btnCls` is the one primary action per area. Secondary actions are bordered, with `hover:bg-[var(--neutral-bg)]`. `inputCls` fields have a hover border and an accent border on focus. Every control has a visible keyboard focus ring (2px accent, 2px offset).

### Navigation

Sidebar 256px on desktop, a drawer on phones. Rows are 32px with a 16px icon at 1.5 stroke. The active row has a surface step and a hairline, never a gradient.

## Accessibility

- Text and status colours meet WCAG AA contrast in both themes.
- Every icon-only button has an `aria-label`. Status is never colour alone: each badge has words and the tick.
- Forms use real labels, errors use `role="alert"` and confirmations `role="status"`.
- Pages work at 375px wide with no horizontal scroll.

## Do and don't

| Do | Don't |
|---|---|
| Use the tokens and shared components | Add a hex value or a one-off radius in a page |
| Say what an action did, and whether it moved money | Say "done" for something only recorded |
| Keep one accent and let status colours mean status | Add decoration, glow, gradients or emoji |
| Use sentence case for labels | Use tracked uppercase except in `Badge` |
