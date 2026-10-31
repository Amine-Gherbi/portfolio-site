import { readdir } from "node:fs/promises";
import path from "node:path";
import type { APIRoute } from "astro";
import sharp from "sharp";
import { readProjectManifest } from "../../../../lib/manifest";

/**
 * Smaller candidates for the committed 2880x1800 snapshots. The snapshot
 * contract keeps the originals unchanged; these variants are rendered at build
 * time so a phone downloads 960w instead of the full frame, and they are never
 * written back into the source tree.
 */
const WIDTHS = [960, 1440] as const;
type Width = (typeof WIDTHS)[number];

interface VariantProps {
  source: string;
  width: Width;
}

export async function getStaticPaths() {
  const assetsRoot = path.join(process.cwd(), "public", "assets");
  const directories = await readdir(assetsRoot, { withFileTypes: true });
  const paths = [];

  for (const directory of directories) {
    if (!directory.isDirectory()) {
      continue;
    }
    const manifest = await readProjectManifest(directory.name);
    if (!manifest) {
      continue;
    }

    for (const shot of manifest.shots) {
      const name = shot.file.replace(/\.webp$/, "");
      for (const width of WIDTHS) {
        paths.push({
          params: { slug: directory.name, width: String(width), name },
          props: {
            source: path.join(assetsRoot, directory.name, shot.file),
            width,
          },
        });
      }
    }
  }

  return paths;
}

export const GET: APIRoute = async ({ props }) => {
  const { source, width } = props as VariantProps;
  const webp = await sharp(source)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toBuffer();

  return new Response(new Uint8Array(webp), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
