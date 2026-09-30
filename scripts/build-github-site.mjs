import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist-pages");

await rm(output, { recursive: true, force: true });
await mkdir(join(output, "catalogos"), { recursive: true });

for (const name of ["index.html", "styles.css", "app.js"]) {
  await cp(join(root, "github-site", name), join(output, name));
}
for (const name of ["catalog-learning.mjs", "catalog-items.mjs"]) {
  await cp(join(root, "app", "lib", name), join(output, name));
}
await cp(join(root, "public", "catalogos"), join(output, "catalogos"), { recursive: true });
await cp(join(root, "public", "favicon.svg"), join(output, "favicon.svg"));
await writeFile(join(output, ".nojekyll"), "", "utf8");

const html = await readFile(join(output, "index.html"), "utf8");
if (!html.includes('src="./app.js"') || /http-equiv=["']refresh|window\.location\.replace|chatgpt\.site/i.test(html)) {
  throw new Error("GitHub Pages output must load its own app without an external redirect");
}
console.log("GitHub Pages: catálogo e aulas estáticos prontos em dist-pages/");
