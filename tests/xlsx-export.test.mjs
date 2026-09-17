import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import {
  availableDalcomadKitValues,
  dalcomadKitCombinations,
  getDalcomadKitSwatch,
  isKnownDalcomadKitCombination,
  normalizeDalcomadKitSelection,
  parseDalcomadKitPrice,
} from "../app/lib/dalcomad-kit.mjs";
import { createWorkbookArchive, downloadWorkbook } from "../app/lib/xlsx-export.mjs";

test("Excel export is valid OOXML, keeps numeric prices and neutralizes formula text", () => {
  const archive = createWorkbookArchive({
    title: "Requisição & teste",
    subject: "Validação",
    author: "Mult Portas",
    createdAt: "2026-08-13T12:00:00.000Z",
    sheets: [
      {
        name: "Requisições",
        rows: [
          ["Produto", "Preço"],
          ["Porta <teste>", 1299.9],
          ["=HYPERLINK(\"https://example.invalid\")", 0],
        ],
        columnWidths: [30, 18],
        currencyColumns: [1],
        autoFilter: true,
      },
      { name: "Listas", rows: [["Campo", "Valor"], ["Cor", "Branco"]] },
    ],
  });
  const files = unzipSync(archive);
  const requiredFiles = [
    "[Content_Types].xml",
    "_rels/.rels",
    "docProps/core.xml",
    "docProps/app.xml",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
  ];
  requiredFiles.forEach((name) => assert.ok(files[name], `${name} ausente`));

  const worksheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(worksheet, /<dimension ref="A1:B3"\/>/);
  assert.match(worksheet, /<autoFilter ref="A1:B3"\/>/);
  assert.match(worksheet, /Porta &lt;teste&gt;/);
  assert.match(worksheet, /<c r="B2" s="3"><v>1299\.9<\/v><\/c>/);
  assert.match(worksheet, /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/);
  assert.doesNotMatch(worksheet, /<f>/);
  assert.match(strFromU8(files["docProps/core.xml"]), /Requisição &amp; teste/);
});

test("Excel export removes invalid XML controls and preserves valid Unicode", () => {
  const archive = createWorkbookArchive({
    sheets: [{ name: "Kits", rows: [["Observação"], ["Kit\u0000 Dalcomad 🚪"]] }],
  });
  const worksheet = strFromU8(unzipSync(archive)["xl/worksheets/sheet1.xml"]);
  assert.doesNotMatch(worksheet, /\u0000/);
  assert.match(worksheet, /Kit Dalcomad 🚪/);
});

