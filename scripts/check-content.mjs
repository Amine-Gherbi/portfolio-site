#!/usr/bin/env node
/**
 * Validates case-study MDX frontmatter against the rules the template relies on:
 *
 *   1. The six fixed sections exist and the decision names a rejected
 *      alternative and its cost.
 *   2. Exactly one dated failure with a commit SHA.
 *   3. The narrative is between 250 and 450 words.
 *
 * It also checks the other fixed sections, writing rules, and (with --dist) the
 * order of the rendered sections in the built HTML.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = process.cwd();
const PROJECTS_DIR = path.join(ROOT, "src", "content", "projects");
const DIST_ROOT = path.join(ROOT, "dist", "projects");
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n[\s\S]*)?$/;
const SHOT_ORDER = ["shot-01.webp", "shot-02.webp", "shot-03.webp"];
const SECTION_ORDER = [
  "what-it-is",
  "hard-part",
  "decision",
  "what-broke",
  "measured",
  "limits",
];
const SECTION_HEADINGS = [
  "What it is",
  "The hard part",
  "The decision",
  "What broke",
  "Measured",
  "Limits",
];
const WORD_MIN = 250;
const WORD_MAX = 450;
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
];
const SUPERLATIVES = [
  "best",
  "fastest",
  "slowest",
  "highest",
  "lowest",
  "largest",
  "smallest",
  "greatest",
  "most",
  "least",
  "perfect",
  "unmatched",
  "unrivalled",
  "unrivaled",
  "revolutionary",
  "leading",
  "superior",
  "ultimate",
];
const SKIP_PROSE_KEYS = new Set([
  "artifact",
  "href",
  "file",
  "commit",
  "updatedAt",
  "date",
  "order",
]);

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function filled(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseFrontmatter(raw, filePath) {
  const match = FRONTMATTER.exec(raw);
  if (!match) {
    throw new Error(`${filePath}: missing YAML frontmatter delimited by ---`);
  }
  const data = parseYaml(match[1] ?? "");
  if (!isObject(data)) {
    throw new Error(`${filePath}: frontmatter must be a YAML object`);
  }
  return data;
}

function collectProse(value, key, output) {
  if (typeof value === "string") {
    if (!SKIP_PROSE_KEYS.has(key)) {
      output.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectProse(item, key, output));
    return;
  }
  if (isObject(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectProse(childValue, childKey, output);
    }
  }
}

function countWords(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return 0;
  }
  return text.trim().split(/\s+/).length;
}

/**
 * The word ceiling applies to the narrative a reader sees in the six sections:
 * the claim, one-liner, what/hard-part/measured paragraphs, the decision and
 * failure fields, the next steps, screenshot captions and the committed
 * manifest limits. The metric table, link labels, stack tokens and headings are
 * evidence or metadata, not narrative, and are excluded.
 */
function narrativeWords(study, limits) {
  const parts = [
    study.oneLiner,
    study.claim,
    study.what,
    study.hardPart,
    study.measured,
  ];

  const decision = isObject(study.decision) ? study.decision : {};
  parts.push(
    decision.title,
    decision.choice,
    decision.rejected,
    decision.cost,
    decision.evidence,
  );

  const failures = Array.isArray(study.failures) ? study.failures : [];
  for (const failure of failures) {
    if (isObject(failure)) {
      parts.push(failure.summary, failure.processChange);
    }
  }

  for (const screenshot of Array.isArray(study.screenshots) ? study.screenshots : []) {
    if (isObject(screenshot)) {
      parts.push(screenshot.caption);
    }
  }

  parts.push(...(Array.isArray(study.next) ? study.next : []));
  parts.push(...(Array.isArray(limits) ? limits : []));

  return parts.reduce((total, part) => total + countWords(part), 0);
}

