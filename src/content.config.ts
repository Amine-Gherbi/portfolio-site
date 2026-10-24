import { defineCollection } from "astro:content";
import { caseStudyMdxLoader } from "./lib/case-study-loader";
import { projectEntrySchema } from "./lib/case-study";

const projects = defineCollection({
  loader: caseStudyMdxLoader({ base: "./src/content/projects" }),
  schema: projectEntrySchema,
});

export const collections = { projects };
