# Interview drill — portfolio-site (P1)

Twenty questions a reviewer could ask about this repository, each answered in ≤6 lines with a `file:line` or a
runnable check. Answers without such a citation are labelled **unverified**.

State: written against commit `014a0b8`, Node 22.23.4, verified by running every command below.

---

**1. Why commit JSON snapshots instead of reading `_shared/assets` at build time?**
Because the hub must build from a clean clone with no sibling directories. `src/lib/manifest.ts:50` resolves assets under `public/assets`, and `src/content.config.ts:6` globs `src/content/projects`. Check: `grep -rn "_shared" src scripts` → no matches.

**2. What is the difference between a missing manifest and an invalid one?**
Missing is a supported state (card says "coming soon"): `src/lib/manifest.ts:80-82` returns `null` on `ENOENT`, and `src/components/ProjectCard.astro:36-38` renders the placeholder. Invalid is fatal: `src/lib/manifest.ts:93-98` throws, `scripts/check-assets.mjs:155` exits 1. A broken image is worse than no card.

**3. How is an invalid manifest caught before the build?**
`npm run check:assets` runs `scripts/check-assets.mjs` before `astro build` inside `npm run verify` (`package.json`). It validates slug, `generatedAt`, `seeded`, shot count and order (`:53-54`, `:64-66`), dimensions (`:68`), alt text (`:71`), and that each shot exists (`:133`).

**4. Why a `glob` loader rather than Markdown frontmatter?**
The card fields are a contract shared with the asset pipeline (`projectSchema` at `src/lib/manifest.ts:9-15`). JSON keeps the shape identical to what `sync:assets` will write, so a schema change breaks one place, not two.

**5. How do you stop `updatedAt` from churning the diff every build?**
It is committed content, not derived at build time: `src/content/projects/*.json` carries the date, and `src/pages/index.astro:29-31` only formats it. `grep -rn "Date.now" src` → no matches.

**6. Why is the positioning sentence in the template and not in content?**
It is one sentence that must appear verbatim on the built page and be falsifiable against three projects; keeping it at `src/pages/index.astro:7-8` makes a change to it an explicit code change. Verification: `grep -c "I build full-stack systems" dist/index.html` → 1.

**7. What makes the sentence falsifiable?**
It names three checkable outcomes — no oversell at 20 concurrent buyers, a red PR that cannot merge, no uncited answer. Each maps to a test in P2/P3/P4 (`_planning/02-ecommerce-platform.md` §3, `03-cicd-pipeline.md` C2, `04-docqa-assistant.md` R3). Until those exist, the claim is aspirational: **unverified**.

**8. How is one `h1` per page guaranteed?**
`h1` appears only in page components (`src/pages/index.astro:43`, `src/pages/404.astro`), while `src/layouts/Base.astro` provides header, `main` (`:33`) and footer. Check: `grep -o '<h1' dist/index.html | wc -l` → 1.

**9. How is keyboard access handled?**
A skip link precedes the shell (`src/layouts/Base.astro:27`), targets `#main` which has `tabindex="-1"` (`:33`), and a global `:focus-visible` rule (`src/styles/global.css:66`) avoids outline removal per component. Interactive elements are anchors only.

**10. Where does the layout scale come from?**
Three tokens: `--measure: 720px` and `--project-grid: 1120px` at `src/styles/global.css:20-21`, body `17px/1.65` at `:45-46`. Every prose block consumes the measure rather than hard-coding a width (`:202`, `:335`, `:358`, `:417`).

**11. How is reduced motion respected?**
The reveal animation is declared only inside `@media (prefers-reduced-motion: no-preference)` (`src/styles/global.css:437`) and neutralised under `reduce` (`:459`). There is no JS animation to disable.

**12. How are images kept from shifting layout?**
`src/components/ProjectCard.astro:20-34` emits explicit `width`/`height` (2880×1800 from the manifest), a `srcset`, `sizes`, `loading="lazy"` and `decoding="async"`. Three such tags in `dist/index.html` (check: `grep -o 'width="2880" height="1800"' dist/index.html | wc -l` → 3).

**13. Why only one `srcset` candidate?**
Because there is only one committed file per shot today; downscaled variants belong to H4 with `astro:assets`. Single-candidate `srcset` is honest but adds nothing yet: **known weakness**.

**14. How does the hub avoid coupling to the other repositories?**
It never imports them and never reads `_shared` at build time; the only contact is the manifest shape validated at `src/lib/manifest.ts:28-45`. Deleting any sibling repo leaves this build green.

**15. Why Tailwind v4 through the Vite plugin and no `tailwind.config.js`?**
v4 is CSS-first; the plugin is registered in `astro.config.mjs` and tokens live in `src/styles/global.css` under `@theme`-style custom properties. A JS config would be a second source of truth for the same tokens.

**16. What enforces "no `any`"?**
Nothing automatic yet. `tsconfig.json` sets `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, and the supervisor greps `:\s*any\b` in `src/` (currently no matches), but no lint rule fails the build. **Unverified as a gate.**

**17. What pins Node 22, and why does it matter?**
`.nvmrc` = `22` and `package.json` `engines.node` = `>=22 <23`; the local shell resolves `v22.23.4` through `fnm`. Astro 5 / sharp are not validated on the bundled Node 26, which is what would otherwise be picked up.

**18. How do you know the page is not blank?**
A 1440×900 screenshot captured from the built output exists at `_orchestration/evidence/P1-H1-index-1440x900.png` (411 KB), with DOM assertions: one `h1`, three `article.project-card`, three images. There is no automated visual regression yet: **unverified in CI**.

**19. What happens if someone commits 1440×900 shots instead of 2880×1800?**
The build fails: `src/lib/manifest.ts:21-22` uses `z.literal(2880)`/`z.literal(1800)`, and `scripts/check-assets.mjs:68` reports `must declare 2880x1800`. The reason for 2× is the retina card grid, not decoration.

**20. What is the weakest part of this repository right now?**
The content is fixture. Slugs (`ledger-lock`, `merge-gate`, `citation-desk`) do not match the real repos, the manifests carry no `proof{}` block, and `updatedAt` dates are invented. All three must be replaced in P5 before any claim on this site is true: **unverified**.
