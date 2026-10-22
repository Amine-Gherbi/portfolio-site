# portfolio-site (P1) — agent context

Purpose: a static editorial hub that states one falsifiable engineering claim, then proves it with three case studies pulled from the sibling repos through a committed asset snapshot.

## Architecture
- Astro 5, static output. No SSR, no adapters beyond the deploy target.
- Tailwind v4 through `@tailwindcss/vite` (no `tailwind.config.js`, no `@apply` sprawl).
- Content is committed JSON in `src/content/projects/*.json`, loaded with `glob()` + a Zod schema in `src/content.config.ts`. `_shared/assets` is never read at build time.
- Images live in `public/assets/<slug>/` and in `src/content/projects`; `astro:assets` handles sizing, `satori` + `@resvg/resvg-js` render OG images at build.
- `scripts/sync-assets` (human-run) copies from `P:/portfolio/_shared/assets` and sets `updatedAt` from the source repo's last commit, never `now()`.

## Commands
- `npm run verify` → `astro check && tsc --noEmit && npm run check:assets && astro build` (this is the gate the supervisor runs)
- `npm run dev` → 4321 · `npm run build` · `npm run preview`
- `npm run check:assets` → validates the snapshot; fails on an invalid manifest or a missing `shots[].file`
- `npm run sync:assets -- --from P:/portfolio/_shared/assets`

## Invariants
1. A clean clone builds without `_shared` present; the hub reads only committed snapshots.
2. Exactly four shots per project, `hero.webp` first, then `shot-01..03.webp`, 2880×1800, WebP, seeded data, no browser chrome.
3. `proof.measured[].value` is a string, and every entry with a number carries `method` + an `artifact` path that exists.
4. `proof.limits` has at least three honest entries. Test counts never appear as metrics.
5. No emoji, no superlative without a number in the same sentence, max 3 badges, no "built with ❤️".
6. One `h1` per page, skip link, visible focus, AA contrast, reduced-motion honoured.

## Pitfalls
- Astro 5: `entry.render()` is gone — use `const { Content } = await render(entry)`.
- `@vercel/og` does not run under workerd; use `satori` + `@resvg/resvg-js`.
- A missing manifest must degrade to a "coming soon" card; an *invalid* manifest must fail the build. Never soften the hard failure.
- `srcset` + explicit width/height on every image, or the CLS budget (0.02) breaks.
- Node 22 only (`.nvmrc`); Astro 5 tooling is not validated on Node 26.

## Decisions
ADRs: `docs/adr/NNNN-*.md`. Invariants: `docs/INVARIANTS.md`. Proof map: `docs/PROOF.md`.
