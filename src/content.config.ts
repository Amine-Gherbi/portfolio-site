import { defineCollection } from "astro:content";
import { caseStudyMdxLoader } from "./lib/case-study-loader";
import { caseStudySchema } from "./lib/case-study";

const projects = defineCollection({
  loader: caseStudyMdxLoader({ base: "./src/content/projects" }),
  schema: caseStudySchema,
});

export const collections = { projects };
