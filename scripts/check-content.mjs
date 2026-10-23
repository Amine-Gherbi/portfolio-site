#!/usr/bin/env node
/**
 * Validates case-study MDX frontmatter against the rules the template relies on:
 *
 *   1. Each of the 3 decisions has a non-empty rejected alternative and cost.
 *   2. Exactly one dated failure with a commit SHA.
 *   3. Every metric has a method and an artifact path that exists on disk.
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
  "claim",
  "problem",
  "constraint",
  "architecture",
  "decisions",
  "failure",
  "metrics",
  "screenshots",
  "links",
  "next",
];
const BANNED_WORDS = [
  "seamless",
  "robust",
  "leverage",
  "leveraging",
  "cutting-edge",
  "world-class",
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

function validateStudy(study, label) {
  const errors = [];

  if (!isObject(study)) {
    return [`${label}: frontmatter must be an object`];
  }

  for (const field of ["claim", "problem", "constraint", "architecture"]) {
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

  const decisions = Array.isArray(study.decisions) ? study.decisions : [];
  if (decisions.length !== 3) {
    errors.push(
      `decisions: exactly 3 decisions are required, found ${decisions.length}`,
    );
  }
  decisions.forEach((decision, index) => {
    if (!isObject(decision)) {
      errors.push(`decisions[${index}]: decision must be an object`);
      return;
    }
    if (!filled(decision.title)) {
      errors.push(`decisions[${index}].title: decision title is required`);
    }
    if (!filled(decision.choice)) {
      errors.push(`decisions[${index}].choice: decision is required`);
    }
    if (!filled(decision.rejected)) {
      errors.push(
        `decisions[${index}].rejected: rejected alternative is required (empty string)`,
      );
    }
    if (!filled(decision.cost)) {
      errors.push(`decisions[${index}].cost: cost is required (empty string)`);
    }
    if (!filled(decision.evidence)) {
      errors.push(`decisions[${index}].evidence: evidence is required`);
    }
  });

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

  const metrics = Array.isArray(study.metrics) ? study.metrics : [];
  if (metrics.length === 0) {
    errors.push("metrics: at least one metric is required");
  }
  metrics.forEach((metric, index) => {
    if (!isObject(metric)) {
      errors.push(`metrics[${index}]: metric must be an object`);
      return;
    }
    if (!filled(metric.label)) {
      errors.push(`metrics[${index}].label: metric label is required`);
    }
    if (typeof metric.value !== "string" || metric.value.trim() === "") {
      errors.push(
        `metrics[${index}].value: metric value must be a non-empty string`,
      );
    }
    if (!filled(metric.method)) {
      errors.push(`metrics[${index}].method: method is required`);
    }
    if (!filled(metric.artifact)) {
      errors.push(`metrics[${index}].artifact: artifact path is required`);
    } else if (!existsSync(path.resolve(ROOT, metric.artifact))) {
      errors.push(
        `metrics[${index}].artifact: artifact not found at ${metric.artifact}`,
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

  checkWriting(study, errors);

  return errors;
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

  const cases = [];
  const emptyRejected = structuredClone(study);
  emptyRejected.decisions[0].rejected = "";
  cases.push(["empty decision.rejected", emptyRejected, "decisions[0].rejected"]);

  const noFailures = structuredClone(study);
  noFailures.failures = [];
  cases.push(["zero failures", noFailures, "expected exactly one dated failure"]);

  const twoFailures = structuredClone(study);
  twoFailures.failures = [twoFailures.failures[0], twoFailures.failures[0]];
  cases.push(["two failures", twoFailures, "expected exactly one dated failure"]);

  const missingArtifact = structuredClone(study);
  missingArtifact.metrics[0].artifact = "docs/artifact-that-does-not-exist.md";
  cases.push([
    "missing metric artifact",
    missingArtifact,
    "artifact not found",
  ]);

  const failures = [];
  for (const [name, mutated, expected] of cases) {
    const errors = validateStudy(mutated, name);
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
      `[content] dist: ${studies.length} case studies render in fixed section order with 3 captioned screenshots`,
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
  for (const error of validateStudy(study, slug)) {
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
    `[content] ${studies.length} case studies valid: 3 decisions with rejected + cost, exactly one failure, metric artifacts present`,
  );
}
