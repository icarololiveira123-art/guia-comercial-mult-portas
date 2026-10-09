import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { brimakDocumentLessons, learningByBrand } from "../app/lib/catalog-learning.mjs";
import {
  CLIENT_PROGRESS_BRANDS,
  MAX_CLIENT_PROGRESS_BYTES,
  applyClientProgress,
  clientProgressStorageKeys,
  collectClientProgress,
  migrateClientProgress,
  mergeClientProgress,
  normalizeClientProgress,
} from "../app/lib/client-progress.mjs";

function storageFixture(entries = []) {
  const values = new Map(entries);
  const reads = [];
  const writes = [];
  return {
    values, reads, writes,
    getItem(key) { reads.push(key); return values.get(key) ?? null; },
    setItem(key, value) { writes.push([key, value]); values.set(key, value); },
  };
}

const resumeKey = (id, scope = "local") => clientProgressStorageKeys(id, { scope })[0];
const learningKey = (id, brand, scope = "local") => clientProgressStorageKeys(id, { scope }).find((key) => key.includes("-learning-") && key.endsWith(`-brand-${brand}`));
const sheetKey = (id, brand, scope = "local") => clientProgressStorageKeys(id, { scope }).find((key) => key.includes("-study-sheet-") && key.endsWith(`-brand-${brand}`));
const viewKey = (id, brand, scope = "local") => clientProgressStorageKeys(id, { scope }).find((key) => key.includes("-catalog-view-") && key.endsWith(`-brand-${brand}`));

test("a damaged local sheet cannot replace cloud notes when another progress field changes", () => {
  const cloud = { schemaVersion: 1, resume: { section: "catalog", brand: "dalcomad" }, brands: { dalcomad: { studySheet: { product: "Porta escolhida", measure: "80 × 210 cm" }, learning: { stage: "quality", answers: { measures: 1, brand: 0 } } } } };
  const browser = storageFixture([[sheetKey(41, "dalcomad", "shared"), "{damaged"], [learningKey(41, "dalcomad", "shared"), JSON.stringify({ stage: "practice", answers: {} })]]);
  const merged = mergeClientProgress(cloud, collectClientProgress(41, browser, { scope: "shared" }));
  assert.deepEqual(merged.brands.dalcomad.studySheet, cloud.brands.dalcomad.studySheet);
  assert.deepEqual(merged.brands.dalcomad.learning, { stage: "practice", answers: {} });
  assert.equal(browser.values.get(sheetKey(41, "dalcomad", "shared")), "{damaged");
  const edited = mergeClientProgress(merged, { schemaVersion: 1, brands: { dalcomad: { studySheet: { measure: "" } } } });
  assert.deepEqual(edited.brands.dalcomad.studySheet, { product: "Porta escolhida", measure: "" });
  assert.deepEqual(edited.resume, cloud.resume);
});

test("portable progress round trips the selected employee without reading auth, business or other employees' records", () => {
  const ownResume = { section: "catalog", brand: "brimak", messageView: "compose", salesStep: 4, trainingScenario: 15, trainingStarted: true, trainingMessages: [{ role: "seller", text: "Confira a medida do vão." }], trainingInput: "Meu próximo passo" };
  const ownLearning = { stage: "practice", answers: { measures: 1, brand: 2, [`document:${brimakDocumentLessons[0].href}`]: 0 } };
  const storage = storageFixture([
    [resumeKey(7), JSON.stringify(ownResume)],
    [learningKey(7, "brimak"), JSON.stringify(ownLearning)],
    [sheetKey(7, "brimak"), JSON.stringify({ product: "Uma porta", pending: "Conferir a ficha." })],
    [viewKey(7, "brimak"), "pdfs"],
    [resumeKey(8), JSON.stringify({ section: "control" })],
    ["mult-portas-pages-accounts-v1", "private account record"],
    ["mult-portas-guia-user-7-pending-state-v1", "private queued business record"],
    ["mult-portas-pages-state-v1-7", "private business record"],
  ]);
  const progress = collectClientProgress(7, storage);
  assert.deepEqual(progress, { schemaVersion: 1, resume: ownResume, brands: { brimak: { learning: ownLearning, studySheet: { product: "Uma porta", pending: "Conferir a ficha." }, view: "pdfs" } } });
  assert.equal(storage.writes.length, 0);
  assert.deepEqual(storage.reads, clientProgressStorageKeys(7));
  const secondComputer = storageFixture();
  const applied = applyClientProgress(7, progress, secondComputer, { scope: "shared" });
  assert.equal(applied.writtenKeys.length, 4);
  assert.deepEqual(collectClientProgress(7, secondComputer, { scope: "shared" }), progress);
  assert.deepEqual(collectClientProgress(8, secondComputer, { scope: "shared" }), { schemaVersion: 1 });
});

