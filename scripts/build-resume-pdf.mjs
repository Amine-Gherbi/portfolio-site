#!/usr/bin/env node
/**
 * Emits public/resume.pdf from src/data/resume.json — the same data the
 * /resume page renders. pdf-lib draws the text directly; no headless browser
 * and no HTML-to-PDF guesswork. The document carries no date metadata: the hub
 * renders no timestamp, and a committed PDF should not acquire one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "src", "data", "resume.json");
const TARGET = path.join(ROOT, "public", "resume.pdf");

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const INK = rgb(0.043, 0.043, 0.047);
const MUTED = rgb(0.357, 0.345, 0.322);
const RULE = rgb(0.847, 0.831, 0.8);
const ACCENT = rgb(0.588, 0.22, 0.129);

function ascii(value) {
  return String(value)
    .replace(/—|–/g, "-")
    .replace(/’|‘/g, "'")
    .replace(/“|”/g, '"')
    .replace(/[^\x20-\x7e]/g, "");
}

function wrap(text, font, size, width) {
  const words = ascii(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
    } else {
      if (line !== "") {
        lines.push(line);
      }
      line = word;
    }
  }
  if (line !== "") {
    lines.push(line);
  }
  return lines;
}

const resume = JSON.parse(readFileSync(SOURCE, "utf8"));
const pdf = await PDFDocument.create();

const regular = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

pdf.setTitle(`${ascii(resume.name)} - ${ascii(resume.role)}`);
pdf.setAuthor(ascii(resume.name));
pdf.setSubject("Resume");
pdf.setProducer("scripts/build-resume-pdf.mjs");

let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
let y = PAGE_HEIGHT - MARGIN;

function newPage() {
  page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  y = PAGE_HEIGHT - MARGIN;
}

function ensure(height) {
  if (y - height < MARGIN) {
    newPage();
  }
}

function drawLines(lines, { font, size, color = INK, leading = 1.4, x = MARGIN, width = CONTENT_WIDTH }) {
  for (const line of lines) {
    ensure(size * leading);
    y -= size * leading;
    page.drawText(line, { x, y, size, font, color, maxWidth: width });
  }
}

function heading(label) {
  ensure(40);
  y -= 24;
  page.drawText(ascii(label).toUpperCase(), {
    x: MARGIN,
    y,
    size: 10,
    font: bold,
    color: ACCENT,
    characterSpacing: 1.2,
  });
  y -= 8;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.75,
    color: RULE,
  });
  y -= 6;
}

// Masthead
page.drawText(ascii(resume.name), {
  x: MARGIN,
  y: y - 34,
  size: 30,
  font: bold,
  color: INK,
});
y -= 44;
page.drawText(ascii(resume.role), {
  x: MARGIN,
  y: y - 14,
  size: 13,
  font: regular,
  color: MUTED,
});
y -= 26;
page.drawText(
  ascii(resume.contact.map((entry) => `${entry.label}: ${entry.value}`).join("   /   ")),
  { x: MARGIN, y: y - 10, size: 9, font: regular, color: MUTED },
);
y -= 18;
page.drawLine({
  start: { x: MARGIN, y },
  end: { x: PAGE_WIDTH - MARGIN, y },
  thickness: 1.5,
  color: INK,
});

heading("Summary");
drawLines(wrap(resume.summary, regular, 10, CONTENT_WIDTH), {
  font: regular,
  size: 10,
  leading: 1.5,
});

heading("Experience");
for (const entry of resume.experience) {
  ensure(56);
  y -= 6;
  page.drawText(ascii(entry.role), { x: MARGIN, y, size: 12.5, font: bold, color: INK });
  y -= 14;
  page.drawText(ascii(`${entry.organisation} / ${entry.location}`), {
    x: MARGIN,
    y,
    size: 9.5,
    font: italic,
    color: MUTED,
  });
  y -= 13;
  page.drawText(ascii(entry.period), { x: MARGIN, y, size: 9.5, font: regular, color: MUTED });
  y -= 8;
}

heading("Education");
for (const entry of resume.education) {
  ensure(48);
  for (const line of wrap(entry.credential, bold, 10.5, CONTENT_WIDTH)) {
    y -= 14;
    page.drawText(line, { x: MARGIN, y, size: 10.5, font: bold, color: INK });
  }
  y -= 13;
  page.drawText(ascii(`${entry.institution} / ${entry.years}`), {
    x: MARGIN,
    y,
    size: 9.5,
    font: regular,
    color: MUTED,
  });
  y -= 8;
}

heading("Projects");
for (const project of resume.projects) {
  ensure(60);
  y -= 6;
  page.drawText(ascii(project.title), { x: MARGIN, y, size: 11.5, font: bold, color: INK });
  y -= 14;
  for (const line of wrap(project.line, regular, 10, CONTENT_WIDTH)) {
    ensure(14);
    y -= 14;
    page.drawText(line, { x: MARGIN, y, size: 10, font: regular, color: INK });
  }
  y -= 3;
  page.drawText(ascii(`Case study: /projects/${project.slug}/`), {
    x: MARGIN,
    y,
    size: 8.5,
    font: regular,
    color: MUTED,
  });
  y -= 10;
}

heading("Master's thesis");
for (const line of wrap(resume.thesis.title, bold, 11, CONTENT_WIDTH)) {
  ensure(15);
  y -= 14;
  page.drawText(line, { x: MARGIN, y, size: 11, font: bold, color: INK });
}
y -= 4;
drawLines(wrap(resume.thesis.summary, regular, 10, CONTENT_WIDTH), {
  font: regular,
  size: 10,
  leading: 1.5,
});

heading("Skills");
drawLines(wrap(resume.skills.join(" / "), regular, 10, CONTENT_WIDTH), {
  font: regular,
  size: 10,
  leading: 1.5,
});

heading("Languages");
drawLines(wrap(resume.languages.join(" / "), regular, 10, CONTENT_WIDTH), {
  font: regular,
  size: 10,
  leading: 1.5,
});

const bytes = await pdf.save();
writeFileSync(TARGET, bytes);
console.log(`[resume] wrote ${path.relative(ROOT, TARGET)} (${bytes.length} bytes)`);
