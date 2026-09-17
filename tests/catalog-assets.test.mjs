import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalogs = [
  ["brimak-linha-elite.pdf", 22],
  ["brimak-linha-super-25.pdf", 26],
  ["brimak-linha-l25.pdf", 12],
  ["brimak-portas-janelas-pvc.pdf", 8],
  ["brimak-catalogo-2018.pdf", 20],
];

test("Brimak catalog PDFs are present, compact and keep every page", async () => {
  for (const [filename, pages] of catalogs) {
    const file = await readFile(new URL(`../public/catalogos/${filename}`, import.meta.url));
    const source = file.toString("latin1");
    assert.equal(file.subarray(0, 5).toString(), "%PDF-", `${filename} is not a PDF`);
    assert.ok(file.byteLength > 500_000, `${filename} is unexpectedly small`);
    assert.ok(file.byteLength < 10_000_000, `${filename} is too large for web delivery`);
    assert.match(source, new RegExp(`/Count ${pages}\\b`), `${filename} changed page count`);
  }
});

test("catalog UI exposes only the five requested Brimak files", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\| "brimak" \|/);
  assert.match(page, /const studiedCatalogCount = 10;/);
  assert.match(page, /5 catálogos Brimak anexados/);
  catalogs.forEach(([filename]) => assert.match(page, new RegExp(`/catalogos/${filename.replaceAll(".", "\\.")}`)));
  assert.doesNotMatch(page, /mult-portas-catalogo-2026\.pdf/);
});
