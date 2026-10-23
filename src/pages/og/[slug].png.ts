import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { renderOgPng, type OgCopy } from "../../lib/og";

interface OgProps {
  copy: OgCopy;
}

export async function getStaticPaths() {
  const entries = await getCollection("projects");
  entries.sort((a, b) => a.data.order - b.data.order);

  const home = {
    params: { slug: "home" },
    props: {
      copy: {
        eyebrow: "Full-stack developer / 2026",
        title: "Web applications built with TypeScript, Next.js, PostgreSQL and Python.",
        body: "Three case studies, each with a committed snapshot and the limits behind it.",
        footer: "Biskra, Algeria",
      },
    },
  };

  const projects = entries.map((entry) => ({
    params: { slug: entry.id },
    props: {
      copy: {
        eyebrow: `Case ${String(entry.data.order).padStart(2, "0")} / 03`,
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