test("the exact brand and document whitelist remains consistent with current catalog lessons", () => {
  assert.deepEqual([...CLIENT_PROGRESS_BRANDS].sort(), Object.keys(learningByBrand).sort());
  for (const lesson of brimakDocumentLessons) {
    const value = { schemaVersion: 1, brands: { brimak: { learning: { answers: { [`document:${lesson.href}`]: 2 } } } } };
    assert.deepEqual(normalizeClientProgress(value), value);
  }
  assert.equal(clientProgressStorageKeys(1).length, 28);
  assert.equal(new Set(clientProgressStorageKeys(1)).size, 28);
});

test("strict schema rejects foreign storage keys, unknown brands and prototype pollution before any write", () => {
  const storage = storageFixture();
  const rejected = [
    { schemaVersion: 1, "mult-portas-pages-accounts-v1": {} },
    { schemaVersion: 1, users: { 2: { section: "control" } } },
    { schemaVersion: 1, brands: { another: { view: "learn" } } },
    { schemaVersion: 1, brands: { brimak: { privateData: {} } } },
    { schemaVersion: 1, resume: { username: "another-person" } },
    { schemaVersion: 1, resume: { trainingMessages: [{ role: "seller", text: "Olá", audioUrl: "blob:private" }] } },
    JSON.parse('{"schemaVersion":1,"brands":{"__proto__":{"view":"learn"}}}'),
    JSON.parse('{"schemaVersion":1,"resume":{"constructor":{"prototype":{"polluted":true}}}}'),
    { schemaVersion: 1, brands: { dalcomad: { learning: { answers: { "document:/catalogos/brimak-linha-elite.pdf": 1 } } } } },
    { schemaVersion: 1, brands: { brimak: { learning: { answers: { measures: 3 } } } } },
    { schemaVersion: 1, resume: { factoryWizardDraft: { arbitrary: "text" } } },
  ];
  for (const value of rejected) assert.throws(() => applyClientProgress(1, value, storage), TypeError);
  assert.equal(storage.writes.length, 0);
  assert.equal(Object.prototype.polluted, undefined);
});

test("logical limits and UTF-8 byte limits prevent oversized progress without truncating or deleting originals", () => {
  const rejected = [
    { schemaVersion: 2 },
    { schemaVersion: 1, resume: { salesStep: 5 } },
    { schemaVersion: 1, resume: { timingStep: 6 } },
    { schemaVersion: 1, resume: { trainingScenario: 16 } },
    { schemaVersion: 1, resume: { factoryWizardStep: 8 } },
    { schemaVersion: 1, resume: { trainingInput: "x".repeat(3001) } },
    { schemaVersion: 1, resume: { trainingMessages: Array.from({ length: 25 }, () => ({ role: "seller", text: "x" })) } },
    { schemaVersion: 1, brands: { brimak: { studySheet: { product: "x".repeat(1001) } } } },
  ];
  for (const value of rejected) assert.throws(() => normalizeClientProgress(value), TypeError);
  const large = { schemaVersion: 1, resume: { trainingMessages: Array.from({ length: 24 }, () => ({ role: "seller", text: "漢".repeat(3000) })) } };
  assert.ok(JSON.stringify(large).length < MAX_CLIENT_PROGRESS_BYTES);
  assert.ok(new TextEncoder().encode(JSON.stringify(large)).byteLength > MAX_CLIENT_PROGRESS_BYTES);
  const original = JSON.stringify({ section: "catalog" });
  const storage = storageFixture([[resumeKey(3), original]]);
  assert.throws(() => applyClientProgress(3, large, storage), RangeError);
  assert.equal(storage.values.get(resumeKey(3)), original);
  assert.equal(storage.writes.length, 0);
  const normal = { schemaVersion: 1, resume: { trainingMessages: Array.from({ length: 24 }, () => ({ role: "seller", text: "x".repeat(3000) })) } };
  assert.deepEqual(normalizeClientProgress(normal), normal);
});

