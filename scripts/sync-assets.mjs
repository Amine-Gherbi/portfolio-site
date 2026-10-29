#!/usr/bin/env node
/**
 * Copies validated asset manifests, shots and proof files from a source tree
 * into the committed snapshot.
 *
 *   npm run sync:assets -- --from P:/portfolio/_shared/assets
 *
 * Owned outputs only: public/assets/<slug>/** plus the three frontmatter fields
 * title, oneLiner and stack. Prose is never rewritten.
 *
 * No date is written anywhere: the hub renders no timestamp, so sync removes
 * any legacy updatedAt field instead of sourcing one from git. Re-running on
 * unchanged assets produces no diff.
 *
 * Flags:
 *   --from <dir>            source tree (required)
 *   --repo <slug>=<path>    source repository for one slug (repeatable)
 *   --repo-root <path>      source repository for every slug without a mapping
 *   --root <dir>            project root to write into (tests; default cwd)
 *   --dry-run               validate and report, write nothing
 *
 * Discovery: direct children of --from. Underscore-prefixed directories,
 * including _fixtures, are ignored: fixtures must never reach the snapshot.
 */
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import sharp from "sharp";
import {
  describeIssues,
  projectManifestSchema,
  resolveInside,
  SHOT_HEIGHT,
  SHOT_WIDTH,
} from "../src/lib/manifest-schema.mjs";

const FRONTMATTER = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n[\s\S]*)?)$/;

class SyncError extends Error {}

function parseArgs(argv) {
  const options = {
    from: null,
    root: process.cwd(),
    repoRoot: null,
    repos: new Map(),
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new SyncError(`${arg} needs a value`);
      }
      index += 1;
      return value;
    };

    if (arg === "--from") {
      options.from = path.resolve(next());
    } else if (arg === "--root") {
      options.root = path.resolve(next());
    } else if (arg === "--repo-root") {
      options.repoRoot = path.resolve(next());
    } else if (arg === "--repo") {
      const pair = next();
      const separator = pair.indexOf("=");
      if (separator < 1) {
        throw new SyncError('--repo expects <slug>=<path>');
      }
      options.repos.set(
        pair.slice(0, separator),
        path.resolve(pair.slice(separator + 1)),
      );
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else {
      throw new SyncError(`unknown option ${arg}`);
    }
  }

  if (options.from === null) {
    throw new SyncError("--from <dir> is required");
  }
  return options;
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function discoverProjects(fromDirectory) {
  const projects = [];

  const addProject = async (name, projectDirectory) => {
    if (!(await fileExists(path.join(projectDirectory, "manifest.json")))) {
      console.warn(`[sync] ${name}: no manifest.json in ${projectDirectory}; skipped`);
      return;
    }
    projects.push({ slug: name, sourceDirectory: projectDirectory });
  };

  const entries = await readdir(fromDirectory, { withFileTypes: true });
  const regular = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of regular) {
    await addProject(entry.name, path.join(fromDirectory, entry.name));
  }

  return projects;
}

async function resolveRepoRoot(project, options, fromDirectory) {
  if (options.repos.has(project.slug)) {
    return options.repos.get(project.slug);
  }
  if (options.repoRoot !== null) {
    return options.repoRoot;
  }
  if (await fileExists(path.join(project.sourceDirectory, ".git"))) {
    return project.sourceDirectory;
  }
  const sibling = path.resolve(fromDirectory, "..", "..", project.slug);
  if (await fileExists(path.join(sibling, ".git"))) {
    return sibling;
  }
  return null;
}

