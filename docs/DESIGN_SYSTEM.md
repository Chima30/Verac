# Verac design system

Verac uses the **Sodium** design system from design.how (compact and ruled, built for infrastructure and data tools). Its files are `apps/web/components/sodium/` (tokens, base, Tailwind entry) and `apps/web/lib/sodium/portal.tsx`. The two fonts (Commit Mono and Inter Display, both SIL OFL 1.1) are served from `apps/web/public/fonts/sodium/`. The Claude skill that tells an agent how to build with it is `.claude/skills/sodium/SKILL.md`.

## How it is wired

- The root layout imports `components/sodium/styles.css`, puts the `sodium` class on `<body>` and wraps the app in `SodiumPortalProvider`.
- Dark mode is the `data-theme="dark"` attribute (set by next-themes, following the system until the user chooses).
- `components/ui.tsx` (Badge, Card, Stat, KV, EmptyState, PageHeader, `btnCls`, `inputCls`) and `components/shell.tsx` are the shared pieces, written on Sodium roles. New pages should reuse them.

## Rules that matter here

- Roles, not raw values: `text-text-1`, `text-text-2`, `bg-panel`, `bg-hover`, `border-line`. No hex values, no `dark:` variants.
- Zero radius and no shadows. Structure is 1px rules (`frame`, `panel-head`, `rule-row`).
- Interface words are mono capitals through the `type-label*` and `type-micro` roles; sentences stay in the sans.
- Yellow is the one primary action (`btnCls`, the slab) and the selection. Status uses the ok, warn and fail roles.
- Status wording is a product rule and unchanged: LIVE TESTNET, SIMULATION, PENDING, REQUIRES APPROVAL, FAILED, UNAVAILABLE. Do not label something LIVE TESTNET unless the page just read it from the chain or the action really ran there.
