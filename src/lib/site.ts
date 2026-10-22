/**
 * One source for the public origin. Absolute URLs in the sitemap, JSON-LD and
 * social metadata all derive from it. Override with SITE_URL at build time
 * (astro.config.mjs reads the same variable) when deploying to another host.
 */
export const SITE_URL = process.env.SITE_URL ?? "https://ghamine.dev";

export const SITE_NAME = "GHamine";

export const NAV_ROUTES = [
  { path: "/about/", label: "About" },
  { path: "/resume/", label: "Resume" },
  { path: "/colophon/", label: "Colophon" },
] as const;

export function absoluteUrl(pathname: string): string {
  return new URL(pathname, `${SITE_URL}/`).toString();
}
