import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("GitHub Pages build remains a safe redirect to the hosted guide", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const redirectSource = await readFile(new URL("../scripts/build-github-redirect.mjs", import.meta.url), "utf8");
  assert.equal(packageJson.scripts["build:github"], "node scripts/build-github-redirect.mjs");
  assert.match(redirectSource, /guia-comercial-mult-portas\.eletrovale-cont\.chatgpt\.site/);
  assert.match(redirectSource, /noindex, nofollow/);
});
