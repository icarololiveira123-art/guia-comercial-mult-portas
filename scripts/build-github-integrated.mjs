import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(projectRoot, "dist-pages");
const viteCli = join(projectRoot, "node_modules", "vite", "bin", "vite.js");

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [viteCli, "build", "--config", "vite.github.config.ts"], {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, VITE_GITHUB_PAGES: "true" },
  });
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`Build do GitHub Pages falhou (${signal || code}).`));
  });
});

const html = await readFile(join(output, "index.html"), "utf8");
if (!html.includes("/guia-comercial-mult-portas/assets/") || /http-equiv=["']refresh|window\.location\.replace|chatgpt\.site/i.test(html)) {
  throw new Error("Artefato Pages inválido: falta o aplicativo compilado ou há um redirecionamento.");
}
for (const relative of [
  "favicon.svg",
  "catalogos/brimak-linha-elite.pdf",
  "catalogos/brimak-linha-super-25.pdf",
  "catalogos/brimak-linha-l25.pdf",
  "catalogos/brimak-portas-janelas-pvc.pdf",
  "catalogos/brimak-catalogo-2018.pdf",
]) {
  await access(join(output, relative));
}
await writeFile(join(output, ".nojekyll"), "", "utf8");
console.log("GitHub Pages: aplicativo React pronto em dist-pages/.");
