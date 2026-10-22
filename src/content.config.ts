import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { projectSchema } from "./lib/manifest";

const projects = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/projects" }),
  schema: projectSchema,
});

export const collections = { projects };