function checkWriting(study, errors) {
  const prose = [];
  collectProse(study, "", prose);

  for (const text of prose) {
    const lower = text.toLowerCase();
    for (const word of BANNED_WORDS) {
      if (new RegExp(`\\b${word}\\b`, "i").test(lower)) {
        errors.push(`writing: banned word "${word}" in: ${text.slice(0, 80)}`);
      }
    }
    if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(text)) {
      errors.push(`writing: emoji found in: ${text.slice(0, 80)}`);
    }
    if (text.includes("!")) {
      errors.push(`writing: exclamation mark in: ${text.slice(0, 80)}`);
    }
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (/\d/.test(sentence)) {
        continue;
      }
      for (const word of SUPERLATIVES) {
        if (new RegExp(`\\b${word}\\b`, "i").test(sentence)) {
          errors.push(
            `writing: superlative "${word}" without a number in the same sentence: ${sentence}`,
          );
        }
      }
    }
  }
}

function validateStudy(study, label, limits = []) {
  const errors = [];

  if (!isObject(study)) {
    return [`${label}: frontmatter must be an object`];
  }

  for (const field of ["claim", "what", "hardPart", "measured"]) {
    if (!filled(study[field])) {
      errors.push(`${field}: ${field} is required`);
    }
  }

  if (!Number.isInteger(study.order) || study.order < 1) {
    errors.push("order: order must be a positive integer");
  }
  if (!filled(study.title)) {
    errors.push("title: title is required");
  }
  if (!filled(study.oneLiner)) {
    errors.push("oneLiner: oneLiner is required");
  }
  if (!Array.isArray(study.stack) || study.stack.length === 0) {
    errors.push("stack: at least one stack entry is required");
  }
  if (!isIsoDate(study.updatedAt)) {
    errors.push("updatedAt: updatedAt must be YYYY-MM-DD");
  }

  if (!isObject(study.decision)) {
    errors.push("decision: exactly one decision object is required");
  } else {
    for (const field of ["title", "choice", "rejected", "cost", "evidence"]) {
      if (!filled(study.decision[field])) {
        errors.push(
          `decision.${field}: ${field === "rejected" ? "rejected alternative" : field} is required`,
        );
      }
    }
  }

  const failures = Array.isArray(study.failures) ? study.failures : [];
  if (failures.length !== 1) {
    errors.push(
      `failures: expected exactly one dated failure, found ${failures.length}`,
    );
  }
  failures.forEach((failure, index) => {
    if (!isObject(failure)) {
      errors.push(`failures[${index}]: failure must be an object`);
      return;
    }
    if (!isIsoDate(failure.date)) {
      errors.push(`failures[${index}].date: failure date must be YYYY-MM-DD`);
    }
    if (typeof failure.commit !== "string" || !/^[0-9a-f]{7,40}$/.test(failure.commit)) {
      errors.push(
        `failures[${index}].commit: commit must be a 7-40 character lowercase SHA`,
      );
    }
    if (!filled(failure.summary)) {
      errors.push(`failures[${index}].summary: failure summary is required`);
    }
    if (!filled(failure.processChange)) {
      errors.push(
        `failures[${index}].processChange: process change is required`,
      );
    }
  });

  const screenshots = Array.isArray(study.screenshots) ? study.screenshots : [];
  if (screenshots.length !== 3) {
    errors.push(
      `screenshots: exactly 3 screenshots are required, found ${screenshots.length}`,
    );
  }
  screenshots.forEach((screenshot, index) => {
    if (!isObject(screenshot)) {
      errors.push(`screenshots[${index}]: screenshot must be an object`);
      return;
    }
    if (screenshot.file !== SHOT_ORDER[index]) {
      errors.push(
        `screenshots[${index}].file: expected ${SHOT_ORDER[index]}, got ${String(screenshot.file)}`,
      );
    }
    if (!filled(screenshot.caption)) {
      errors.push(`screenshots[${index}].caption: caption is required`);
    }
  });

  const links = Array.isArray(study.links) ? study.links : [];
  if (links.length === 0) {
    errors.push("links: at least one link is required");
  }
  links.forEach((link, index) => {
    if (!isObject(link) || !filled(link.label)) {
      errors.push(`links[${index}].label: link label is required`);
    }
    if (!isObject(link) || typeof link.href !== "string" || !/^(https?:\/\/|\/)/.test(link.href)) {
      errors.push(
        `links[${index}].href: link href must be an absolute URL or a site path`,
      );
    }
  });

  const next = Array.isArray(study.next) ? study.next : [];
  if (next.length === 0) {
    errors.push("next: at least one next step is required");
  }
  next.forEach((step, index) => {
    if (!filled(step)) {
      errors.push(`next[${index}]: next step must be a non-empty string`);
    }
  });

  const words = narrativeWords(study, limits);
  if (words < WORD_MIN || words > WORD_MAX) {
    errors.push(
      `word count: ${words} narrative words; expected ${WORD_MIN}-${WORD_MAX}`,
    );
  }

  checkWriting(study, errors);

  return errors;
}

