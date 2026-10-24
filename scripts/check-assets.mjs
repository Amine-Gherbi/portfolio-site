#!/usr/bin/env node
/**
 * Validates committed asset manifests against the full snapshot contract.
 *
 * Missing manifest: a supported "coming soon" state, exit 0.
 * Invalid manifest, absent shot, or absent proof artifact: a hard failure,
 * exit 1, with the offending field named.
 *
 * Environment overrides exist for tests only:
 *   ASSET_PROJECTS_DIR  directory holding <slug>.mdx (default src/content/projects)
 *   ASSET_ROOT          directory holding <slug>/manifest.json (default public/assets)
 */
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { parse as parseYaml } from "yaml";
import {
  describeIssues,
  projectManifestSchema,
  resolveInside,
  SHOT_HEIGHT,
  SHOT_WIDTH,
} from "../src/lib/manifest-schema.mjs";

const ROOT = process.cwd();
const projectsDirectory = process.env.ASSET_PROJECTS_DIR
  ? path.resolve(ROOT, process.env.ASSET_PROJECTS_DIR)
  : path.join(ROOT, "src", "content", "projects");
const assetsDirectory = process.env.ASSET_ROOT
  ? path.resolve(ROOT, process.env.ASSET_ROOT)
  : path.join(ROOT, "public", "assets");

const relativeToRepo = (target) =>
  path.relative(ROOT, target).split(path.sep).join("/");

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function inspectShot(filePath) {
  try {
    const metadata = await sharp(filePath).metadata();
    return metadata;
  } catch {
    return null;
  }
}

async function frontmatterKind(filePath) {
  const raw = await readFile(filePath, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) {
    return null;
  }
  const data = parseYaml(match[1] ?? "");
  return data && typeof data === "object" ? data.kind : null;
}

async function checkProofFiles(manifest, slug, assetDirectory) {
  const errors = [];
  const proofRoot = path.join(assetDirectory, "proof");

  for (const [index, measured] of manifest.proof.measured.entries()) {
    const field = `proof.measured[${index}].artifact`;
    const resolved = resolveInside(proofRoot, measured.artifact);
    if (resolved === null) {
      errors.push(`${field} is not a safe repo-relative path: "${measured.artifact}"`);
      continue;
    }
    if (!(await fileExists(resolved))) {
      errors.push(
        `${field} is absent from the snapshot: ${relativeToRepo(resolved)} (source path "${measured.artifact}")`,
      );
    }
  }

  for (const [index, invariant] of manifest.proof.invariants.entries()) {
    const field = `proof.invariants[${index}].test`;
    const resolved = resolveInside(proofRoot, invariant.test);
    if (resolved === null) {
      errors.push(`${field} is not a safe repo-relative path: "${invariant.test}"`);
      continue;
    }
    if (!(await fileExists(resolved))) {
      errors.push(
        `${field} is absent from the snapshot: ${relativeToRepo(resolved)} (source path "${invariant.test}")`,
      );
    }
  }

  return errors;
}

async function checkShots(manifest, slug, assetDirectory) {
  const errors = [];

  for (const [index, shot] of manifest.shots.entries()) {
    const field = `shots[${index}].file`;
    const shotPath = path.join(assetDirectory, shot.file);
    if (!(await fileExists(shotPath))) {
      errors.push(`${field} is absent from disk: ${relativeToRepo(shotPath)}`);
      continue;
    }

    const metadata = await inspectShot(shotPath);
    if (metadata === null) {
      errors.push(`${field} is not a readable image: ${relativeToRepo(shotPath)}`);
      continue;
    }
    if (metadata.format !== "webp") {
      errors.push(`${field} must be WebP, found ${String(metadata.format)}`);
    }
    if (metadata.width !== SHOT_WIDTH || metadata.height !== SHOT_HEIGHT) {
      errors.push(
        `${field} is ${String(metadata.width)}x${String(metadata.height)}, expected ${SHOT_WIDTH}x${SHOT_HEIGHT}`,
      );
    }
  }

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
let theses = 0;

for (const projectFile of projectFiles) {
  const slug = path.basename(projectFile, ".mdx");

  if ((await frontmatterKind(path.join(projectsDirectory, projectFile))) === "thesis") {
    console.log(
      `[assets] ${slug}: thesis entry — static cover and PDF, no manifest`,
    );
    theses += 1;
    continue;
  }

  const assetDirectory = path.join(assetsDirectory, slug);
  const manifestPath = path.join(assetDirectory, "manifest.json");

  if (!(await fileExists(manifestPath))) {
    console.log(`[assets] ${slug}: no manifest — card will say "coming soon"`);
    comingSoon += 1;
    continue;
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    failures.push(`${slug}: manifest.json: invalid JSON (${error.message})`);
    continue;
  }

  const parsed = projectManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    failures.push(`${slug}: ${describeIssues(parsed.error.issues)}`);
    continue;
  }

  const errors = [];
  if (parsed.data.project !== slug) {
    errors.push(
      `project is "${parsed.data.project}", expected "${slug}" (the directory name wins)`,
    );
  }

  errors.push(...(await checkShots(parsed.data, slug, assetDirectory)));
  errors.push(...(await checkProofFiles(parsed.data, slug, assetDirectory)));

  if (errors.length > 0) {
    failures.push(`${slug}: ${errors.join("; ")}`);
  } else {
    console.log(
      `[assets] ${slug}: manifest valid, 4 shots present, ${parsed.data.proof.measured.length} measurements and ${parsed.data.proof.invariants.length} invariants backed by files`,
    );
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
  `[assets] ${ready} ready, ${comingSoon} without a manifest, ${theses} thesis entry with static assets; snapshot check passed`,
);
