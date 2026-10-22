import { existsSync } from "node:fs";
import path from "node:path";
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

const metricSchema = z.object({
  label: required("metric label"),
  value: z.string().min(1, "metric value must be a string"),
  method: required("method"),
  artifact: required("artifact"),
});

const screenshotSchema = z.object({
  file: z.enum(["shot-01.webp", "shot-02.webp", "shot-03.webp"]),
  caption: required("caption"),
});

const linkSchema = z.object({
  label: required("link label"),
  href: z.string().url("link href must be an absolute URL"),
});

export const caseStudySchema = projectSchema.extend({
  claim: required("claim"),
  problem: required("problem"),
  constraint: required("constraint"),
  architecture: required("architecture"),
  decisions: z.array(decisionSchema).length(3, "exactly 3 decisions are required"),
  failures: z
    .array(failureSchema)
    .length(1, "exactly one dated failure is required"),
  metrics: z.array(metricSchema).min(1, "at least one metric is required"),
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
export type CaseStudyMetric = z.infer<typeof metricSchema>;

export const SECTION_ORDER = [
  { id: "claim", label: "Claim" },
  { id: "problem", label: "Problem" },
  { id: "constraint", label: "Constraint" },
  { id: "architecture", label: "Architecture" },
  { id: "decisions", label: "Three decisions" },
  { id: "failure", label: "What broke" },
  { id: "metrics", label: "Metrics and method" },
  { id: "screenshots", label: "Screenshots" },
  { id: "links", label: "Demo and repository" },
  { id: "next", label: "What I would do next" },
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

  if (study.decisions.length !== 3) {
    errors.push(
      `decisions: exactly 3 decisions are required, found ${study.decisions.length}`,
    );
  }

  study.decisions.forEach((decision, index) => {
    if (decision.rejected.trim() === "") {
      errors.push(`decisions[${index}].rejected: rejected alternative is required`);
    }
    if (decision.cost.trim() === "") {
      errors.push(`decisions[${index}].cost: cost is required`);
    }
  });

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

  study.metrics.forEach((metric, index) => {
    if (typeof metric.value !== "string") {
      errors.push(`metrics[${index}].value: metric values must be strings`);
    }
    if (metric.method.trim() === "") {
      errors.push(`metrics[${index}].method: method is required`);
    }
    if (metric.artifact.trim() === "") {
      errors.push(`metrics[${index}].artifact: artifact path is required`);
    } else if (!existsSync(path.resolve(process.cwd(), metric.artifact))) {
      errors.push(
        `metrics[${index}].artifact: artifact not found at ${metric.artifact}`,
      );
    }
  });

  if (errors.length > 0) {
    throw new Error(
      `Invalid case study "${slug}":\n- ${errors.join("\n- ")}`,
    );
  }
}
