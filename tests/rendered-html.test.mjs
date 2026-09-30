import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
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

test("GitHub Pages builds a self-contained catalog and lessons at the repository path", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["build:github"], "node scripts/build-github-site.mjs");

  const root = new URL("../", import.meta.url);
  await execFileAsync(process.execPath, ["scripts/build-github-site.mjs"], { cwd: root });
  const html = await readFile(new URL("../dist-pages/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../dist-pages/app.js", import.meta.url), "utf8");
  await stat(new URL("../dist-pages/styles.css", import.meta.url));
  await stat(new URL("../dist-pages/catalog-learning.mjs", import.meta.url));
  await stat(new URL("../dist-pages/catalog-items.mjs", import.meta.url));

  assert.match(html, /lang="pt-BR"/);
  assert.match(html, /src="\.\/app\.js"/);
  assert.match(html, /href="\.\/styles\.css"/);
  assert.doesNotMatch(html + app, /http-equiv=["']refresh|window\.location\.(?:replace|assign)|chatgpt\.site/i);
  assert.match(app, /catalog-learning\.mjs/);
  assert.match(app, /catalog-items\.mjs/);

  for (const lesson of brimakDocumentLessons) {
    const pdf = await readFile(new URL(`../dist-pages${lesson.href}`, import.meta.url));
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", lesson.href);
  }
});
