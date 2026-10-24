#!/usr/bin/env node
/**
 * Copy audit. Fails on:
 *   - banned marketing words and defect vocabulary
 *   - emoji
 *   - more than 3 badges on a rendered page
 *   - a sentence in a case study or the thesis that carries a measurement
 *     number without a method, artifact, commit or page nearby
 *   - a rendered ISO date or a schema/sitemap date field
 *   - an /about page longer than 250 words
 *
 * Source mode validates the MDX before the build; --dist validates the
 * rendered HTML after it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = process.cwd();
const PROJECTS_DIR = path.join(ROOT, "src", "content", "projects");
const SRC_DIR = path.join(ROOT, "src");
const DIST_DIR = path.join(ROOT, "dist");
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n[\s\S]*)?$/;

const BANNED_WORDS = [
  "seamless",
  "robust",
  "leverage",
  "leveraging",
  "cutting-edge",
  "empower",
  "elevate",
  "unlock",
  "effortless",
  "powerful",
  "delve",
  "world-class",
  "not just",
  // Defect vocabulary: the copy describes what the system enforces and what
  // was measured, not what went wrong or what is missing.
  "never run",
  "never ran",
  "not measured",
  "unmeasured",
  "unverified",
  "fails",
  "failed",
  "no live url",
  "no live",
  "local demo",
  "simulated",
  "blocked",
  "limitation",
  "only",
  "still",
  "unfinished",
  "what broke",
  "no actions run",
  "gate fail",
  "built with claude code",
  "reviewed by me",
];

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

const METHOD_SIGNAL =
  /\b(method|measured|measure|recorded|counted|seeded|seed|fixture|run|runs|tested|asserts|asserted|commit|snapshot|manifest|artifact|validator|sample|caliper|benchmark|machine|page|report|thesis)\b/i;

const IDENTIFIER_DIGITS = [
  /\bpostgresql\s+\d+(?:\.\d+)*/gi,
  /\bfts\d+\b/gi,
  /\bhttp\s+\d+(?:\.\d+)*/gi,
  /\bsha[- ]?\d+/gi,
  /\bnode(?:\.js)?\s+\d+(?:\.\d+)*/gi,
  /\bpython\s+\d+(?:\.\d+)*/gi,
  /\bfabric\s+v?\d+(?:\.\d+)*/gi,
];

const SKIP_KEYS = new Set([
  "artifact",
  "href",
  "file",
  "commit",
  "updatedAt",
  "date",
  "order",
  "pdfLabel",
  "session",
  "coverAlt",
]);

function walkFiles(directory, extensions) {
  if (!existsSync(directory)) {
    return [];
  }
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkFiles(full, extensions));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

function readFrontmatter(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const match = FRONTMATTER.exec(raw);
  if (!match) {
    return null;
  }
  return parseYaml(match[1] ?? "");
}

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim() !== "");
}

function hasMeasurementNumber(sentence) {
  let stripped = sentence;
  for (const pattern of IDENTIFIER_DIGITS) {
    stripped = stripped.replace(pattern, " ");
  }
  stripped = stripped.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  stripped = stripped.replace(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi, " ");
  return /\d/.test(stripped);
}

function objectCarriesMethod(object) {
  return ["method", "evidence", "artifact", "commit"].some(
    (key) => typeof object[key] === "string" && object[key].trim() !== "",
  );
}

function auditStudy(slug, data, errors) {
  if (typeof data !== "object" || data === null) {
    return;
  }

  const visit = (value, key, parent, trail) => {
    if (typeof value === "string") {
      if (SKIP_KEYS.has(key)) {
        return;
      }
      if (value.includes("!")) {
        errors.push(
          `${slug}: exclamation mark in ${trail || key}: "${value.slice(0, 140)}"`,
        );
      }
      const sentences = splitSentences(value);
      sentences.forEach((sentence, index) => {
        if (!hasMeasurementNumber(sentence)) {
          return;
        }
        // "Nearby" means the same sentence or one of its neighbours in the
        // field, or a method/evidence/artifact/commit entry on the same object.
        const neighbourhood = [
          sentences[index - 1] ?? "",
          sentence,
          sentences[index + 1] ?? "",
        ].join(" ");
        if (METHOD_SIGNAL.test(neighbourhood)) {
          return;
        }
        if (parent && typeof parent === "object" && objectCarriesMethod(parent)) {
          return;
        }
        errors.push(
          `${slug}: number without a method nearby in ${trail || key}: "${sentence.trim().slice(0, 140)}"`,
        );
      });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, key, parent, `${trail}[${index}]`));
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [childKey, childValue] of Object.entries(value)) {
        const childTrail = trail === "" ? childKey : `${trail}.${childKey}`;
        visit(childValue, childKey, value, childTrail);
      }
    }
  };

  for (const [key, value] of Object.entries(data)) {
    visit(value, key, data, key);
  }
}

