/**
 * Proves both hard failure modes of the asset contract and the sync
 * guarantees that make the committed snapshot reproducible.
 *
 *   npm run test:assets
 *
 * Every case runs against a temporary tree; the committed snapshot is never
 * modified.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const REPO = process.cwd();
const CHECK_SCRIPT = path.join(REPO, "scripts", "check-assets.mjs");
const SYNC_SCRIPT = path.join(REPO, "scripts", "sync-assets.mjs");
const COMMITTED_SNAPSHOT = path.join(REPO, "public", "assets", "ecommerce-platform");
const COMMIT_DATE = "2026-05-04T12:00:00Z";

async function makeTempRoot(label) {
  return mkdtemp(path.join(os.tmpdir(), `asset-${label}-`));
}

async function runScript(script, args, environment) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
      cwd: REPO,
      env: { ...process.env, ...environment },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function makeCheckRoot(mutate) {
  const root = await makeTempRoot("check");
  const projects = path.join(root, "src", "content", "projects");
  const assets = path.join(root, "public", "assets");
  await mkdir(projects, { recursive: true });
  await writeFile(
    path.join(projects, "ecommerce-platform.mdx"),
    "---\ntitle: Full-Stack E-Commerce Platform\n---\n",
  );
  await cp(COMMITTED_SNAPSHOT, path.join(assets, "ecommerce-platform"), {
    recursive: true,
  });

  const manifestPath = path.join(assets, "ecommerce-platform", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const context = { root, assets, manifestPath, manifest };
  if (mutate !== undefined) {
    await mutate(context);
  }
  if (context.manifest !== null) {
    await writeFile(manifestPath, `${JSON.stringify(context.manifest, null, 2)}\n`);
  }
  return context;
}

function check(context) {
  return runScript(CHECK_SCRIPT, [], {
    ASSET_PROJECTS_DIR: path.join(context.root, "src", "content", "projects"),
    ASSET_ROOT: context.assets,
  });
}

test("a valid snapshot passes", async () => {
  const context = await makeCheckRoot();
  try {
    const result = await check(context);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /snapshot check passed/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("a missing manifest degrades to coming soon and exits 0", async () => {
  const context = await makeCheckRoot(async (current) => {
    await unlink(current.manifestPath);
    current.manifest = null;
  });
  try {
    const result = await check(context);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /coming soon/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("three shots fail and name the shots field", async () => {
  const context = await makeCheckRoot((current) => {
    current.manifest.shots = current.manifest.shots.slice(0, 3);
  });
  try {
    const result = await check(context);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /shots/);
    assert.match(result.stderr, /exactly 4 entries/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("a numeric measured value fails and names proof.measured[0].value", async () => {
  const context = await makeCheckRoot((current) => {
    current.manifest.proof.measured[0].value = 180;
  });
  try {
    const result = await check(context);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /proof\.measured\[0\]\.value/);
    assert.match(result.stderr, /must be a string/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("two limits fail and name proof.limits", async () => {
  const context = await makeCheckRoot((current) => {
    current.manifest.proof.limits = current.manifest.proof.limits.slice(0, 2);
  });
  try {
    const result = await check(context);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /proof\.limits/);
    assert.match(result.stderr, /at least 3 entries/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("a shot absent from disk fails and names shots[0].file", async () => {
  const context = await makeCheckRoot(async (current) => {
    await unlink(path.join(current.assets, "ecommerce-platform", "hero.webp"));
  });
  try {
    const result = await check(context);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /shots\[0\]\.file/);
    assert.match(result.stderr, /absent from disk/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("a missing proof artifact fails and names proof.measured[0].artifact", async () => {
  const context = await makeCheckRoot(async (current) => {
    // Derive the path from the manifest: which measurement leads the list is
    // the source repo's call, and the test should not pin it to one artifact.
    const artifact = current.manifest.proof.measured[0].artifact;
    await unlink(
      path.join(
        current.assets,
        "ecommerce-platform",
        "proof",
        ...artifact.split("/"),
      ),
    );
  });
  try {
    const result = await check(context);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /proof\.measured\[0\]\.artifact/);
    assert.match(result.stderr, /absent from the snapshot/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("an invariant test must point at a test path", async () => {
  const context = await makeCheckRoot((current) => {
    current.manifest.proof.invariants[0].test = "docs/load/checkout.md";
  });
  try {
    const result = await check(context);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /proof\.invariants\[0\]\.test/);
    assert.match(result.stderr, /test path/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("a missing invariant test file fails", async () => {
  const context = await makeCheckRoot((current) => {
    current.manifest.proof.invariants[0].test = "tests/does-not-exist.spec.ts";
  });
  try {
    const result = await check(context);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /proof\.invariants\[0\]\.test/);
    assert.match(result.stderr, /absent from the snapshot/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

async function makeSourceRepo(mutate) {
  const parent = await makeTempRoot("sync-source");
  const source = path.join(parent, "ecommerce-platform");
  for (const file of ["manifest.json", "hero.webp", "shot-01.webp", "shot-02.webp", "shot-03.webp"]) {
    await cp(path.join(COMMITTED_SNAPSHOT, file), path.join(source, file));
  }

  // Rebuild the source layout: the snapshot stores proof files under proof/,
  // while the source repo keeps the same paths at its root.
  for (const entry of await readdir(path.join(COMMITTED_SNAPSHOT, "proof"))) {
    await cp(
      path.join(COMMITTED_SNAPSHOT, "proof", entry),
      path.join(source, entry),
      { recursive: true },
    );
  }

  const manifestPath = path.join(source, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const context = { parent, source, manifest, manifestPath };
  if (mutate !== undefined) {
    await mutate(context);
  }
  await writeFile(manifestPath, `${JSON.stringify(context.manifest, null, 2)}\n`);

  const git = async (args, environment = {}) =>
    execFileAsync("git", args, {
      cwd: source,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: COMMIT_DATE,
        GIT_COMMITTER_DATE: COMMIT_DATE,
        ...environment,
      },
    });
  await git(["init", "-q"]);
  await git(["config", "user.name", "Asset Sync Test"]);
  await git(["config", "user.email", "asset-sync@example.invalid"]);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "fixture snapshot"]);

  return context;
}

async function makeTargetRoot() {
  const root = await makeTempRoot("sync-target");
  const projects = path.join(root, "src", "content", "projects");
  await mkdir(projects, { recursive: true });
  await writeFile(
    path.join(projects, "ecommerce-platform.mdx"),
    `---
order: 1
title: Old title
oneLiner: Old one-liner.
stack:
  - Old
updatedAt: "2026-01-01"
claim: >-
  Prose stays put.
---
Body prose stays put.
`,
  );
  return root;
}

function sync(sourceParent, targetRoot) {
  return runScript(SYNC_SCRIPT, ["--from", sourceParent, "--root", targetRoot], {});
}

test("sync copies manifest, shots and proof, and sets only the three owned fields", async () => {
  const source = await makeSourceRepo((context) => {
    context.manifest.title = "Ecommerce Sync";
    context.manifest.oneLiner = "A synced one-liner.";
    context.manifest.stack = ["Next.js", "TypeScript", "PostgreSQL"];
  });
  const target = await makeTargetRoot();
  try {
    const result = await sync(source.parent, target);
    assert.equal(result.code, 0, result.stderr);

    const copied = JSON.parse(
      await readFile(
        path.join(target, "public", "assets", "ecommerce-platform", "manifest.json"),
        "utf8",
      ),
    );
    assert.equal(copied.title, "Ecommerce Sync");

    for (const file of ["hero.webp", "shot-01.webp", "shot-02.webp", "shot-03.webp"]) {
      const [sourceBytes, targetBytes] = await Promise.all([
        readFile(path.join(source.source, file)),
        readFile(path.join(target, "public", "assets", "ecommerce-platform", file)),
      ]);
      assert.deepEqual(targetBytes, sourceBytes, `${file} should be copied byte for byte`);
    }

    // Proof artifacts are evidence: assert the copy is byte-identical rather
    // than matching text that the source repo is free to rewrite.
    const proofPath = path.join(
      "tests",
      "integration",
      "checkout.forged-price.test.ts",
    );
    const [sourceProof, targetProof] = await Promise.all([
      readFile(path.join(source.source, proofPath)),
      readFile(
        path.join(target, "public", "assets", "ecommerce-platform", "proof", proofPath),
      ),
    ]);
    assert.deepEqual(targetProof, sourceProof, "proof artifact should be copied byte for byte");

    const page = await readFile(
      path.join(target, "src", "content", "projects", "ecommerce-platform.mdx"),
      "utf8",
    );
    assert.match(page, /^title: Ecommerce Sync$/m);
    assert.match(page, /^oneLiner: A synced one-liner\.$/m);
    assert.match(page, /^stack:\n  - Next\.js\n  - TypeScript\n  - PostgreSQL$/m);
    assert.doesNotMatch(page, /^updatedAt:/m);
    assert.match(page, /^claim: >-\n  Prose stays put\.$/m);
    assert.match(page, /Body prose stays put\./);
    assert.doesNotMatch(page, /Old title/);
  } finally {
    await rm(source.parent, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("sync is idempotent: a second run changes no bytes", async () => {
  const source = await makeSourceRepo();
  const target = await makeTargetRoot();
  try {
    assert.equal((await sync(source.parent, target)).code, 0);

    const files = [
      "public/assets/ecommerce-platform/manifest.json",
      "public/assets/ecommerce-platform/hero.webp",
      "public/assets/ecommerce-platform/proof/scripts/live-payment-proof.mjs",
      "public/assets/ecommerce-platform/proof/tests/integration/checkout.forged-price.test.ts",
      "src/content/projects/ecommerce-platform.mdx",
    ];
    const before = await Promise.all(
      files.map((file) => readFile(path.join(target, ...file.split("/")))),
    );

    const second = await sync(source.parent, target);
    assert.equal(second.code, 0, second.stderr);

    const after = await Promise.all(
      files.map((file) => readFile(path.join(target, ...file.split("/")))),
    );
    for (const [index, file] of files.entries()) {
      assert.deepEqual(after[index], before[index], `${file} changed on the second run`);
    }
  } finally {
    await rm(source.parent, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("sync refuses an invalid source manifest and writes nothing", async () => {
  const source = await makeSourceRepo((context) => {
    context.manifest.proof.measured[0].value = 180;
  });
  const target = await makeTargetRoot();
  try {
    const result = await sync(source.parent, target);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /proof\.measured\[0\]\.value/);
    await assert.rejects(
      readFile(
        path.join(target, "public", "assets", "ecommerce-platform", "manifest.json"),
      ),
      { code: "ENOENT" },
    );
  } finally {
    await rm(source.parent, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("sync refuses a source manifest whose proof artifact is missing", async () => {
  const source = await makeSourceRepo(async (context) => {
    await unlink(
      path.join(
        context.source,
        "tests",
        "integration",
        "checkout.forged-price.test.ts",
      ),
    );
  });
  const target = await makeTargetRoot();
  try {
    const result = await sync(source.parent, target);
    assert.notEqual(result.code, 0);
    assert.match(
      result.stderr,
      /tests\/integration\/checkout\.forged-price\.test\.ts/,
    );
    await assert.rejects(
      readFile(
        path.join(target, "public", "assets", "ecommerce-platform", "manifest.json"),
      ),
      { code: "ENOENT" },
    );
  } finally {
    await rm(source.parent, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});
