import { z } from "zod";
import { projectSchema } from "./manifest";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)");

const required = (label: string) =>
  z.string().trim().min(1, `${label} is required`);

const decisionSchema = z.object({
  title: required("decision title"),
  choice: required("decision"),
  rejected: required("rejected alternative"),
  cost: required("cost"),
  evidence: required("evidence"),
});

const failureSchema = z.object({
  date: isoDate,
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/, "commit must be a 7-40 character lowercase SHA"),
  summary: required("failure summary"),
  processChange: required("process change"),
});

const screenshotSchema = z.object({
  file: z.enum(["shot-01.webp", "shot-02.webp", "shot-03.webp"]),
  caption: required("caption"),
});

const linkSchema = z.object({
  label: required("link label"),
  href: z
    .string()
    .regex(
      /^(https?:\/\/|\/)/,
      "link href must be an absolute URL or a site path",
    ),
});

export const caseStudySchema = projectSchema.extend({
  claim: required("claim"),
  what: required("what it is"),
  hardPart: required("hard part"),
  decision: decisionSchema,
  failures: z
    .array(failureSchema)
    .length(1, "exactly one dated failure is required"),
  measured: required("measured"),
  screenshots: z
    .array(screenshotSchema)
    .length(3, "exactly 3 screenshots are required")
    .superRefine((screenshots, context) => {
      const order = ["shot-01.webp", "shot-02.webp", "shot-03.webp"];
      screenshots.forEach((screenshot, index) => {
        if (screenshot.file !== order[index]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `screenshot ${index + 1} must be ${order[index]}`,
            path: [index, "file"],
          });
        }
      });
    }),
  links: z.array(linkSchema).min(1, "at least one link is required"),
  next: z
    .array(required("next step"))
    .min(1, "at least one next step is required"),
});

export type CaseStudy = z.infer<typeof caseStudySchema>;
export type CaseStudyDecision = z.infer<typeof decisionSchema>;
export type CaseStudyFailure = z.infer<typeof failureSchema>;

/**
 * The six sections, in the order the case-study page renders them. The page,
 * the source check and the built-HTML check all read this list, so the order
 * cannot drift between the template and the gate.
 */
export const SECTION_ORDER = [
  { id: "what-it-is", label: "What it is" },
  { id: "hard-part", label: "The hard part" },
  { id: "decision", label: "The decision" },
  { id: "what-broke", label: "What broke" },
  { id: "measured", label: "Measured" },
  { id: "limits", label: "Limits" },
] as const;

const updatedFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatUpdated(isoDateValue: string): string {
  return updatedFormatter.format(new Date(`${isoDateValue}T00:00:00.000Z`));
}

/**
 * Hard build-time gate for the rules a case study cannot ship without. Zod
 * enforces the shape; this adds the checks that need the filesystem and the
 * messages that name the offending field.
 */
export function assertCaseStudy(study: CaseStudy, slug: string): void {
  const errors: string[] = [];

  if (study.decision.rejected.trim() === "") {
    errors.push("decision.rejected: rejected alternative is required");
  }
  if (study.decision.cost.trim() === "") {
    errors.push("decision.cost: cost is required");
  }

  if (study.failures.length !== 1) {
    errors.push(
      `failures: exactly one dated failure is required, found ${study.failures.length}`,
    );
  }

  study.failures.forEach((failure, index) => {
    if (!/^[0-9a-f]{7,40}$/.test(failure.commit)) {
      errors.push(`failures[${index}].commit: commit must be a 7-40 character SHA`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(failure.date)) {
      errors.push(`failures[${index}].date: date must be YYYY-MM-DD`);
    }
  });

  if (errors.length > 0) {
    throw new Error(
      `Invalid case study "${slug}":\n- ${errors.join("\n- ")}`,
    );
  }
}