test("damaged storage is omitted from export and preserved during remote hydration and migration", () => {
  const damagedResume = '{"section":"catalog"';
  const damagedLearning = 'null';
  const storage = storageFixture([
    [resumeKey(11), damagedResume],
    [learningKey(11, "brimak"), damagedLearning],
    [viewKey(11, "brimak"), "fiches"],
  ]);
  assert.deepEqual(collectClientProgress(11, storage), { schemaVersion: 1, brands: { brimak: { view: "fiches" } } });
  const applied = applyClientProgress(11, { schemaVersion: 1, resume: { section: "overview" }, brands: { brimak: { learning: { stage: "practice" } } } }, storage);
  assert.deepEqual(applied.writtenKeys, []);
  assert.deepEqual(applied.preservedKeys, [resumeKey(11), learningKey(11, "brimak")]);
  const migrated = migrateClientProgress(11, 25, storage);
  assert.deepEqual(migrated.writtenKeys, [viewKey(25, "brimak", "shared")]);
  assert.equal(storage.values.get(resumeKey(11)), damagedResume);
  assert.equal(storage.values.get(learningKey(11, "brimak")), damagedLearning);
  assert.equal(storage.values.get(resumeKey(25, "shared")), undefined);
  assert.equal(storage.values.get(viewKey(11, "brimak")), "fiches");
});

test("missing remote progress and omitted fields never erase existing local notes or answers", () => {
  const originalResume = { section: "catalog", brand: "brimak", trainingInput: "Conferir o lado" };
  const originalLearning = { stage: "quality", answers: { brand: 1 } };
  const originalSheet = { product: "Modelo confirmado", use: "Quarto", pending: "Conferir o vão" };
  const storage = storageFixture([
    [resumeKey(6, "shared"), JSON.stringify(originalResume)],
    [learningKey(6, "brimak", "shared"), JSON.stringify(originalLearning)],
    [sheetKey(6, "brimak", "shared"), JSON.stringify(originalSheet)],
    [viewKey(6, "brimak", "shared"), "pdfs"],
  ]);
  for (const value of [null, undefined, { schemaVersion: 1 }, { schemaVersion: 1, brands: {} }]) {
    assert.deepEqual(applyClientProgress(6, value, storage, { scope: "shared" }).writtenKeys, []);
  }
  applyClientProgress(6, { schemaVersion: 1, resume: { section: "overview" }, brands: { brimak: { studySheet: { use: "Sala" }, learning: { stage: "practice" } } } }, storage, { scope: "shared" });
  assert.deepEqual(JSON.parse(storage.values.get(resumeKey(6, "shared"))), { ...originalResume, section: "overview" });
  assert.deepEqual(JSON.parse(storage.values.get(sheetKey(6, "brimak", "shared"))), { ...originalSheet, use: "Sala" });
  assert.deepEqual(JSON.parse(storage.values.get(learningKey(6, "brimak", "shared"))), { ...originalLearning, stage: "practice" });
  assert.equal(storage.values.get(viewKey(6, "brimak", "shared")), "pdfs");
  // Explicit empty field values/answers remain valid reset operations.
  applyClientProgress(6, { schemaVersion: 1, brands: { brimak: { studySheet: { pending: "" }, learning: { answers: {} } } } }, storage, { scope: "shared" });
  assert.equal(JSON.parse(storage.values.get(sheetKey(6, "brimak", "shared"))).pending, "");
  assert.deepEqual(JSON.parse(storage.values.get(learningKey(6, "brimak", "shared"))).answers, {});
});

