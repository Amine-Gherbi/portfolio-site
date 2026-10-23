/**
 * The snapshot asset contract, shared by the build (src/lib/manifest.ts) and
 * the two scripts that own it (scripts/check-assets.mjs,
 * scripts/sync-assets.mjs). Keeping one schema means the build, CI and the
 * local sync cannot drift apart.
 *
 * Plain .mjs on purpose: the Node scripts cannot import TypeScript, and a
 * second hand-written validator is exactly how a contract rots.
 */
import path from "node:path";
import { z } from "zod";

export const SHOT_WIDTH = 2880;
export const SHOT_HEIGHT = 1800;

export const SHOT_ORDER = [
  "hero.webp",
  "shot-01.webp",
  "shot-02.webp",
  "shot-03.webp",
];

const requiredText = (label, max) => {
  const base = z
    .string({
      required_error: `${label} is required`,
      invalid_type_error: `${label} must be a string`,
    })
    .trim()
    .min(1, `${label} must not be empty`);
  return max === undefined ? base : base.max(max, `${label} must be at most ${max} characters`);
};

/**
 * A proof artifact is named relative to the source repository root and copied
 * into the snapshot unchanged. Reject anything that could escape the proof
 * directory on Windows or POSIX.
 */
export function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  if (value.includes("\\") || value.includes("\0")) {
    return false;
  }
  if (path.posix.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) {
    return false;
  }
  return value
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function isTestPath(value) {
  if (typeof value !== "string") {
    return false;
  }
  return (
    /(^|\/)(tests?|__tests__)\//.test(value) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(value)
  );
}

/**
 * Resolves a contract path inside `base`. Returns null when the path is not
 * safe, so callers can report the offending field instead of touching disk.
 */
export function resolveInside(base, relativePath) {
  if (!isSafeRelativePath(relativePath)) {
    return null;
  }
  const target = path.resolve(base, ...relativePath.split("/"));
  const prefix = path.resolve(base) + path.sep;
  return target.startsWith(prefix) ? target : null;
}

const repoPath = (label) =>
  requiredText(label).refine(
    isSafeRelativePath,
    `${label} must be a repo-relative POSIX path without ".." or backslashes`,
  );

const measuredSchema = z.object({
  label: requiredText("proof.measured[].label"),
  value: z
    .string({
      required_error: "proof.measured[].value is required",
      invalid_type_error: "proof.measured[].value must be a string",
    })
    .min(1, "proof.measured[].value must not be empty"),
  method: requiredText("proof.measured[].method"),
  artifact: repoPath("proof.measured[].artifact"),
});

const invariantSchema = z.object({
  claim: requiredText("proof.invariants[].claim"),
  test: repoPath("proof.invariants[].test").refine(
    isTestPath,
    'proof.invariants[].test must point at a test path (tests/… or *.test.* / *.spec.*)',
  ),
});

const proofSchema = z.object({
  measured: z
    .array(measuredSchema)
    .min(1, "proof.measured must contain at least one measurement"),
  invariants: z
    .array(invariantSchema)
    .min(1, "proof.invariants must contain at least one invariant"),
  limits: z
    .array(requiredText("proof.limits[]"))
    .min(3, "proof.limits must contain at least 3 entries"),
});

/**
 * A demo block is optional and never required for a snapshot to be valid. A
 * project may describe how it is previewed locally, but a missing demo is not
 * a contract failure and an invalid one still is.
 */
const demoSchema = z
  .object({
    demoUrl: z.string().url("demo.demoUrl must be an absolute URL").optional(),
    demoLogin: z.unknown().optional(),
    previewCommand: requiredText("demo.previewCommand").optional(),
  })
  .partial();

const shotSchema = z.object({
  file: z
    .string()
    .regex(/^(hero|shot-0[1-3])\.webp$/, "shots[].file must be hero.webp or shot-01..03.webp"),
  width: z.literal(SHOT_WIDTH, {
    errorMap: () => ({ message: `shots[].width must be ${SHOT_WIDTH}` }),
  }),
  height: z.literal(SHOT_HEIGHT, {
    errorMap: () => ({ message: `shots[].height must be ${SHOT_HEIGHT}` }),
  }),
  alt: requiredText("shots[].alt"),
});

export const projectManifestSchema = z
  .object({
    project: requiredText("project"),
    title: requiredText("title", 80),
    oneLiner: requiredText("oneLiner", 180),
    stack: z
      .array(requiredText("stack[]", 40))
      .min(1, "stack must contain at least one entry")
      .max(6, "stack must contain at most 6 entries"),
    generatedAt: z
      .string({
        required_error: "generatedAt is required",
        invalid_type_error: "generatedAt must be an ISO timestamp string",
      })
      .datetime({ offset: true, message: "generatedAt must be an ISO timestamp" }),
    seeded: z.literal(true, {
      errorMap: () => ({ message: "seeded must be true" }),
    }),
    demo: demoSchema.optional(),
    demoUrl: z.string().url("demoUrl must be an absolute URL").optional(),
    demoLogin: z.unknown().optional(),
    previewCommand: requiredText("previewCommand").optional(),
    shots: z
      .array(shotSchema)
      .length(4, "shots must contain exactly 4 entries"),
    proof: proofSchema,
  })
  .superRefine((manifest, context) => {
    manifest.shots.forEach((shot, index) => {
      if (shot.file !== SHOT_ORDER[index]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `shot ${index + 1} must be ${SHOT_ORDER[index]}`,
          path: ["shots", index, "file"],
        });
      }
    });
  });

/** "proof.measured[0].value: must be a string" — names the field for a human. */
export function formatIssuePath(issuePath) {
  return issuePath.reduce((label, segment) => {
    if (typeof segment === "number") {
      return `${label}[${segment}]`;
    }
    return label === "" ? String(segment) : `${label}.${String(segment)}`;
  }, "");
}

export function describeIssues(issues) {
  return issues
    .map((issue) => `${formatIssuePath(issue.path) || "manifest"}: ${issue.message}`)
    .join("; ");
}
