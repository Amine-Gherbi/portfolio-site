import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { SITE_URL } from "../lib/site";

const STATIC_ROUTES = ["/", "/about/", "/resume/", "/colophon/"];

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export const GET: APIRoute = async ({ site }) => {
  const origin = (site ?? new URL(SITE_URL)).toString().replace(/\/$/, "");
  const entries = await getCollection("projects");
  entries.sort((a, b) => a.data.order - b.data.order);

  const urls = [
    ...STATIC_ROUTES.map((route) => ({
      loc: `${origin}${route}`,
      lastmod: undefined as string | undefined,
    })),
    ...entries.map((entry) => ({
      loc: `${origin}/projects/${entry.id}/`,
      lastmod: entry.data.updatedAt,
    })),
  ];

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) =>
      [
        "  <url>",
        `    <loc>${escapeXml(url.loc)}</loc>`,
        ...(url.lastmod ? [`    <lastmod>${escapeXml(url.lastmod)}</lastmod>`] : []),
        "  </url>",
      ].join("\n"),
    ),
    "</urlset>",
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
