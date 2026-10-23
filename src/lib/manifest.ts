import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  describeIssues,
  projectManifestSchema,
  resolveInside,
} from "./manifest-schema.mjs";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)");

export const projectSchema = z.object({
  order: z.number().int().positive(),
  title: z.string().min(1).max(80),
  oneLiner: z.string().min(1).max(180),
  stack: z.array(z.string().min(1).max(40)).min(1).max(6),
  updatedAt: isoDate,
});

export type Project = z.infer<typeof projectSchema>;

// The shared schema treats `demo` as optional, accepts an optional
// `previewCommand`, and still rejects any other malformed field.
export { projectManifestSchema };

export type ProjectManifest = z.infer<typeof projectManifestSchema>;
export type ManifestShot = ProjectManifest["shots"][number];
export type ManifestProof = ProjectManifest["proof"];

const assetsRoot = path.join(process.cwd(), "public", "assets");

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function assertProofFile(
  proofRoot: string,
  relativePath: string,
  field: string,
  manifestPath: string,
): Promise<void> {
  const resolved = resolveInside(proofRoot, relativePath);
  if (resolved === null) {
    throw new Error(
      `Invalid asset manifest at ${manifestPath}: ${field} is not a safe repo-relative path ("${relativePath}")`,
    );
  }
  try {
    await access(resolved);
  } catch (error) {
    throw new Error(
      `Asset manifest references a missing proof file at ${field}: expected ${resolved} (copied from ${relativePath} by sync:assets)`,
      { cause: error },
    );
  }
}

/**
 * Reads the committed snapshot manifest for a project. A missing manifest is a
 * supported state and returns null; a malformed manifest, an absent shot or an
 * absent proof artifact is a hard build failure.
 */
export async function readProjectManifest(
  slug: string,
): Promise<ProjectManifest | null> {
  const manifestPath = path.join(assetsRoot, slug, "manifest.json");
  let raw: string;

  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw new Error(`Could not read ${manifestPath}`, { cause: error });
  }

  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${manifestPath}`, { cause: error });
  }

  const parsed = projectManifestSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Invalid asset manifest at ${manifestPath}: ${describeIssues(parsed.error.issues)}`,
    );
  }

  if (parsed.data.project !== slug) {
    throw new Error(
      `Asset manifest ${manifestPath} names project "${parsed.data.project}", expected "${slug}"`,
    );
  }

  for (const shot of parsed.data.shots) {
    const shotPath = path.join(assetsRoot, slug, shot.file);
    try {
      await access(shotPath);
    } catch (error) {
      throw new Error(`Asset manifest references a missing shot: ${shotPath}`, {
        cause: error,
      });
    }
  }

  const proofRoot = path.join(assetsRoot, slug, "proof");
  for (const [index, measured] of parsed.data.proof.measured.entries()) {
    await assertProofFile(
      proofRoot,
      measured.artifact,
      `proof.measured[${index}].artifact`,
      manifestPath,
    );
  }
  for (const [index, invariant] of parsed.data.proof.invariants.entries()) {
    await assertProofFile(
      proofRoot,
      invariant.test,
      `proof.invariants[${index}].test`,
      manifestPath,
    );
  }

  return parsed.data;
}
