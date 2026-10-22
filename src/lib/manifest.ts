import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

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

const shotSchema = z.object({
  file: z.string().regex(/^(hero|shot-0[1-3])\.webp$/),
  width: z.literal(2880),
  height: z.literal(1800),
  alt: z.string().min(1),
});

const shotOrder = ["hero.webp", "shot-01.webp", "shot-02.webp", "shot-03.webp"];

export const projectManifestSchema = z
  .object({
    project: z.string().min(1),
    generatedAt: z.string().datetime(),
    seeded: z.literal(true),
    shots: z.array(shotSchema).length(4),
  })
  .superRefine((manifest, context) => {
    manifest.shots.forEach((shot, index) => {
      if (shot.file !== shotOrder[index]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `shot ${index + 1} must be ${shotOrder[index]}`,
          path: ["shots", index, "file"],
        });
      }
    });
  });

export type ProjectManifest = z.infer<typeof projectManifestSchema>;
export type ManifestShot = ProjectManifest["shots"][number];

const assetsRoot = path.join(process.cwd(), "public", "assets");

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function describeIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`)
    .join("; ");
}

/**
 * Reads the committed snapshot manifest for a project. A missing manifest is a
 * supported state and returns null; a malformed manifest or absent shot is a
 * hard build failure.
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

  return parsed.data;
}
