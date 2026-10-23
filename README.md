# portfolio-site

A static editorial hub that states one falsifiable engineering claim and proves it with three case studies. Astro 5, Tailwind v4, committed JSON/MDX content, no client-side JavaScript.

Nothing is published yet. [docs/DEPLOY.md](docs/DEPLOY.md) is the five-step path to a static host.

## Run locally

```sh
npm install
npm run dev          # http://localhost:4321
```

## Commands

```sh
npm install
npm run dev          # http://localhost:4321
npm run build        # generates public/resume.pdf, then builds dist/
npm run preview
npm run verify       # the full gate (see below)
```

`npm run verify` runs, in order:

1. `astro check`
2. `tsc --noEmit`
3. `check:assets` — snapshot contract
4. `check:content` — case-study frontmatter and section order
5. `check:copy` — banned words, emoji, badges, numbers without a method, `/about` word count
6. `build:resume` — `public/resume.pdf` from `src/data/resume.json`
7. `astro build`
8. `check:content --dist` — rendered section order, h1, captions
9. `check:copy --dist` — rendered copy and badge counts
10. `check:a11y` — static HTML accessibility checks
11. `check:js` — gzip JavaScript budget (30 KB)

## Routes

| Route | Output |
| --- | --- |
| `/` | index with `Person` JSON-LD |
| `/projects/<slug>/` | case study with `CreativeWork` JSON-LD |
| `/about/` | positioning, at most 250 words |
| `/resume/` | HTML resume and `/resume.pdf` |
| `/colophon/` | agent/human split and build facts |
| `/sitemap.xml`, `/robots.txt` | static crawl metadata |
| `/og/home.png`, `/og/<slug>.png` | 1200×630 social images, 4 files |

## Build-time images

`src/pages/og/[slug].png.ts` renders social cards with `satori` + `@resvg/resvg-js`. satori needs real font bytes; the build reads an installed TTF pair (Georgia by default on Windows, then Times, DejaVu Serif, Liberation Serif, Arial). Nothing is downloaded. Point `OG_FONT_DIR` at another directory of TTF files if none of the defaults exist:

```sh
OG_FONT_DIR=/path/to/fonts npm run build
```

The resume PDF is drawn directly with `pdf-lib` from `src/data/resume.json`, the same data the HTML page renders. No headless browser is involved, and document dates come from `generatedAt`, not the clock.

## Public origin

`astro.config.mjs` sets `site` to the reserved placeholder `https://portfolio.example` because no deployment URL exists. Override it for another host:

```sh
SITE_URL=https://example.com npm run build
```

`robots.txt` is static and points at the same origin, `https://portfolio.example/sitemap.xml`; edit it when the origin changes.

## Lighthouse and axe

Lighthouse 13.5.0 (default mobile configuration) was run against `http://localhost:4321/` served by `npm run preview` on 2026-10-23: performance 100, accessibility 100, best practices 100, SEO 100; LCP 0.9 s, CLS 0. Axe has not been run, so that result is unverified. Re-run both against a preview server:

```sh
npm run build
npm run preview
# in a second terminal:
npx lighthouse http://localhost:4321/ --chrome-flags="--headless" --output=html --output-path=./lighthouse.html
npx @axe-core/cli http://localhost:4321/ --exit
```

Repeat `npx @axe-core/cli` for `/about/`, `/resume/`, `/colophon/`, and each `/projects/<slug>/`.

## Docs

- `docs/DEPLOY.md` — five steps to publish a static build, with the host settings
- `docs/INVARIANTS.md` — rules that must not break
- `docs/BUILD-LOG.md` — what the agent produced and what the supervisor checked
- `docs/INTERVIEW.md` — drill questions
- `docs/VERIFY.txt` — earlier verify transcript
