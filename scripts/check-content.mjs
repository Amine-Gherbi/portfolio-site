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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
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
const THESIS_SECTION_ORDER = [
  "what-it-is",
  "hard-part",
  "design",
  "proves",
  "limits",
];
const THESIS_SECTION_HEADINGS = [
  "What it is",
  "The hard part",
  "The design",
  "What it proves",
  "Limits",
];
const WORD_MIN = 250;
const WORD_MAX = 450;
const THESIS_WORD_MIN = 250;
const THESIS_WORD_MAX = 800;
const THESIS_COVER = path.join(ROOT, "public", "assets", "thesis", "cover.webp");
const THESIS_PDF = path.join(ROOT, "public", "thesis.pdf");
const THESIS_PDF_BYTES = 2786769;
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

  parts.push(...(Array.isArray(limits) ? limits : []));

  return parts.reduce((total, part) => total + countWords(part), 0);
}

function thesisNarrativeWords(study) {
  const parts = [
    study.oneLiner,
    study.claim,
    study.what,
    study.hardPart,
    study.design,
    study.proves,
    ...(Array.isArray(study.limits) ? study.limits : []),
  ];

  for (const organisation of Array.isArray(study.organisations)
    ? study.organisations
    : []) {
    if (isObject(organisation)) {
      parts.push(organisation.name, organisation.role);
    }
  }

  for (const fn of Array.isArray(study.functions) ? study.functions : []) {
    if (isObject(fn)) {
      parts.push(fn.name, fn.role);
    }
  }

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

function validateCommon(study, label, errors) {
  if (!isObject(study)) {
    errors.push(`${label}: frontmatter must be an object`);
    return false;
  }

  for (const field of ["claim", "what", "hardPart"]) {
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

  return true;
}

function validateStudy(study, label, limits = []) {
  const errors = [];

  if (!validateCommon(study, label, errors)) {
    return errors;
  }

  if (study.kind !== "case-study") {
    errors.push('kind: expected "case-study"');
  }
  if (!filled(study.measured)) {
    errors.push("measured: measured is required");
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

  const words = narrativeWords(study, limits);
  if (words < WORD_MIN || words > WORD_MAX) {
    errors.push(
      `word count: ${words} narrative words; expected ${WORD_MIN}-${WORD_MAX}`,
    );
  }

  checkWriting(study, errors);

  return errors;
}

function validateThesis(study, label) {
  const errors = [];

  if (!validateCommon(study, label, errors)) {
    return errors;
  }

  if (study.kind !== "thesis") {
    errors.push('kind: expected "thesis"');
  }

  for (const field of [
    "thesisTitle",
    "design",
    "proves",
    "pdfLabel",
    "coverAlt",
    "author",
    "institution",
    "department",
    "degree",
    "session",
  ]) {
    if (!filled(study[field])) {
      errors.push(`${field}: ${field} is required`);
    }
  }

  const limits = Array.isArray(study.limits) ? study.limits : [];
  if (limits.length < 3) {
    errors.push("limits: at least three limits are required");
  }
  limits.forEach((limit, index) => {
    if (!filled(limit)) {
      errors.push(`limits[${index}]: limit must be a non-empty string`);
    }
  });

  const supervisors = Array.isArray(study.supervisors) ? study.supervisors : [];
  if (supervisors.length === 0) {
    errors.push("supervisors: at least one supervisor is required");
  }
  supervisors.forEach((supervisor, index) => {
    if (!filled(supervisor)) {
      errors.push(`supervisors[${index}]: supervisor must be a non-empty string`);
    }
  });

  const organisations = Array.isArray(study.organisations)
    ? study.organisations
    : [];
  if (organisations.length !== 3) {
    errors.push(
      `organisations: exactly three organisations are required, found ${organisations.length}`,
    );
  }
  organisations.forEach((organisation, index) => {
    if (!isObject(organisation) || !filled(organisation.name) || !filled(organisation.role)) {
      errors.push(
        `organisations[${index}]: organisation needs a name and a role`,
      );
    }
  });

  const functions = Array.isArray(study.functions) ? study.functions : [];
  if (functions.length !== 9) {
    errors.push(
      `functions: exactly nine chaincode functions are required, found ${functions.length}`,
    );
  }
  functions.forEach((fn, index) => {
    if (!isObject(fn) || !filled(fn.name) || !filled(fn.role)) {
      errors.push(`functions[${index}]: function needs a name and a role`);
    }
  });

  if (study.cover !== "/assets/thesis/cover.webp") {
    errors.push("cover: cover must be /assets/thesis/cover.webp");
  }
  if (study.pdf !== "/thesis.pdf") {
    errors.push("pdf: pdf must be /thesis.pdf");
  }

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
  if (!links.some((link) => isObject(link) && link.href === "/thesis.pdf")) {
    errors.push("links: the thesis must link /thesis.pdf");
  }
  if (
    links.some(
      (link) =>
        isObject(link) &&
        typeof link.href === "string" &&
        /^https?:\/\//.test(link.href),
    )
  ) {
    errors.push("links: the thesis must not link to a repository");
  }

  const words = thesisNarrativeWords(study);
  if (words < THESIS_WORD_MIN || words > THESIS_WORD_MAX) {
    errors.push(
      `word count: ${words} thesis narrative words; expected ${THESIS_WORD_MIN}-${THESIS_WORD_MAX}`,
    );
  }

  checkWriting(study, errors);

  return errors;
}

async function validateThesisFiles(slug, errors) {
  if (!existsSync(THESIS_COVER)) {
    errors.push(`${slug}: cover is absent from public/assets/thesis/cover.webp`);
  } else {
    try {
      const metadata = await sharp(THESIS_COVER).metadata();
      if (
        metadata.format !== "webp" ||
        metadata.width !== 2880 ||
        metadata.height !== 1800
      ) {
        errors.push(
          `${slug}: cover is ${String(metadata.format)} ${String(metadata.width)}x${String(metadata.height)}, expected webp 2880x1800`,
        );
      }
    } catch (error) {
      errors.push(`${slug}: cover is not a readable image (${error.message})`);
    }
  }

  if (!existsSync(THESIS_PDF)) {
    errors.push(`${slug}: public/thesis.pdf is absent`);
  } else {
    const size = statSync(THESIS_PDF).size;
    if (size !== THESIS_PDF_BYTES) {
      errors.push(
        `${slug}: public/thesis.pdf is ${size} bytes, expected ${THESIS_PDF_BYTES}`,
      );
    }
  }
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

function runSelfTests(study, thesis) {
  const failures = [];
  let caseCount = 0;

  if (study) {
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

    caseCount = cases.length;
    for (const [name, mutated, expected] of cases) {
      const errors = validateStudy(mutated, name, limits);
      if (!errors.some((error) => error.includes(expected))) {
        failures.push(
          `[content] FAIL self-test "${name}": expected an error containing "${expected}", got ${errors.length} errors`,
        );
      }
    }
  } else {
    console.warn("[content] self-test skipped: no parsed case study available");
  }

  let thesisCount = 0;
  if (thesis) {
    const thesisCases = [];
    const emptyDesign = structuredClone(thesis);
    emptyDesign.design = "";
    thesisCases.push([
      "thesis with no design prose",
      emptyDesign,
      "design: design is required",
    ]);

    const twoLimits = structuredClone(thesis);
    twoLimits.limits = twoLimits.limits.slice(0, 2);
    thesisCases.push([
      "thesis with two limits",
      twoLimits,
      "limits: at least three limits are required",
    ]);

    const eightFunctions = structuredClone(thesis);
    eightFunctions.functions = eightFunctions.functions.slice(0, 8);
    thesisCases.push([
      "thesis with eight chaincode functions",
      eightFunctions,
      "functions: exactly nine chaincode functions are required",
    ]);

    const repositoryLink = structuredClone(thesis);
    repositoryLink.links = [
      { label: "Repository", href: "https://example.invalid/repo" },
    ];
    thesisCases.push([
      "thesis with a repository link",
      repositoryLink,
      "links: the thesis must link /thesis.pdf",
    ]);

    thesisCount = thesisCases.length;
    for (const [name, mutated, expected] of thesisCases) {
      const errors = validateThesis(mutated, name);
      if (!errors.some((error) => error.includes(expected))) {
        failures.push(
          `[content] FAIL self-test "${name}": expected an error containing "${expected}", got ${errors.length} errors`,
        );
      }
    }
  } else {
    console.warn("[content] self-test skipped: no parsed thesis available");
  }

  if (failures.length === 0) {
    console.log(
      `[content] self-test: ${caseCount + thesisCount} negative cases rejected as expected`,
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

  let caseCount = 0;
  let thesisCount = 0;

  for (const { slug, filePath, raw } of studies) {
    const htmlPath = path.join(DIST_ROOT, slug, "index.html");
    if (!existsSync(htmlPath)) {
      errors.push(`[content] dist: missing rendered page ${htmlPath}`);
      continue;
    }

    let study;
    try {
      study = parseFrontmatter(raw, filePath);
    } catch (error) {
      errors.push(`[content] dist: ${error.message}`);
      continue;
    }

    const isThesis = study.kind === "thesis";
    const expectedSections = isThesis ? THESIS_SECTION_ORDER : SECTION_ORDER;
    const expectedHeadings = isThesis ? THESIS_SECTION_HEADINGS : SECTION_HEADINGS;

    const html = readFileSync(htmlPath, "utf8");
    const sections = [...html.matchAll(/data-section="([^"]+)"/g)].map(
      (match) => match[1],
    );
    if (sections.join(",") !== expectedSections.join(",")) {
      errors.push(
        `[content] dist: ${slug} sections are [${sections.join(", ")}], expected [${expectedSections.join(", ")}]`,
      );
    }

    const headings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map(
      (match) => textOf(match[1] ?? ""),
    );
    if (headings.join(",") !== expectedHeadings.join(",")) {
      errors.push(
        `[content] dist: ${slug} headings are [${headings.join(", ")}], expected [${expectedHeadings.join(", ")}]`,
      );
    }

    const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
    if (h1Count !== 1) {
      errors.push(`[content] dist: ${slug} has ${h1Count} h1 elements, expected 1`);
    }

    const captions = (html.match(/<figcaption[\s>]/g) ?? []).length;
    if (isThesis) {
      thesisCount += 1;
      if (captions !== 0) {
        errors.push(
          `[content] dist: ${slug} has ${captions} figcaptions, expected 0`,
        );
      }
      if (!html.includes("/thesis.pdf")) {
        errors.push(`[content] dist: ${slug} does not link /thesis.pdf`);
      }
      if (filled(study.pdfLabel) && !html.includes(study.pdfLabel)) {
        errors.push(
          `[content] dist: ${slug} does not render the PDF label "${study.pdfLabel}"`,
        );
      }
      if (filled(study.coverAlt) && !html.includes(study.coverAlt)) {
        errors.push(`[content] dist: ${slug} does not render the cover alt text`);
      }
      if (/https?:\/\/(www\.)?(github|gitlab)\./i.test(html)) {
        errors.push(
          `[content] dist: ${slug} contains a repository link; the thesis must not`,
        );
      }
      const distPdf = path.join(ROOT, "dist", "thesis.pdf");
      if (!existsSync(distPdf)) {
        errors.push(`[content] dist: ${distPdf} is absent`);
      } else {
        const size = statSync(distPdf).size;
        if (size !== THESIS_PDF_BYTES) {
          errors.push(
            `[content] dist: ${distPdf} is ${size} bytes, expected ${THESIS_PDF_BYTES}`,
          );
        }
      }
      continue;
    }

    caseCount += 1;
    if (captions !== 3) {
      errors.push(
        `[content] dist: ${slug} has ${captions} figcaptions, expected 3`,
      );
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
      `[content] dist: ${caseCount} case studies render six sections in fixed order with 3 captioned screenshots; ${thesisCount} thesis renders five thesis sections`,
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
let firstThesis;
let caseCount = 0;
let thesisCount = 0;
for (const { slug, filePath, raw } of studies) {
  let study;
  try {
    study = parseFrontmatter(raw, filePath);
  } catch (error) {
    errors.push(`[content] ${error.message}`);
    continue;
  }

  if (study.kind === "thesis") {
    thesisCount += 1;
    firstThesis ??= study;
    for (const error of validateThesis(study, slug)) {
      errors.push(`[content] ${slug}: ${error}`);
    }
    await validateThesisFiles(slug, errors);
    continue;
  }

  if (study.kind !== "case-study") {
    errors.push(
      `[content] ${slug}: kind must be "case-study" or "thesis", got ${String(study.kind)}`,
    );
    continue;
  }

  caseCount += 1;
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
} else if (firstStudy && firstThesis) {
  errors.push(...runSelfTests(firstStudy, firstThesis));
} else {
  errors.push(
    "[content] self-tests need at least one case study and one thesis in the collection",
  );
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
    `[content] ${caseCount} case studies valid: six sections, one decision with rejected + cost, exactly one failure, ${WORD_MIN}-${WORD_MAX} narrative words; ${thesisCount} thesis valid: five adapted sections, three organisations, nine chaincode functions, three or more limits`,
  );
}
