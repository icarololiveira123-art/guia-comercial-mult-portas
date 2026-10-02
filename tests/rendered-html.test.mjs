import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { brimakDocumentLessons } from "../app/lib/catalog-learning.mjs";

const execFileAsync = promisify(execFile);

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders without temporary development metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.doesNotMatch(await response.text(), developmentPreviewMeta);
});

test("robots policy keeps the internal guide out of search indexes", async () => {
  const robots = await readFile(new URL("../public/robots.txt", import.meta.url), "utf8");
  assert.match(robots, /^User-agent: \*\nDisallow: \/\s*$/);
});

test("GitHub Pages builds the complete guide with local accounts and lessons at the repository path", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["build:github"], "node scripts/build-github-integrated.mjs");

  const root = new URL("../", import.meta.url);
  await execFileAsync(process.execPath, ["scripts/build-github-integrated.mjs"], { cwd: root });
  const html = await readFile(new URL("../dist-pages/index.html", import.meta.url), "utf8");
  const assetNames = await readdir(new URL("../dist-pages/assets/", import.meta.url));
  const scriptName = assetNames.find((name) => /^index-.*\.js$/.test(name));
  const styleName = assetNames.find((name) => /^index-.*\.css$/.test(name));
  assert.ok(scriptName);
  assert.ok(styleName);
  const app = await readFile(new URL(`../dist-pages/assets/${scriptName}`, import.meta.url), "utf8");
  await stat(new URL(`../dist-pages/assets/${styleName}`, import.meta.url));
  await stat(new URL("../dist-pages/.nojekyll", import.meta.url));

  assert.match(html, /lang="pt-BR"/);
  assert.match(html, new RegExp(`src="/guia-comercial-mult-portas/assets/${scriptName}"`));
  assert.match(html, new RegExp(`href="/guia-comercial-mult-portas/assets/${styleName}"`));
  assert.doesNotMatch(html + app, /http-equiv=["']refresh|window\.location\.(?:replace|assign)|chatgpt\.site/i);
  for (const required of ["Crie seu acesso", "Entre no seu espaço", "Equipe em um só lugar.", "Seu próximo passo", "BIBLIOTECA COMERCIAL", "Dados desta conta neste aparelho", "mult-portas-pages-accounts-v1", "Tentar salvar"]) {
    assert.ok(app.includes(required), `Versão Pages sem ${required}`);
  }

  for (const lesson of brimakDocumentLessons) {
    const pdf = await readFile(new URL(`../dist-pages${lesson.href}`, import.meta.url));
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", lesson.href);
  }
});
