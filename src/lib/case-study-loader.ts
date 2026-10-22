import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { Loader } from "astro/loaders";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n[\s\S]*)?$/;

interface LoaderOptions {
  /** Directory relative to the Astro project root. */
  base: string;
}

/**
 * Loads `.mdx` case-study files as data entries. The fixed section payload
 * lives in YAML frontmatter so the template can enforce the section order
 * without compiling MDX. This avoids `@astrojs/mdx`, whose Astro-5-compatible
 * release adds 13 direct dependencies.
 */
export function caseStudyMdxLoader(options: LoaderOptions): Loader {
  return {
    name: "case-study-mdx-loader",
    load: async ({ config, generateDigest, parseData, store }) => {
      const baseUrl = new URL(options.base, config.root);
      const directory = fileURLToPath(baseUrl);
      const files = (await readdir(directory))
        .filter((file) => file.endsWith(".mdx"))
        .sort();

      store.clear();

      for (const file of files) {
        const filePath = path.join(directory, file);
        const raw = await readFile(filePath, "utf8");
        const match = FRONTMATTER.exec(raw);

        if (!match) {
          throw new Error(
            `${filePath}: missing YAML frontmatter delimited by ---`,
          );
        }

        let data: unknown;
        try {
          data = parseYaml(match[1] ?? "");
        } catch (error) {
          throw new Error(
            `${filePath}: invalid YAML frontmatter: ${(error as Error).message}`,
            { cause: error },
          );
        }

        if (typeof data !== "object" || data === null || Array.isArray(data)) {
          throw new Error(`${filePath}: frontmatter must be a YAML object`);
        }

        const id = path.basename(file, ".mdx");
        const parsed = await parseData({
          id,
          data: data as Record<string, unknown>,
          filePath,
        });
        const relativePath = path
          .relative(fileURLToPath(config.root), filePath)
          .split(path.sep)
          .join("/");

        store.set({
          id,
          data: parsed,
          filePath: relativePath,
          digest: generateDigest(raw),
        });
      }
    },
  };
}