test("colliding legacy and central numeric IDs remain separated until explicit authenticated migration", () => {
  const legacy = JSON.stringify({ section: "control", brand: "dalcomad" });
  const remote = JSON.stringify({ section: "catalog", brand: "brimak" });
  const storage = storageFixture([[resumeKey(12), legacy]]);
  assert.deepEqual(collectClientProgress(12, storage, { scope: "shared" }), { schemaVersion: 1 });
  applyClientProgress(12, { schemaVersion: 1, resume: JSON.parse(remote) }, storage, { scope: "shared" });
  assert.equal(storage.values.get(resumeKey(12)), legacy);
  assert.equal(storage.values.get(resumeKey(12, "shared")), remote);
  const migration = migrateClientProgress(12, 12, storage);
  assert.deepEqual(migration.writtenKeys, []);
  assert.deepEqual(migration.preservedKeys, [resumeKey(12, "shared")]);
  assert.equal(storage.values.get(resumeKey(12)), legacy);
  assert.equal(storage.values.get(resumeKey(12, "shared")), remote);
});

test("migration copies exact valid records without deleting originals or overwriting destination records", () => {
  const original = '{ "section": "catalog", "brand": "brimak" }';
  const notes = JSON.stringify({ product: "Aprendizado", pending: "Falta conferir medida" });
  const destinationDamaged = '{"product":';
  const storage = storageFixture([
    [resumeKey(4), original],
    [sheetKey(4, "brimak"), notes],
    [sheetKey(90, "brimak", "shared"), destinationDamaged],
    [resumeKey(5), JSON.stringify({ section: "marketing" })],
  ]);
  const result = migrateClientProgress(4, 90, storage);
  assert.deepEqual(result.writtenKeys, [resumeKey(90, "shared")]);
  assert.equal(storage.values.get(resumeKey(4)), original);
  assert.equal(storage.values.get(resumeKey(90, "shared")), original);
  assert.equal(storage.values.get(sheetKey(4, "brimak")), notes);
  assert.equal(storage.values.get(sheetKey(90, "brimak", "shared")), destinationDamaged);
  assert.equal(storage.values.get(resumeKey(5, "shared")), undefined);
  assert.ok(storage.reads.every((key) => clientProgressStorageKeys(4).includes(key) || clientProgressStorageKeys(90, { scope: "shared" }).includes(key)));
});

test("invalid user/scope inputs and blocked storage cannot access another namespace", () => {
  const storage = storageFixture();
  for (const id of [0, -1, Number.MAX_SAFE_INTEGER + 1, "../2", "", {}, null]) assert.throws(() => collectClientProgress(id, storage), TypeError);
  assert.throws(() => collectClientProgress(1, storage, { scope: "arbitrary" }), TypeError);
  assert.equal(storage.reads.length, 0);
  const blocked = { getItem() { throw new Error("Storage blocked"); }, setItem() { throw new Error("Storage blocked"); } };
  assert.deepEqual(collectClientProgress(1, blocked), { schemaVersion: 1 });
  assert.deepEqual(applyClientProgress(1, { schemaVersion: 1, resume: { section: "catalog" } }, blocked), { writtenKeys: [], preservedKeys: [resumeKey(1)] });
});

test("schema step limits match the current frontend controls so legitimate resume remains portable", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const countItems = (start) => {
    const begin = source.indexOf(start);
    assert.ok(begin >= 0, "the expected frontend array must exist");
    const end = source.indexOf("\n];", begin);
    assert.ok(end > begin, "the frontend array must have a clear boundary");
    return (source.slice(begin, end).match(/\n    id: "/g) ?? []).length;
  };
  assert.equal(countItems("const salesSteps = ["), 5);
  assert.equal(countItems("const timingSteps = ["), 6);
  assert.equal(countItems("const trainingScenarios:"), 16);
});