function scanSourceText(errors) {
  const files = walkFiles(SRC_DIR, [".astro", ".ts", ".mdx", ".json", ".css", ".mjs"]);
  for (const filePath of files) {
    const raw = readFileSync(filePath, "utf8");
    const relative = path.relative(ROOT, filePath).split(path.sep).join("/");
    const lower = raw.toLowerCase();

    for (const word of BANNED_WORDS) {
      if (new RegExp(`\\b${word}\\b`, "i").test(lower)) {
        errors.push(`${relative}: banned word "${word}"`);
      }
    }

    if (EMOJI.test(raw)) {
      errors.push(`${relative}: emoji found`);
    }

    const badgeCount = (raw.match(/\bclass="[^"]*\bbadge\b[^"]*"/g) ?? []).length;
    if (badgeCount > 3) {
      errors.push(`${relative}: ${badgeCount} badges, maximum is 3`);
    }
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function scanDist(errors) {
  if (!existsSync(DIST_DIR)) {
    errors.push("dist/: missing; run astro build first");
    return;
  }

  const pages = walkFiles(DIST_DIR, [".html"]);
  for (const filePath of pages) {
    const relative = path.relative(DIST_DIR, filePath).split(path.sep).join("/");
    const html = readFileSync(filePath, "utf8");
    const lower = html.toLowerCase();

    for (const word of BANNED_WORDS) {
      if (new RegExp(`\\b${word}\\b`, "i").test(lower)) {
        errors.push(`${relative}: banned word "${word}"`);
      }
    }
    if (EMOJI.test(html)) {
      errors.push(`${relative}: emoji found`);
    }

    const badgeCount = (html.match(/\bclass="[^"]*\bbadge\b[^"]*"/g) ?? []).length;
    if (badgeCount > 3) {
      errors.push(`${relative}: ${badgeCount} badges, maximum is 3`);
    }

    const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
    const visible = stripHtml(main ? main[1] : html);
    if (visible.includes("!")) {
      errors.push(`${relative}: exclamation mark in visible text`);
    }

    const date = /\b\d{4}-\d{2}-\d{2}\b/.exec(html);
    if (date) {
      errors.push(`${relative}: rendered date ${date[0]}`);
    }
    const dateField = /\b(?:dateModified|datePublished|lastmod)\b/i.exec(html);
    if (dateField) {
      errors.push(`${relative}: emitted date field ${dateField[0]}`);
    }
    if (/<time\b[^>]*\bdatetime=/i.test(html)) {
      errors.push(`${relative}: rendered <time datetime> element`);
    }
  }

  const sitemap = path.join(DIST_DIR, "sitemap.xml");
  if (!existsSync(sitemap)) {
    errors.push("dist/sitemap.xml: missing");
  } else {
    const xml = readFileSync(sitemap, "utf8");
    const date = /\b\d{4}-\d{2}-\d{2}\b/.exec(xml);
    if (date) {
      errors.push(`sitemap.xml: rendered date ${date[0]}`);
    }
    if (/<lastmod\b/i.test(xml)) {
      errors.push("sitemap.xml: emitted <lastmod>");
    }
  }

  const aboutPath = path.join(DIST_DIR, "about", "index.html");
  if (!existsSync(aboutPath)) {
    errors.push("dist/about/index.html: missing");
  } else {
    const html = readFileSync(aboutPath, "utf8");
    const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
    const text = stripHtml(main ? main[1] : html);
    const words = text === "" ? 0 : text.split(/\s+/).length;
    if (words > 250) {
      errors.push(`/about: ${words} words, maximum is 250`);
    }
  }
}

const errors = [];
const mode = process.argv.includes("--dist") ? "dist" : "source";

if (mode === "source") {
  scanSourceText(errors);

  const files = readdirSync(PROJECTS_DIR).filter((file) => file.endsWith(".mdx")).sort();
  for (const file of files) {
    const slug = path.basename(file, ".mdx");
    const data = readFrontmatter(path.join(PROJECTS_DIR, file));
    if (!data) {
      errors.push(`${slug}: missing frontmatter`);
      continue;
    }
    auditStudy(slug, data, errors);
  }
} else {
  scanDist(errors);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`[copy] FAIL ${error}`);
  }
  console.error(`[copy] ${errors.length} problem(s); refusing to continue`);
  process.exit(1);
}

console.log(
  mode === "source"
    ? "[copy] source: no banned or defect words or emoji; measurement numbers carry a method, artifact, commit or page"
    : "[copy] dist: no banned or defect words, emoji or rendered dates; no page has more than 3 badges; /about is within 250 words",
);
