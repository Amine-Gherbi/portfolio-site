#!/usr/bin/env node
/**
 * Regenerates the raster icons from public/favicon.svg.
 *
 *   node scripts/build-icons.mjs
 *
 * favicon.svg is the source of truth. The Apple touch icon is drawn full-bleed
 * (iOS applies its own mask), and the ICO wraps a 32x32 PNG, which every current
 * browser accepts. Run this only when the SVG changes; the outputs are committed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const source = readFileSync(path.join(PUBLIC_DIR, "favicon.svg"), "utf8");
// iOS masks the corners itself; a transparent rounded corner would show through.
const fullBleed = source.replace(/\srx="12"/, "");

function render(svg, size) {
  return sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer();
}

function toIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0);
  entry.writeUInt8(32, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, png]);
}

const apple = await render(fullBleed, 180);
const icoPng = await render(source, 32);

writeFileSync(path.join(PUBLIC_DIR, "apple-touch-icon.png"), apple);
writeFileSync(path.join(PUBLIC_DIR, "favicon.ico"), toIco(icoPng));

console.log(`[icons] apple-touch-icon.png ${apple.length} bytes (180x180)`);
console.log(`[icons] favicon.ico ${icoPng.length} bytes PNG payload (32x32)`);
