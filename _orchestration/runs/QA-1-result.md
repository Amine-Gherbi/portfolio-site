# QA-1 — mobile horizontal overflow on the case studies

Branch: `qa-1-mobile-overflow` (from `master`)
Scope: CSS widening only. No component, no markup, no client-side JavaScript, no deployment.

## Root cause

The proof lists render evidence paths as inline links around unbreakable code:

```html
<li>… <a href="…"><code>tests/integration/reservations.sweeper.test.ts</code></a></li>
```

At 390 px that token is 430 px wide at x=40, so the document grew to 470 px even
though `.metric-scroll` already contained the metric table. Measured culprits on
`/projects/ecommerce-platform/` at 390×844, outside the table's scroll container:

| Node | x range | width |
|---|---|---|
| `a > code` `tests/integration/reservations.sweeper.test.ts` | 40..470 | 430 |
| `a > code` `tests/integration/checkout.oversell.test.ts` | 40..442 | 402 |
| `a > code` `tests/integration/webhook.replay.test.ts` | 40..414 | 374 |

## Rule added

`src/styles/global.css:70-80`:

```css
/*
 * Evidence paths are long unbroken tokens and have to stay verbatim. Allow a
 * break at any character when the token would otherwise overflow its line:
 * prose, headings and captions keep their current wrapping, and nothing
 * breaks at desktop width where the tokens already fit.
 */
code,
.metric-checks a,
.metric-invariants a {
  overflow-wrap: anywhere;
}
```

`overflow-wrap: anywhere` is inherited, so a proof link that wraps a `<code>`
element also gets it; `.metric-table code` already carried the same declaration.
The paths are unchanged in the source and in the DOM. Headings, prose and
captions are untouched. The metric table keeps its `.metric-scroll` horizontal
container; the document does not scroll sideways.

## Measurements

Playwright Chromium 1.64.1, viewports 390×844 and 1440×900, `documentElement`
after `networkidle` + `document.fonts.ready`. Values are
`scrollWidth / clientWidth` in CSS px.

| Route | 390 before | 390 after | 1440 before | 1440 after | Desktop fingerprint |
|---|---|---|---|---|---|
| `/` | 390 / 390 | 390 / 390 | 1440 / 1440 | 1440 / 1440 | unchanged |
| `/about/` | 390 / 390 | 390 / 390 | 1440 / 1440 | 1440 / 1440 | unchanged |
| `/resume/` | 390 / 390 | 390 / 390 | 1440 / 1440 | 1440 / 1440 | unchanged |
| `/projects/thesis/` | 390 / 390 | 390 / 390 | 1440 / 1440 | 1440 / 1440 | unchanged |
| `/projects/ecommerce-platform/` | **470 / 390** | **390 / 390** | 1440 / 1440 | 1440 / 1440 | unchanged |
| `/projects/cicd-pipeline/` | 390 / 390 | 390 / 390 | 1440 / 1440 | 1440 / 1440 | unchanged |
| `/projects/docqa-assistant/` | 390 / 390 | 390 / 390 | 1440 / 1440 | 1440 / 1440 | unchanged |
| `/projects/ecommerce-platform/tour/` | 390 / 390 | 390 / 390 | 1440 / 1440 | 1440 / 1440 | unchanged |
| `/projects/cicd-pipeline/tour/` | 390 / 390 | 390 / 390 | 1440 / 1440 | 1440 / 1440 | unchanged |
| `/projects/docqa-assistant/tour/` | 390 / 390 | 390 / 390 | 1440 / 1440 | 1440 / 1440 | unchanged |
| `/404.html` | 390 / 390 | 390 / 390 | 1440 / 1440 | 1440 / 1440 | unchanged |

All 11 routes report `scrollWidth == clientWidth` at 390 px after the fix.

### Desktop no-reflow evidence

- Geometry fingerprint over every `h1,h2,h3,p,li,td,th,figcaption,dd,dt,code`
  (`tag`, x, page y, width): **0 of 11 routes changed** at 1440×900.
- Full-page screenshots at 1440×900 for `/`, `/projects/thesis/`,
  `/projects/ecommerce-platform/`, `/projects/cicd-pipeline/` and
  `/projects/docqa-assistant/`: identical dimensions and **0 differing pixels**
  per page, before vs after.

## Commands used

```bash
npm run build                         # baseline snapshot, then after the CSS change
npm run preview -- --port 4321        # serve dist for Playwright
node qa1-measure.cjs                  # scrollWidth/clientWidth per route at 390 and 1440
node qa1-shots.cjs <dir>              # 1440×900 full-page screenshots, before and after
node qa1-diff.cjs                     # raw-pixel comparison of the before/after screenshots
npm run verify                        # gate below
```

Measurement expression used per page:

```js
const d = document.documentElement;
({ scrollWidth: d.scrollWidth, clientWidth: d.clientWidth })
```

## Gate

`npm run verify` exits **0**:

- `astro check`: 0 errors, 0 warnings, 0 hints (22 files)
- `tsc --noEmit`: clean
- `check:assets`: 3 manifests valid, 4 shots each, every measurement/invariant backed by a file
- `check:content`, `check:copy` (source and dist): pass
- `check:a11y`: 11 pages, one `h1`, skip link, alt text, link text, `lang`
- `check:js`: **0.00 KB gzip across 0 files**