test("Excel download keeps the user click synchronous and exposes the correct file", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalCreateObjectURL = globalThis.URL.createObjectURL;
  const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
  const events = [];
  let createdBlob;
  let revokeDelay = 0;
  const anchor = {
    href: "",
    download: "",
    rel: "",
    style: {},
    click() { events.push("click"); },
    remove() { events.push("remove"); },
  };

  try {
    globalThis.document = {
      createElement(tag) {
        assert.equal(tag, "a");
        events.push("create");
        return anchor;
      },
      body: {
        appendChild(value) {
          assert.equal(value, anchor);
          events.push("append");
        },
      },
    };
    globalThis.window = {
      setTimeout(callback, delay) {
        revokeDelay = delay;
        callback();
        return 1;
      },
    };
    globalThis.URL.createObjectURL = (blob) => {
      createdBlob = blob;
      events.push("url");
      return "blob:requisicao-dalcomad";
    };
    globalThis.URL.revokeObjectURL = (url) => {
      assert.equal(url, "blob:requisicao-dalcomad");
      events.push("revoke");
    };

    const result = downloadWorkbook({
      filename: "Requisicao_Kit_Porta_Dalcomad",
      sheets: [{ name: "Requisições", rows: [["Fabricante"], ["DALCOMAD"]] }],
    });

    assert.deepEqual(events, ["url", "create", "append", "click", "remove", "revoke"]);
    assert.equal(anchor.download, "Requisicao_Kit_Porta_Dalcomad.xlsx");
    assert.equal(anchor.href, "blob:requisicao-dalcomad");
    assert.equal(createdBlob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.ok(result.byteLength > 0);
    assert.equal(result.filename, anchor.download);
    assert.equal(revokeDelay, 60_000);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.URL.createObjectURL = originalCreateObjectURL;
    globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test("Dalcomad request uses the exact line, finish and color combinations from the sample boards", () => {
  assert.deepEqual(dalcomadKitCombinations.map(({ line, finish, color }) => [line, finish, color]), [
    ["ECO", "PET/PVC TX", "CINZA URBAN"],
    ["ECO", "PET/PVC TX", "BRANCO DIAMANTE"],
    ["ECO", "PET/PVC TX", "CURUPIXA"],
    ["STANDART", "MELAMÍNICO", "UNI WHITE"],
    ["STANDART", "MELAMÍNICO", "FREIJO"],
    ["STANDART", "MELAMÍNICO", "CURUPIXA"],
    ["SENSE", "RENOLIT", "BLACK SP"],
    ["SENSE", "RENOLIT", "CINZA GREY"],
    ["SENSE", "RENOLIT", "BRANCO POLAR"],
    ["SENSE", "RENOLIT", "SIRUS CREAM"],
  ]);
  assert.deepEqual(availableDalcomadKitValues("color", { line: "ECO", finish: "PET/PVC TX" }), ["CINZA URBAN", "BRANCO DIAMANTE", "CURUPIXA"]);
  assert.deepEqual(availableDalcomadKitValues("finish", { line: "SENSE" }), ["RENOLIT"]);
  assert.equal(isKnownDalcomadKitCombination({ line: "ECO", finish: "PET/PVC TX", color: "CINZA URBAN" }), true);
  assert.equal(isKnownDalcomadKitCombination({ line: "ECO", finish: "RENOLIT", color: "BLACK SP" }), false);
  assert.equal(isKnownDalcomadKitCombination({ line: "ECO", finish: "RENOLIT", color: "A confirmar" }), false);
  assert.equal(getDalcomadKitSwatch("ECO", "CURUPIXA"), "#b8753f");
  assert.equal(getDalcomadKitSwatch("STANDART", "CURUPIXA"), "#ad6d3c");
});

test("Dalcomad prices accept Brazilian currency and reject malformed values", () => {
  assert.equal(parseDalcomadKitPrice("R$ 1.234,56"), 1234.56);
  assert.equal(parseDalcomadKitPrice("1234.56"), 1234.56);
  assert.equal(parseDalcomadKitPrice("1.234"), 1234);
  assert.equal(parseDalcomadKitPrice(49.9), 49.9);
  assert.equal(parseDalcomadKitPrice(""), "");
  assert.equal(parseDalcomadKitPrice("-10"), null);
  assert.equal(parseDalcomadKitPrice("R$ dez"), null);
});

test("Dalcomad request migrates earlier spellings into the photographed combinations", () => {
  assert.deepEqual(normalizeDalcomadKitSelection({ line: "STANDER", finish: "MELAMINICO", color: "FREIJÓ" }), {
    line: "STANDART",
    finish: "MELAMÍNICO",
    color: "FREIJO",
  });
  assert.deepEqual(normalizeDalcomadKitSelection({ line: "SENCE", finish: "RENOLIT", color: "PRETO" }), {
    line: "SENSE",
    finish: "RENOLIT",
    color: "BLACK SP",
  });
  assert.deepEqual(normalizeDalcomadKitSelection({ line: "ECO", finish: "PET", color: "BRANCO" }), {
    line: "ECO",
    finish: "PET/PVC TX",
    color: "BRANCO DIAMANTE",
  });
});

test("Dalcomad request keeps Kit Porta and ABRIR fixed in the interface and export", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const wizard = source.slice(source.indexOf("const factoryWizardSteps"), source.indexOf("const defaultFactoryItems"));

  assert.doesNotMatch(wizard, /key: "description"|key: "opening"/);
  assert.ok(wizard.indexOf('key: "line"') < wizard.indexOf('key: "finish"'));
  assert.ok(wizard.indexOf('key: "finish"') < wizard.indexOf('key: "color"'));
  assert.match(wizard, /key: "priceWithoutLock"/);
  assert.match(wizard, /key: "priceWithLock"/);
  assert.match(source, /description: "KIT PORTA",\s+opening: "ABRIR",\s+\.\.\.factoryWizardDraft,/s);
  assert.match(source, /dalcomadKitCombinations\.forEach\(\(item\) => listRows\.push\(\[item\.line, item\.finish, item\.color\]\)\)/);
  assert.match(source, /import \{ downloadWorkbook \} from "\.\/lib\/xlsx-export\.mjs"/);
  assert.doesNotMatch(source, /await import\("\.\/lib\/xlsx-export\.mjs"\)/);
  assert.match(source, /className="factory-submitted-list"/);
  assert.match(source, /editFactoryItem/);
  assert.match(source, /removeFactoryItem/);
  assert.match(source, /existingIds\.has\(generatedId\)/);
  assert.match(source, /setFactoryItems\(\[\]\);\s+resetFactoryWizard\(\);/);
});