function readManifest(slug) {
  const manifestPath = path.join(ROOT, "public", "assets", slug, "manifest.json");
  if (!existsSync(manifestPath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function manifestLimits(manifest) {
  if (!isObject(manifest) || !isObject(manifest.proof)) {
    return [];
  }
  return Array.isArray(manifest.proof.limits)
    ? manifest.proof.limits.filter((limit) => typeof limit === "string")
    : [];
}

function validateManifest(slug, errors, warnings) {
  const manifestPath = path.join(ROOT, "public", "assets", slug, "manifest.json");
  if (!existsSync(manifestPath)) {
    warnings.push(
      `${slug}: no asset manifest; the screenshots section will show coming soon`,
    );
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    errors.push(`${slug}: invalid manifest JSON (${error.message})`);
    return;
  }

  if (!Array.isArray(manifest.shots) || manifest.shots.length !== 4) {
    errors.push(`${slug}: manifest must contain 4 shots`);
    return;
  }

  SHOT_ORDER.forEach((file, index) => {
    const shot = manifest.shots[index + 1];
    if (!isObject(shot)) {
      errors.push(`${slug}: manifest is missing ${file}`);
      return;
    }
    if (shot.file !== file) {
      errors.push(`${slug}: manifest shot ${index + 2} must be ${file}`);
    }
    if (!filled(shot.alt)) {
      errors.push(`${slug}: manifest shot ${file} needs alt text`);
    }
    if (!existsSync(path.join(ROOT, "public", "assets", slug, file))) {
      errors.push(`${slug}: manifest shot ${file} is absent from disk`);
    }
  });
}

function readStudies() {
  const files = readdirSync(PROJECTS_DIR)
    .filter((file) => file.endsWith(".mdx"))
    .sort();

  return files.map((file) => {
    const filePath = path.join(PROJECTS_DIR, file);
    return {
      slug: path.basename(file, ".mdx"),
      filePath,
      raw: readFileSync(filePath, "utf8"),
    };
  });
}

function runSelfTests(study) {
  if (!study) {
    console.warn("[content] self-test skipped: no parsed case study available");
    return [];
  }

  const limits = ["A manifest limit.", "Another manifest limit.", "A third limit."];
  const cases = [];
  const emptyRejected = structuredClone(study);
  emptyRejected.decision.rejected = "";
  cases.push(["empty decision.rejected", emptyRejected, "decision.rejected"]);

  const noFailures = structuredClone(study);
  noFailures.failures = [];
  cases.push(["zero failures", noFailures, "expected exactly one dated failure"]);

  const twoFailures = structuredClone(study);
  twoFailures.failures = [twoFailures.failures[0], twoFailures.failures[0]];
  cases.push(["two failures", twoFailures, "expected exactly one dated failure"]);

  const missingWhat = structuredClone(study);
  missingWhat.what = "";
  cases.push(["missing what-it-is prose", missingWhat, "what: what is required"]);

  const tooLong = structuredClone(study);
  tooLong.what = "word ".repeat(500);
  cases.push(["word ceiling", tooLong, "word count"]);

  const failures = [];
  for (const [name, mutated, expected] of cases) {
    const errors = validateStudy(mutated, name, limits);
    if (!errors.some((error) => error.includes(expected))) {
      failures.push(
        `[content] FAIL self-test "${name}": expected an error containing "${expected}", got ${errors.length} errors`,
      );
    }
  }

  if (failures.length === 0) {
    console.log(
      `[content] self-test: ${cases.length} negative cases rejected as expected`,
    );
  }
  return failures;
}

function textOf(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function runDistChecks(studies, errors) {
  if (!existsSync(DIST_ROOT)) {
    errors.push(
      `[content] dist check: ${DIST_ROOT} does not exist; run astro build first`,
    );
    return;
  }

  for (const { slug, filePath, raw } of studies) {
    const htmlPath = path.join(DIST_ROOT, slug, "index.html");
    if (!existsSync(htmlPath)) {
      errors.push(`[content] dist: missing rendered page ${htmlPath}`);
      continue;
    }

    const html = readFileSync(htmlPath, "utf8");
    const sections = [...html.matchAll(/data-section="([^"]+)"/g)].map(
      (match) => match[1],
    );
    if (sections.join(",") !== SECTION_ORDER.join(",")) {
      errors.push(
        `[content] dist: ${slug} sections are [${sections.join(", ")}], expected [${SECTION_ORDER.join(", ")}]`,
      );
    }

    const headings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map(
      (match) => textOf(match[1] ?? ""),
    );
    if (headings.join(",") !== SECTION_HEADINGS.join(",")) {
      errors.push(
        `[content] dist: ${slug} headings are [${headings.join(", ")}], expected [${SECTION_HEADINGS.join(", ")}]`,
      );
    }

    const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
    if (h1Count !== 1) {
      errors.push(`[content] dist: ${slug} has ${h1Count} h1 elements, expected 1`);
    }

    const captions = (html.match(/<figcaption[\s>]/g) ?? []).length;
    if (captions !== 3) {
      errors.push(
        `[content] dist: ${slug} has ${captions} figcaptions, expected 3`,
      );
    }

    let study;
    try {
      study = parseFrontmatter(raw, filePath);
    } catch (error) {
      errors.push(`[content] dist: ${error.message}`);
      continue;
    }

    const manifestPath = path.join(
      ROOT,
      "public",
      "assets",
      slug,
      "manifest.json",
    );
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      for (const shot of (manifest.shots ?? []).slice(1, 4)) {
        if (filled(shot.alt) && !html.includes(shot.alt)) {
          errors.push(
            `[content] dist: ${slug} does not render alt text for ${shot.file}`,
          );
        }
      }
    }

    for (const screenshot of study.screenshots ?? []) {
      if (filled(screenshot.caption) && !html.includes(screenshot.caption)) {
        errors.push(
          `[content] dist: ${slug} does not render the caption for ${screenshot.file}`,
        );
      }
    }
  }

  if (errors.length === 0) {
    console.log(
      `[content] dist: ${studies.length} case studies render six sections in fixed order with 3 captioned screenshots`,
    );
  }
}

const mode = process.argv.includes("--dist") ? "dist" : "source";
const errors = [];
const warnings = [];
const studies = readStudies();

if (studies.length === 0) {
  errors.push(`[content] no .mdx case studies found in ${PROJECTS_DIR}`);
}

let firstStudy;
for (const { slug, filePath, raw } of studies) {
  let study;
  try {
    study = parseFrontmatter(raw, filePath);
  } catch (error) {
    errors.push(`[content] ${error.message}`);
    continue;
  }
  firstStudy ??= study;
  for (const error of validateStudy(study, slug, manifestLimits(readManifest(slug)))) {
    errors.push(`[content] ${slug}: ${error}`);
  }
  validateManifest(slug, errors, warnings);
}

for (const warning of warnings) {
  console.warn(`[content] ${warning}`);
}

if (mode === "dist") {
  runDistChecks(studies, errors);
} else {
  errors.push(...runSelfTests(firstStudy));
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error.startsWith("[content]") ? error : `[content] FAIL ${error}`);
  }
  console.error(
    `[content] ${errors.length} problem(s); refusing to continue`,
  );
  process.exit(1);
}

if (mode === "source") {
  console.log(
    `[content] ${studies.length} case studies valid: six sections, one decision with rejected + cost, exactly one failure, ${WORD_MIN}-${WORD_MAX} narrative words`,
  );
}
