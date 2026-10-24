#!/usr/bin/env node
/**
 * Renders two versions of the thesis cover from SVG:
 *
 *   - cover.webp (2880x1800) for the thesis page, where the cover is read at
 *     document size.
 *   - cover-card.webp (1600x1000) for the home card, where the same page is
 *     reduced to roughly 300 px. The card version keeps one short title block
 *     at a size that survives that reduction.
 *
 * Run once and commit both files in public/assets/thesis/.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const DIR = path.join("public", "assets", "thesis");
const COVER_TARGET = path.join(DIR, "cover.webp");
const CARD_TARGET = path.join(DIR, "cover-card.webp");

const serif = "Georgia, 'Palatino Linotype', 'Book Antiqua', serif";
const cardSerif =
  "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif";
const sans = "'Segoe UI', Arial, sans-serif";
const mono = "Consolas, 'Courier New', monospace";

const titleLines = [
  "Enhancing the Integrity of",
  "Algeria's Social Security System:",
  "Addressing Fraudulent Activities",
  "through Blockchain Technology",
];

const WIDTH = 2880;
const HEIGHT = 1800;

const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#faf9f7"/>
  <rect x="240" y="208" width="2400" height="4" fill="#963821"/>
  <text x="240" y="306" font-family="${mono}" font-size="28" letter-spacing="5" fill="#5b5852">MASTER'S THESIS / GLSD</text>
  <text x="2640" y="306" text-anchor="end" font-family="${mono}" font-size="28" letter-spacing="5" fill="#5b5852">SESSION 2024-2025</text>
  ${titleLines
    .map(
      (line, index) =>
        `<text x="240" y="${560 + index * 154}" font-family="${serif}" font-size="128" fill="#0b0b0c">${line}</text>`,
    )
    .join("\n  ")}
  <line x1="240" y1="1120" x2="2640" y2="1120" stroke="#d8d4cc" stroke-width="2"/>
  <text x="240" y="1242" font-family="${serif}" font-size="56" fill="#0b0b0c">Mohamed Lamine Gherbi</text>
  <text x="240" y="1320" font-family="${sans}" font-size="38" fill="#35322d">University of Mohamed Khider, Biskra</text>
  <text x="240" y="1380" font-family="${sans}" font-size="34" fill="#5b5852">Computer Science Department</text>
  <text x="240" y="1448" font-family="${sans}" font-size="30" fill="#5b5852">Master's in Computer Science, Software Engineering and Distributed Systems (GLSD)</text>
  <line x1="240" y1="1520" x2="2640" y2="1520" stroke="#d8d4cc" stroke-width="2"/>
  <text x="240" y="1604" font-family="${mono}" font-size="26" letter-spacing="4" fill="#5b5852">HYPERLEDGER FABRIC / THREE ORGANISATIONS / ONE LEDGER</text>
  <rect x="2640" y="1578" width="28" height="28" fill="#963821"/>
</svg>`;

const CARD_WIDTH = 1600;
const CARD_HEIGHT = 1000;

const cardSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#faf9f7"/>
  <rect x="96" y="88" width="1408" height="4" fill="#963821"/>
  <text x="96" y="156" font-family="${mono}" font-size="28" letter-spacing="10" fill="#5b5852">THESIS</text>
  ${titleLines
    .map(
      (line, index) =>
        `<text x="96" y="${330 + index * 112}" font-family="${cardSerif}" font-size="96" fill="#0b0b0c">${line}</text>`,
    )
    .join("\n  ")}
  <line x1="96" y1="792" x2="1504" y2="792" stroke="#d8d4cc" stroke-width="2"/>
  <text x="96" y="858" font-family="${mono}" font-size="28" letter-spacing="6" fill="#5b5852">2024-2025</text>
  <text x="96" y="916" font-family="${sans}" font-size="36" fill="#35322d">University of Mohamed Khider, Biskra</text>
  <rect x="1478" y="866" width="26" height="26" fill="#963821"/>
</svg>`;

await mkdir(DIR, { recursive: true });

const coverInfo = await sharp(Buffer.from(coverSvg))
  .webp({ quality: 92 })
  .toFile(COVER_TARGET);
console.log(
  `[thesis-cover] ${COVER_TARGET}: ${coverInfo.width}x${coverInfo.height}, ${coverInfo.size} bytes`,
);

const rendered = new Resvg(cardSvg, {
  fitTo: { mode: "width", value: CARD_WIDTH },
  font: { loadSystemFonts: true, defaultFontFamily: "Georgia" },
}).render();
const cardPng = rendered.asPng();
const cardInfo = await sharp(cardPng).webp({ quality: 92 }).toFile(CARD_TARGET);
console.log(
  `[thesis-cover] ${CARD_TARGET}: ${cardInfo.width}x${cardInfo.height}, ${cardInfo.size} bytes`,
);

// The title must stay inside the right margin after resvg's font substitution.
const { data, info } = await sharp(cardPng)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
let titleRight = 0;
for (let y = 250; y < 700; y += 1) {
  for (let x = 0; x < info.width; x += 1) {
    const offset = (y * info.width + x) * info.channels;
    if (data[offset] < 210 || data[offset + 1] < 210 || data[offset + 2] < 210) {
      titleRight = Math.max(titleRight, x);
    }
  }
}
console.log(
  `[thesis-cover] title band right edge: ${titleRight}, expected <= 1504`,
);
