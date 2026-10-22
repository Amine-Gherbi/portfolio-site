#!/usr/bin/env node
/**
 * Static accessibility checks over the built HTML. No browser: these are the
 * rules that survive as markup — one h1, a skip link to #main, alt on every
 * image, discernible text on every link, and a language on <html>.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIST_DIR = path.join(process.cwd(), "dist");
const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function walkHtml(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkHtml(full));
    } else if (entry.name.endsWith(".html")) {
      found.push(full);
    }
  }
  return found;
}

function decode(text) {
  return text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity);
}

function hasDiscernibleText(attributes, inner) {
  if (/\baria-label="[^"]+"/i.test(attributes)) {
    return true;
  }
  if (/\btitle="[^"]+"/i.test(attributes)) {
    return true;
  }
  const imageAlt = /<img\b[^>]*\balt="([^"]*)"/i.exec(inner);
  if (imageAlt && imageAlt[1].trim() !== "") {
    return true;
  }
  const text = decode(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text !== "";
}

if (!existsSync(DIST_DIR)) {
  console.error("[a11y] dist/ is missing; run astro build first");
  process.exit(1);
}

const pages = walkHtml(DIST_DIR);
const errors = [];

for (const filePath of pages) {
  const relative = path.relative(DIST_DIR, filePath).split(path.sep).join("/");
  const html = readFileSync(filePath, "utf8");

  if (!/<html\b[^>]*\blang="[^"]+"/i.test(html)) {
    errors.push(`${relative}: <html> has no lang attribute`);
  }

  const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1Count !== 1) {
    errors.push(`${relative}: ${h1Count} h1 elements, expected 1`);
  }

  const skipLink = /<a\b[^>]*class="[^"]*\bskip-link\b[^"]*"[^>]*>/i.exec(html);
  if (!skipLink || !/\bhref="#main"/i.test(skipLink[0])) {
    errors.push(`${relative}: missing skip link to #main`);
  }
  if (!/<main\b[^>]*\bid="main"/i.test(html)) {
    errors.push(`${relative}: missing <main id="main"> (skip-link target)`);
  }

  for (const image of html.match(/<img\b[^>]*>/gi) ?? []) {
    if (!/\balt="/i.test(image)) {
      errors.push(`${relative}: image without alt: ${image.slice(0, 100)}`);
    }
  }

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!hasDiscernibleText(match[1] ?? "", match[2] ?? "")) {
      errors.push(
        `${relative}: link has no discernible text: ${(match[0] ?? "").slice(0, 100)}`,
      );
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`[a11y] FAIL ${error}`);
  }
  console.error(`[a11y] ${errors.length} problem(s); refusing to continue`);
  process.exit(1);
}

console.log(
  `[a11y] ${pages.length} pages: one h1, skip link to #main, alt on every image, text on every link, lang set`,
);
