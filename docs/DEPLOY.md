# Deploy

**Deployed 2026-10-24:** `https://gherbi.pages.dev` on Cloudflare Pages, project `gherbi`, production branch
`master`. The build ran on this machine with `SITE_URL=https://gherbi.pages.dev npm run build` and the output was
uploaded with `npx wrangler pages deploy dist --project-name gherbi --branch master`. Lighthouse against the
deployed origin: performance 95, accessibility 100, best practices 100, SEO 100, LCP 3.0 s, CLS 0.

The project is **not** connected to Git, so a push does not redeploy it; re-run the two commands above after a
content change. Steps 1–5 below remain the path for a Git-connected project, and step 3 lists the two settings that
still apply (build command `npm run build`, output `dist`, `NODE_VERSION=22`, `SITE_URL`).

The host used in these steps is Cloudflare Pages because it serves a plain `dist/` directory with no adapter and no server runtime. Any static host that accepts a build command and an output directory works the same way.

## Step 1 — Build and check `dist/` locally

```sh
npm ci
npm run verify
```

`npm run verify` runs the full gate and ends with `astro build`. The publishable output is `dist/`; it must contain `index.html`, `about/index.html`, `resume/index.html`, `projects/`, `thesis.pdf`, `sitemap.xml`, `robots.txt`, `favicon.svg`, `favicon.ico`, and `apple-touch-icon.png`. Nothing is published by this step.

## Step 2 — Create the Cloudflare Pages project

Sign in at <https://dash.cloudflare.com/> and use this click path:

**Workers & Pages → Create → Pages → Connect to Git → select this repository → Begin setup**

Choose the branch you deploy from (`main` once it exists, otherwise `master`). Do not create a Worker; the site is static.

## Step 3 — Set the build command and output directory

In the build configuration screen (and later under **Settings → Builds & deployments**):

| Field | Value |
| --- | --- |
| Framework preset | `Astro` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version variable | `NODE_VERSION=22` |
| Site origin variable | `SITE_URL=https://<project>.pages.dev` |

`SITE_URL` is read by `astro.config.mjs` and `src/lib/site.ts`, so canonical URLs, JSON-LD, `sitemap.xml`, and Open Graph image URLs use the deployed origin instead of `https://portfolio.example`. When the custom domain from step 4 exists, change `SITE_URL` to that origin, replace the placeholder origin in `public/robots.txt`, and redeploy.

## Step 4 — Attach the domain

In the Pages project: **Custom domains → Set up a custom domain → enter the apex domain** (for example `example.com`), then confirm the CNAME record Cloudflare proposes. Repeat for `www.example.com` if both should resolve. Wait for the certificate status to read **Active**.

The domain is not configured in this repository; only the host setting above records it.

## Step 5 — Verify the deployed build

Confirm the files are served from the new origin:

```sh
curl -sI https://<project>.pages.dev/ | head -n 1
curl -sI https://<project>.pages.dev/favicon.ico | head -n 1
curl -sI https://<project>.pages.dev/apple-touch-icon.png | head -n 1
```

Each response must start with `HTTP/2 200`. Then run Lighthouse against the deployed URL and confirm the four category scores:

```sh
npx lighthouse https://<project>.pages.dev/ --chrome-flags="--headless" --output=html --output-path=./lighthouse.html
```

The `/favicon.ico` request must not appear as a 404, and best practices must read 100. Re-run the same command against the custom domain from step 4 after it is active.
