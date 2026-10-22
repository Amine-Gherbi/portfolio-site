import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://ghamine.dev",
  output: "static",
  build: {
    format: "directory",
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
