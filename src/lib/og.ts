import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori, { type SatoriOptions } from "satori";
import type { ReactNode } from "react";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface OgCopy {
  eyebrow: string;
  title: string;
  body: string;
  footer: string;
}

interface FontPair {
  regular: string;
  bold: string;
}

const FONT_FAMILIES: FontPair[] = [
  { regular: "georgia.ttf", bold: "georgiab.ttf" },
  { regular: "times.ttf", bold: "timesbd.ttf" },
  { regular: "DejaVuSerif.ttf", bold: "DejaVuSerif-Bold.ttf" },
  { regular: "LiberationSerif-Regular.ttf", bold: "LiberationSerif-Bold.ttf" },
  { regular: "arial.ttf", bold: "arialbd.ttf" },
];

const FONT_DIRECTORIES = [
  process.env.OG_FONT_DIR,
  "C:/Windows/Fonts",
  "/usr/share/fonts/truetype/dejavu",
  "/usr/share/fonts/truetype/liberation",
  "/Library/Fonts",
  "/System/Library/Fonts/Supplemental",
].filter((entry): entry is string => typeof entry === "string" && entry !== "");

let cachedFonts: SatoriOptions["fonts"] | undefined;
let cachedFamily: string | undefined;

/**
 * satori needs the actual font bytes. Only fonts already installed on the
 * machine are used — nothing is downloaded — and OG_FONT_DIR points at a
 * different folder when the defaults do not exist.
 */
function loadFonts(): { fonts: SatoriOptions["fonts"]; family: string } {
  if (cachedFonts && cachedFamily) {
    return { fonts: cachedFonts, family: cachedFamily };
  }

  for (const directory of FONT_DIRECTORIES) {
    for (const pair of FONT_FAMILIES) {
      const regular = path.join(directory, pair.regular);
      const bold = path.join(directory, pair.bold);
      if (!existsSync(regular) || !existsSync(bold)) {
        continue;
      }

      const family = path.basename(pair.regular, path.extname(pair.regular));
      cachedFamily = family;
      cachedFonts = [
        { name: family, data: readFileSync(regular), weight: 400, style: "normal" },
        { name: family, data: readFileSync(bold), weight: 700, style: "normal" },
      ];
      return { fonts: cachedFonts, family };
    }
  }

  throw new Error(
    "OG images need a local serif font. Set OG_FONT_DIR to a directory containing a " +
      "regular/bold TTF pair (looked for georgia, times, DejaVuSerif, LiberationSerif, arial).",
  );
}

function scaleForTitle(length: number): number {
  if (length > 150) return 46;
  if (length > 110) return 54;
  if (length > 70) return 64;
  return 76;
}

function card(copy: OgCopy, family: string): ReactNode {
  return {
    type: "div",
    props: {
      style: {
        boxSizing: "border-box",
        width: `${OG_WIDTH}px`,
        height: `${OG_HEIGHT}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px",
        backgroundColor: "#faf9f7",
        color: "#0b0b0c",
        fontFamily: family,
        borderTop: "12px solid #963821",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              paddingBottom: "20px",
              borderBottom: "1px solid #d8d4cc",
              fontSize: "22px",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: "#5b5852",
            },
            children: [
              { type: "span", props: { children: "Mohamed L'Amine Gherbi" } },
              { type: "span", props: { children: copy.eyebrow } },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "28px",
              padding: "40px 0",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: `${scaleForTitle(copy.title.length)}px`,
                    fontWeight: 700,
                    lineHeight: 1.05,
                    letterSpacing: "-1.5px",
                  },
                  children: copy.title,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "28px",
                    lineHeight: 1.4,
                    color: "#35322d",
                    maxWidth: "960px",
                  },
                  children: copy.body,
                },
              },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              paddingTop: "20px",
              borderTop: "1px solid #d8d4cc",
              fontSize: "22px",
              color: "#5b5852",
            },
            children: [
              { type: "span", props: { children: copy.footer } },
              { type: "span", props: { children: "Full-stack developer" } },
            ],
          },
        },
      ],
    },
  } as unknown as ReactNode;
}

export async function renderOgPng(copy: OgCopy): Promise<Buffer> {
  const { fonts, family } = loadFonts();
  const svg = await satori(card(copy, family), {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts,
  });
  const renderer = new Resvg(svg, {
    fitTo: { mode: "width", value: OG_WIDTH },
  });
  return Buffer.from(renderer.render().asPng());
}
