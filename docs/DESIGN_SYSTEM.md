# Verac design system

The look follows the mood of the free Metrivo template on the Framer marketplace: calm, soft and rounded. It is inspiration only; no template content or assets are copied. Tokens live in `apps/web/app/globals.css`, shared components in `apps/web/components/ui.tsx`, the shell in `apps/web/components/shell.tsx`.

## Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #f2f4ef | #0a2219 | Page (sage) |
| `--surface` | #ffffff | #10372a | Cards, inputs |
| `--surface-2` | #e8ede6 | #174536 | Hover rows |
| `--border` | #d5ded3 | #25503f | Hairlines |
| `--text` | #10372a | #f2f4ef | Deep-green ink |
| `--muted` | #5d7166 | #9fb8aa | Secondary text |
| `--accent` | #10372a | #8fd3ae | Primary action (deep green, mint in dark) |
| `--live` `--sim` `--warn` `--bad` and `-bg` | | | Status only |

Type is Inter (400, 500, 600) with tight tracking on headings; IBM Plex Mono only for hashes, addresses and key-value facts. Radii: controls 12px, cards 16px, buttons and status pills fully round. Motion is 160ms on one easing, colour and opacity only; reduced motion turns it off.

## Components

- **Badge**: a status pill with a dot. The wording is a product rule: LIVE TESTNET, SIMULATION, PENDING, REQUIRES APPROVAL, FAILED, UNAVAILABLE. Do not label something LIVE TESTNET unless the page just read it from the chain or the action really ran there.
- **Card, Stat, KV, EmptyState, PageHeader**: white rounded cards with a hairline border. `Stat large` is for the one figure that matters on a screen.
- **btnCls**: the primary action, a deep-green pill. **inputCls**: rounded fields with a green focus ring.
- **Shell**: sage page, a floating pill header, a sidebar whose active row is a white card.

## Do and don't

| Do | Don't |
|---|---|
| Use the tokens and shared components | Add a hex value or one-off radius in a page |
| Say what an action did and whether it moved money | Say "done" for something only recorded |
| Keep one accent; status colours mean status | Add gradients, glow or emoji |

## Motion

Motion explains state; it does not decorate. All of it is in `apps/web/app/globals.css`: 200ms fades up for a new page, for results and messages that appear after an action (anything with `role="status"` or `role="alert"`), for the mobile menu, and a 120ms row highlight in tables. One easing, transform and opacity only, and nothing runs for people who ask for reduced motion. Content is never hidden by a script, and there are no scroll effects or page-load sequences in the app screens.
