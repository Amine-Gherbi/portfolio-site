import { readFile } from "node:fs/promises";
import path from "node:path";
import type { APIRoute } from "astro";

/**
 * Serves the committed build log at /docs/BUILD-LOG.md, so the deployed copy
 * is the same file the repository carries rather than a duplicate.
 */
export const GET: APIRoute = async () => {
  const source = path.join(process.cwd(), "docs", "BUILD-LOG.md");
  const markdown = await readFile(source, "utf8");

  return new Response(markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
