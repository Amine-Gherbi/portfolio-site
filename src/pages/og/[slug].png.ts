import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { renderOgPng, type OgCopy } from "../../lib/og";

interface OgProps {
  copy: OgCopy;
}

export async function getStaticPaths() {
  const entries = await getCollection("projects");
  entries.sort((a, b) => a.data.order - b.data.order);

  const total = String(entries.length).padStart(2, "0");
  const home = {
    params: { slug: "home" },
    props: {
      copy: {
        eyebrow: "Full-stack developer",
        title: "Web applications built with TypeScript, Next.js, PostgreSQL and Python.",
        body: "Three case studies and a Master's thesis, with the evidence behind each claim.",
        footer: "Biskra, Algeria",
      },
    },
  };

  const projects = entries.map((entry) => ({
    params: { slug: entry.id },
    props: {
      copy: {
        eyebrow:
          entry.data.kind === "thesis"
            ? `Thesis / ${total}`
            : `Case ${String(entry.data.order).padStart(2, "0")} / ${total}`,
        title: entry.data.title,
        body: entry.data.oneLiner,
        footer: entry.data.stack.join(" · "),
      },
    },
  }));

  return [home, ...projects];
}

export const GET: APIRoute = async ({ props }) => {
  const { copy } = props as OgProps;
  const png = await renderOgPng(copy);

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
