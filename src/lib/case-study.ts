import { z } from "zod";
import { projectSchema } from "./manifest";

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
  summary: required("pathological case"),
  mechanism: required("mechanism"),
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
  kind: z.literal("case-study"),
  claim: required("claim"),
  what: required("what it is"),
  hardPart: required("hard part"),
  decision: decisionSchema,
  failures: z
    .array(failureSchema)
    .length(1, "exactly one refusal entry is required"),
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
});

const organisationSchema = z.object({
  name: required("organisation name"),
  role: required("organisation role"),
});

const chaincodeFunctionSchema = z.object({
  name: required("chaincode function name"),
  role: required("chaincode function role"),
});

/**
 * The thesis has no repository and no asset manifest. Its content entry owns
 * the page copy, the generated cover and the PDF link; the page deliberately
 * offers no code link.
 */
export const thesisSchema = projectSchema.extend({
  kind: z.literal("thesis"),
  thesisTitle: required("thesis title").max(200),
  claim: required("claim"),
  what: required("what it is"),
  hardPart: required("hard part"),
  design: required("design"),
  proves: required("what it proves"),
  limits: z
    .array(required("limit"))
    .min(3, "at least three limits are required"),
  cover: z
    .string()
    .regex(/^\/assets\/thesis\/cover\.webp$/, "cover must be /assets/thesis/cover.webp"),
  coverCard: z
    .string()
    .regex(
      /^\/assets\/thesis\/cover-card\.webp$/,
      "coverCard must be /assets/thesis/cover-card.webp",
    ),
  coverAlt: required("cover alt"),
  pdf: z.string().regex(/^\/thesis\.pdf$/, "pdf must be /thesis.pdf"),
  pdfLabel: required("pdf label"),
  author: required("author"),
  institution: required("institution"),
  department: required("department"),
  degree: required("degree"),
  session: required("session"),
  supervisors: z.array(required("supervisor")).min(1),
  organisations: z
    .array(organisationSchema)
    .length(3, "exactly three organisations are required"),
  functions: z
    .array(chaincodeFunctionSchema)
    .length(9, "exactly nine chaincode functions are required"),
  links: z.array(linkSchema).min(1, "at least one link is required"),
});

export const projectEntrySchema = z.discriminatedUnion("kind", [
  caseStudySchema,
  thesisSchema,
]);

export type CaseStudy = z.infer<typeof caseStudySchema>;
export type Thesis = z.infer<typeof thesisSchema>;
export type ProjectEntry = z.infer<typeof projectEntrySchema>;
export type CaseStudyDecision = z.infer<typeof decisionSchema>;
export type CaseStudyFailure = z.infer<typeof failureSchema>;

/**
 * The five sections, in the order the case-study page renders them. The page,
 * the source check and the built-HTML check all read this list, so the order
 * cannot drift between the template and the gate.
 */
export const SECTION_ORDER = [
  { id: "what-it-is", label: "What it is" },
  { id: "hard-part", label: "The hard part" },
  { id: "decision", label: "The decision" },
  { id: "what-broke", label: "The failure it refuses" },
  { id: "measured", label: "Measured" },
] as const;

/**
 * The thesis has no failure log, no screenshot manifest and no decision record
 * in the case-study shape. Its four sections keep the same argument order:
 * context, difficulty, design, evidence.
 */
export const THESIS_SECTION_ORDER = [
  { id: "what-it-is", label: "What it is" },
  { id: "hard-part", label: "The hard part" },
  { id: "design", label: "The design" },
  { id: "proves", label: "What it proves" },
] as const;

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
      `failures: exactly one refusal entry is required, found ${study.failures.length}`,
    );
  }

  study.failures.forEach((failure, index) => {
    if (failure.summary.trim() === "") {
      errors.push(`failures[${index}].summary: pathological case is required`);
    }
    if (failure.mechanism.trim() === "") {
      errors.push(`failures[${index}].mechanism: mechanism is required`);
    }
  });

  if (errors.length > 0) {
    throw new Error(
      `Invalid case study "${slug}":\n- ${errors.join("\n- ")}`,
    );
  }
}
