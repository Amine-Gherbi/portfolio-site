#!/usr/bin/env node
/**
 * Validates committed asset manifests.
 *
 * Missing manifest: a supported "coming soon" state, exit 0.
 * Invalid manifest or missing shot: a hard failure, exit 1.
 */
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const projectsDirectory = path.join(ROOT, "src", "content", "projects");
const assetsDirectory = path.join(ROOT, "public", "assets");
const SHOT_ORDER = ["hero.webp", "shot-01.webp", "shot-02.webp", "shot-03.webp"];

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function validateManifest(manifest, slug) {
  const errors = [];

  if (!isObject(manifest)) {
    return ["manifest must be a JSON object"];
  }

  if (manifest.project !== slug) {
    errors.push(`project is "${String(manifest.project)}", expected "${slug}"`);
  }

  if (typeof manifest.generatedAt !== "string" || Number.isNaN(Date.parse(manifest.generatedAt))) {
    errors.push("generatedAt must be an ISO timestamp");
  }

  if (manifest.seeded !== true) {
    errors.push("seeded must be true");
  }

  if (!Array.isArray(manifest.shots)) {
    errors.push("shots must be an array");
    return errors;
  }

  if (manifest.shots.length !== SHOT_ORDER.length) {
    errors.push(`shots must contain exactly ${SHOT_ORDER.length} entries`);
  }

  manifest.shots.forEach((shot, index) => {
    const prefix = `shots[${index}]`;
    if (!isObject(shot)) {
      errors.push(`${prefix} must be an object`);
      return;
    }

    if (shot.file !== SHOT_ORDER[index]) {
      errors.push(`${prefix}.file must be "${SHOT_ORDER[index]}", got "${String(shot.file)}"`);
    }
    if (shot.width !== 2880 || shot.height !== 1800) {
      errors.push(`${prefix} must declare 2880x1800`);
    }
    if (typeof shot.alt !== "string" || shot.alt.trim() === "") {
      errors.push(`${prefix}.alt must be a non-empty string`);
    }
  });

  return errors;
}

let projectFiles;
try {
  projectFiles = (await readdir(projectsDirectory))
    .filter((file) => file.endsWith(".mdx"))
    .sort();
} catch (error) {
  console.error(`[assets] cannot read ${projectsDirectory}: ${error.message}`);
  process.exit(1);
}

if (projectFiles.length === 0) {
  console.error(`[assets] no case-study MDX files found in ${projectsDirectory}`);
  process.exit(1);
}

const failures = [];
let ready = 0;
let comingSoon = 0;

for (const projectFile of projectFiles) {
  const slug = path.basename(projectFile, ".mdx");
  const manifestPath = path.join(assetsDirectory, slug, "manifest.json");

  if (!(await fileExists(manifestPath))) {
    console.log(`[assets] ${slug}: no manifest — card will say "coming soon"`);
    comingSoon += 1;
    continue;
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    failures.push(`${slug}: invalid manifest JSON (${error.message})`);
    continue;
  }

  const errors = validateManifest(manifest, slug);

  if (Array.isArray(manifest?.shots)) {
    for (const [index, shot] of manifest.shots.entries()) {
      if (!isObject(shot) || typeof shot.file !== "string") {
        continue;
      }

      const shotPath = path.join(assetsDirectory, slug, shot.file);
      if (!(await fileExists(shotPath))) {
        errors.push(`shots[${index}].file is absent from disk: ${shotPath}`);
      } else if (!/\.webp$/i.test(shot.file)) {
        errors.push(`shots[${index}].file must be a .webp image`);
      }
    }
  }

  if (errors.length > 0) {
    failures.push(`${slug}: ${errors.join("; ")}`);
  } else {
    console.log(`[assets] ${slug}: manifest valid, 4 shots present`);
    ready += 1;
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[assets] FAIL ${failure}`);
  }
  console.error(
    `[assets] ${failures.length} invalid project snapshot(s); refusing to continue`,
  );
  process.exit(1);
}

console.log(
  `[assets] ${ready} ready, ${comingSoon} without a manifest; snapshot check passed`,
);
