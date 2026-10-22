#!/usr/bin/env node
/**
 * Sums the gzip size of every JavaScript file the build emitted under
 * dist/_astro/ and fails above 30 KB. The site is static and hydration-free;
 * this exists so a future island cannot land silently.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const ASTRO_DIR = path.join(process.cwd(), "dist", "_astro");
const BUDGET_BYTES = 30 * 1024;

const files = existsSync(ASTRO_DIR)
  ? readdirSync(ASTRO_DIR)
      .filter((file) => file.endsWith(".js"))
      .sort()
  : [];

let total = 0;
for (const file of files) {
  const source = readFileSync(path.join(ASTRO_DIR, file));
  const gzipped = gzipSync(source, { level: 9 }).length;
  total += gzipped;
  console.log(`[js] ${file}: ${(gzipped / 1024).toFixed(2)} KB gzip`);
}

console.log(
  `[js] total: ${(total / 1024).toFixed(2)} KB gzip across ${files.length} file(s); budget ${(BUDGET_BYTES / 1024).toFixed(0)} KB`,
);

if (total > BUDGET_BYTES) {
  console.error(`[js] FAIL over budget by ${((total - BUDGET_BYTES) / 1024).toFixed(2)} KB`);
  process.exit(1);
}