function yamlScalar(value) {
  const plain = /^[A-Za-z][A-Za-z0-9 .,()/&+#_-]*$/;
  const reserved = /^(true|false|null|yes|no|on|off|~)$/i;
  if (plain.test(value) && !reserved.test(value) && !value.endsWith(" ")) {
    return value;
  }
  return JSON.stringify(value);
}

function replaceScalar(frontmatter, key, value) {
  const line = new RegExp(`^${key}:[^\\n]*$`, "m");
  const rendered = `${key}: ${yamlScalar(value)}`;
  if (line.test(frontmatter)) {
    return frontmatter.replace(line, rendered);
  }
  return `${frontmatter}\n${rendered}`;
}

function replaceStack(frontmatter, stack) {
  const rendered = `stack:\n${stack.map((entry) => `  - ${yamlScalar(entry)}`).join("\n")}`;
  const block = /^stack:[^\n]*(?:\n[ \t]+[^\n]*)*/m;
  if (block.test(frontmatter)) {
    return frontmatter.replace(block, rendered);
  }
  const order = /^order:[^\n]*\n/m;
  if (order.test(frontmatter)) {
    return frontmatter.replace(order, (match) => `${match}${rendered}\n`);
  }
  return `${frontmatter}\n${rendered}`;
}

function removeScalar(frontmatter, key) {
  return frontmatter.replace(new RegExp(`^${key}:[^\\n]*\\n?`, "m"), "");
}

/**
 * Rewrites only the three fields sync owns and removes a legacy updatedAt.
 * Every other byte of the file, including all prose fields and body, is
 * preserved verbatim.
 */
function updateFrontmatter(raw, slug, fields) {
  const match = FRONTMATTER.exec(raw);
  if (match === null) {
    throw new SyncError(`${slug}: case-study MDX has no YAML frontmatter`);
  }

  let frontmatter = match[2] ?? "";
  frontmatter = replaceScalar(frontmatter, "title", fields.title);
  frontmatter = replaceScalar(frontmatter, "oneLiner", fields.oneLiner);
  frontmatter = replaceStack(frontmatter, fields.stack);
  frontmatter = removeScalar(frontmatter, "updatedAt");

  let parsed;
  try {
    parsed = parseYaml(frontmatter);
  } catch (error) {
    throw new SyncError(`${slug}: sync would produce invalid YAML (${error.message})`);
  }
  if (
    parsed?.title !== fields.title ||
    parsed?.oneLiner !== fields.oneLiner ||
    JSON.stringify(parsed?.stack) !== JSON.stringify(fields.stack) ||
    (parsed !== null && typeof parsed === "object" && "updatedAt" in parsed)
  ) {
    throw new SyncError(`${slug}: sync could not set the three owned frontmatter fields`);
  }

  return `${match[1]}${frontmatter}${match[3]}`;
}

async function collectProofFiles(manifest, repoRoot) {
  const files = new Map();
  const errors = [];

  const add = (relativePath, field) => {
    const resolved = resolveInside(repoRoot, relativePath);
    if (resolved === null) {
      errors.push(`${field} is not a safe repo-relative path: "${relativePath}"`);
      return;
    }
    files.set(relativePath, resolved);
  };

  manifest.proof.measured.forEach((measured, index) => {
    add(measured.artifact, `proof.measured[${index}].artifact`);
  });
  manifest.proof.invariants.forEach((invariant, index) => {
    add(invariant.test, `proof.invariants[${index}].test`);
  });

  for (const [relativePath, resolved] of files) {
    if (!(await fileExists(resolved))) {
      errors.push(
        `proof path absent from source repository ${repoRoot}: "${relativePath}"`,
      );
      files.delete(relativePath);
    }
  }

  return { files, errors };
}

async function planProject(project, options, fromDirectory) {
  const manifestPath = path.join(project.sourceDirectory, "manifest.json");
  const rawManifest = await readFile(manifestPath);

  let data;
  try {
    data = JSON.parse(rawManifest.toString("utf8"));
  } catch (error) {
    throw new SyncError(`${project.slug}: manifest.json is not valid JSON (${error.message})`);
  }

  const parsed = projectManifestSchema.safeParse(data);
  if (!parsed.success) {
    throw new SyncError(`${project.slug}: ${describeIssues(parsed.error.issues)}`);
  }
  const manifest = parsed.data;

  if (manifest.project !== project.slug) {
    throw new SyncError(
      `${project.slug}: project is "${manifest.project}", expected "${project.slug}"`,
    );
  }

  const errors = [];

  for (const [index, shot] of manifest.shots.entries()) {
    const shotPath = path.join(project.sourceDirectory, shot.file);
    if (!(await fileExists(shotPath))) {
      errors.push(`shots[${index}].file is absent from source: ${shotPath}`);
      continue;
    }
    try {
      const metadata = await sharp(shotPath).metadata();
      if (metadata.format !== "webp") {
        errors.push(`shots[${index}].file must be WebP, found ${String(metadata.format)}`);
      }
      if (metadata.width !== SHOT_WIDTH || metadata.height !== SHOT_HEIGHT) {
        errors.push(
          `shots[${index}].file is ${String(metadata.width)}x${String(metadata.height)}, expected ${SHOT_WIDTH}x${SHOT_HEIGHT}`,
        );
      }
    } catch {
      errors.push(`shots[${index}].file is not a readable image: ${shotPath}`);
    }
  }

  const repoRoot = await resolveRepoRoot(project, options, fromDirectory);
  if (repoRoot === null) {
    errors.push(
      `no source repository for ${project.slug}; pass --repo ${project.slug}=<path> or --repo-root <path>`,
    );
  }

  let proofFiles = new Map();
  if (repoRoot !== null) {
    const proof = await collectProofFiles(manifest, repoRoot);
    proofFiles = proof.files;
    errors.push(...proof.errors);
  }

  if (errors.length > 0) {
    throw new SyncError(`${project.slug}: ${errors.join("; ")}`);
  }

  return {
    slug: project.slug,
    sourceDirectory: project.sourceDirectory,
    repoRoot,
    manifest,
    rawManifest,
    proofFiles,
  };
}

async function applyProject(plan, options) {
  const targetDirectory = path.join(options.root, "public", "assets", plan.slug);
  const actions = [];

  if (!options.dryRun) {
    await mkdir(path.join(targetDirectory, "proof"), { recursive: true });
  }

  const copy = async (source, target) => {
    actions.push(path.relative(options.root, target).split(path.sep).join("/"));
    if (!options.dryRun) {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }
  };

  await copy(
    path.join(plan.sourceDirectory, "manifest.json"),
    path.join(targetDirectory, "manifest.json"),
  );
  for (const shot of plan.manifest.shots) {
    await copy(
      path.join(plan.sourceDirectory, shot.file),
      path.join(targetDirectory, shot.file),
    );
  }
  for (const [relativePath, source] of plan.proofFiles) {
    const target = resolveInside(path.join(targetDirectory, "proof"), relativePath);
    if (target === null) {
      throw new SyncError(`${plan.slug}: unsafe proof path "${relativePath}"`);
    }
    await copy(source, target);
  }

  const pagePath = path.join(
    options.root,
    "src",
    "content",
    "projects",
    `${plan.slug}.mdx`,
  );
  if (await fileExists(pagePath)) {
    const original = await readFile(pagePath, "utf8");
    const updated = updateFrontmatter(original, plan.slug, {
      title: plan.manifest.title,
      oneLiner: plan.manifest.oneLiner,
      stack: plan.manifest.stack,
    });
    if (updated !== original) {
      actions.push(
        `src/content/projects/${plan.slug}.mdx (title, oneLiner, stack)`,
      );
      if (!options.dryRun) {
        await writeFile(pagePath, updated, "utf8");
      }
    }
  } else {
    console.warn(
      `[sync] ${plan.slug}: no src/content/projects/${plan.slug}.mdx; assets copied without card fields`,
    );
  }

  for (const action of actions) {
    console.log(`[sync] ${plan.slug}: ${options.dryRun ? "would write" : "wrote"} ${action}`);
  }

  return actions.length;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!(await isDirectory(options.from))) {
    throw new SyncError(`--from is not a directory: ${options.from}`);
  }

  const projects = await discoverProjects(options.from);
  if (projects.length === 0) {
    throw new SyncError(`no project manifests found under ${options.from}`);
  }

  const plans = [];
  const failures = [];
  for (const project of projects) {
    try {
      plans.push(await planProject(project, options, options.from));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`[sync] FAIL ${failure}`);
    }
    console.error(`[sync] ${failures.length} invalid source project(s); nothing was written`);
    process.exit(1);
  }

  let writes = 0;
  for (const plan of plans) {
    writes += await applyProject(plan, options);
    console.log(
      `[sync] ${plan.slug}: source ${plan.repoRoot}`,
    );
  }

  console.log(
    `[sync] ${plans.length} project(s), ${writes} file(s) ${options.dryRun ? "planned" : "written"}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`[sync] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
