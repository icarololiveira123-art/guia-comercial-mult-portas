import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(projectRoot, "github-app"),
  base: "/guia-comercial-mult-portas/",
  publicDir: resolve(projectRoot, "public"),
  css: { postcss: projectRoot },
  plugins: [react()],
  build: {
    outDir: resolve(projectRoot, "dist-pages"),
    emptyOutDir: true,
    target: "es2022",
  },
});
