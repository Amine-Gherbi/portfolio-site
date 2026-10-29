# Invariants — portfolio-site (P1)

Rules that must never break. Each maps to the line that implements it and a command that proves it.
State: verified 2026-10-22 against commit `014a0b8` (Node 22.23.4).

| # | Invariant | Where | Verify |
|---|-----------|-------|--------|
| 1 | The build reads only committed snapshots — never `P:/portfolio/_shared`, never a sibling repo. | `src/lib/manifest.ts:50` (assets root is `public/assets`), `src/content.config.ts:6` (`glob` over `src/content/projects`) | `grep -rn "_shared" src scripts` → no matches |
| 2 | A missing manifest degrades to a "coming soon" card and does not fail the build. | `src/lib/manifest.ts:80-82` (ENOENT → `null`), `src/components/ProjectCard.astro:36-38` | remove a manifest, `npm run check:assets` → exit 0, message `no manifest — card will say "coming soon"` |
| 3 | An invalid manifest, a malformed JSON file, or a shot absent from disk fails hard. | `src/lib/manifest.ts:89-98`, `:106-115`; `scripts/check-assets.mjs:133`, `:155` | `scripts/check-assets.mjs` exit 1 with the offending field named |
| 4 | Exactly four shots, named `hero.webp` then `shot-01..03.webp`, 2880×1800 WebP, in that order. | `src/lib/manifest.ts:19-24` (`z.literal(2880)`/`(1800)`, filename regex), `:33` (`.length(4)`), `:35-45` (order); `scripts/check-assets.mjs:53-54`, `:64-66`, `:68` | `npm run check:assets` → `shots must contain exactly 4 entries` when reduced to three |
| 5 | No rendered date: no ISO date exists in `src/` or `public/`, sync writes none, and nothing calls `now()` at build. | `scripts/sync-assets.mjs` (removes a legacy `updatedAt`), `src/lib/manifest.ts` (no date field) | `grep -rnE "20[0-9]{2}-[0-9]{2}-[0-9]{2}" src public` → no matches |
| 6 | The positioning sentence appears verbatim in the built index. | `src/pages/index.astro:7-8`, rendered at `:43` | `grep -c "I build full-stack systems and can prove their correctness" dist/index.html` → 1 |
| 7 | One `h1` per page; a skip link to `#main` precedes the content. | `src/layouts/Base.astro:27` (skip link), `:33` (`<main id="main">`); pages carry the only `h1` | `grep -o '<h1' dist/index.html \| wc -l` → 1 |
| 8 | Prose measure 720px, project grid 1120px, body 17px/1.65. | `src/styles/global.css:20-21`, `:45-46` | those tokens are the only source of those widths (`--measure`, `--project-grid`) |
| 9 | Motion is opt-in: the scroll-in fade only exists under `prefers-reduced-motion: no-preference`, and is removed under `reduce`. | `src/styles/global.css:437`, `:459` | `grep -n "prefers-reduced-motion" src/styles/global.css` → both branches |
| 10 | Focus is always visible. | `src/styles/global.css:66`, `:108` | tab through the page; `:focus-visible` outline is defined globally, not per component |
| 11 | Images declare intrinsic size and a `srcset`, so layout is stable before decode. | `src/components/ProjectCard.astro:20-34` | `grep -o 'width="2880" height="1800"' dist/index.html` → three hits |
| 12 | Node 22 only. | `.nvmrc` (`22`), `package.json` `engines.node` (`>=22 <23`) | `node -v` in a fresh shell → v22.x |
| 13 | No emoji, no superlative without a number in the same sentence, max 3 badges. | `_planning/05-CONVENTIONS.md` §1 | codepoint scan of `src/` and `dist/` → no emoji |
| 14 | No `any` in `src/`. | `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | `grep -rn ":\s*any\b" src/` → nothing. **Not yet an automated gate**: no ESLint rule enforces it, so this is a check, not a guarantee (unverified as CI enforcement) |
