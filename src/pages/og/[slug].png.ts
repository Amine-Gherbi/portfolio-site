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
        eyebrow: "Engineering case index / 2026",
        title: "I build full-stack systems and publish the measurement.",
        body: "20 buyers on stock 5 create 5 orders and stock 0. 9 CI jobs feed one ci-ok check. Uncited answers are dropped.",
        footer: "Three case studies, each with a committed snapshot",
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
