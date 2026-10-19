import assert from "node:assert/strict";
import test from "node:test";
import { applyClientProgress, clientProgressStorageKeys, collectClientProgress, mergeClientProgress } from "../app/lib/client-progress.mjs";
import { businessDay, keepLocalQuotes, keepLocalWorkspace } from "../app/lib/local-workspace-archive.mjs";
import { archiveDamagedPendingBackup, readPendingBackup } from "../app/lib/pending-backup.mjs";

// Entirely disposable fixtures: no browser account, network call or real DB.
class Storage {
  values = new Map();
  reads = [];
  writes = [];
  getItem(key) { this.reads.push(key); return this.values.get(key) ?? null; }
  setItem(key, value) { this.writes.push(key); this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function indexedDbFixture() {
  const stores = new Map();
  let initialized = false;
  const database = {
    close() {},
    createObjectStore(name, options) { stores.set(name, { options, values: new Map() }); },
    transaction(name) {
      const store = stores.get(name);
      const transaction = {};
      let pending = 0;
      let completed = false;
      const finish = () => queueMicrotask(() => {
        if (!pending && !completed) { completed = true; transaction.oncomplete?.(); }
      });
      transaction.objectStore = () => ({
        get(key) {
          const request = {};
          pending++;
          queueMicrotask(() => {
            request.result = structuredClone(store.values.get(JSON.stringify(key)));
            request.onsuccess?.();
            pending--; finish();
          });
          return request;
        },
        put(value) {
          pending++;
          const saved = structuredClone(value);
          queueMicrotask(() => {
            const key = store.options.keyPath.map(field => saved[field]);
            store.values.set(JSON.stringify(key), saved);
            pending--; finish();
          });
        },
      });
      return transaction;
    },
  };
  return {
    stores,
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        if (!initialized) { initialized = true; request.onupgradeneeded?.(); }
        request.onsuccess?.();
      });
      return request;
    },
  };
}

async function withGlobalStorageGetters(getters, work) {
  const originals = new Map(Object.keys(getters).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, get] of Object.entries(getters)) Object.defineProperty(globalThis, key, { configurable: true, get });
    await work();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test("security: every account and storage scope has disjoint progress keys and exact-key reads", () => {
  const storage = new Storage();
  const groups = [];
  for (const scope of ["local", "shared"]) for (const userId of [1, 2, 900719925450001]) {
    const payload = { schemaVersion: 1, resume: { trainingInput: `${scope}-${userId}`, section: "training" }, brands: { brimak: { studySheet: { pending: `private-${scope}-${userId}` } } } };
    applyClientProgress(userId, payload, storage, { scope });
    groups.push(clientProgressStorageKeys(userId, { scope }));
    storage.reads.length = 0;
    assert.deepEqual(collectClientProgress(userId, storage, { scope }), payload);
    assert.ok(storage.reads.every(key => groups.at(-1).includes(key)));
  }
  const keys = groups.flat();
  assert.equal(new Set(keys).size, keys.length);
});

test("security: prototype payloads and accessor getters are rejected before storage access", () => {
  const storage = new Storage();
  let getterRuns = 0;
  const accessor = { schemaVersion: 1, resume: {} };
  Object.defineProperty(accessor.resume, "trainingInput", { enumerable: true, get() { getterRuns++; return "unexpected"; } });
  const payloads = [
    JSON.parse('{"schemaVersion":1,"brands":{"__proto__":{"studySheet":{"pending":"injected"}}}}'),
    JSON.parse('{"schemaVersion":1,"resume":{"constructor":{"prototype":{"securityPolluted":true}}}}'),
    { schemaVersion: 1, resume: Object.create({ trainingInput: "inherited" }) },
    accessor,
  ];
  for (const payload of payloads) assert.throws(() => applyClientProgress(1, payload, storage, { scope: "shared" }), TypeError);
  assert.equal(getterRuns, 0);
  assert.deepEqual(storage.reads, []);
  assert.deepEqual(storage.writes, []);
  assert.equal(Object.prototype.securityPolluted, undefined);
});

test("security: merging an incomplete remote progress record preserves original private notes", () => {
  const original = { schemaVersion: 1, resume: { section: "catalog", trainingInput: "rascunho" }, brands: { brimak: { studySheet: { product: "Porta", pending: "Conferir vão" }, learning: { stage: "quality", answers: { measures: 2 } } } } };
  const patch = { schemaVersion: 1, resume: { section: "overview" }, brands: { brimak: { studySheet: { product: "Janela" } } } };
  const before = structuredClone(original);
  const merged = mergeClientProgress(original, patch);
  assert.deepEqual(original, before);
  assert.equal(merged.resume.trainingInput, "rascunho");
  assert.equal(merged.brands.brimak.studySheet.pending, "Conferir vão");
  assert.equal(merged.brands.brimak.studySheet.product, "Janela");
  assert.deepEqual(merged.brands.brimak.learning, before.brands.brimak.learning);
});

test("security: workspace permanent copies isolate profiles and reject older replacement", async () => {
  const storage = new Storage();
  const database = indexedDbFixture();
  const first = { updatedAt: "2026-10-18T15:00:00.000Z", state: { followups: [{ client: "fixture-A" }] }, revision: "A1" };
  const second = { updatedAt: "2026-10-18T16:00:00.000Z", state: { followups: [{ client: "fixture-A-newer" }] }, revision: "A2", userId: 999 };
  const other = { updatedAt: "2026-10-18T16:00:00.000Z", state: { followups: [{ client: "fixture-B" }] }, revision: "B1" };
  assert.equal(await keepLocalWorkspace(11, first, { storage, database }), true);
  assert.equal(await keepLocalWorkspace(11, second, { storage, database }), true);
  assert.equal(await keepLocalWorkspace(12, other, { storage, database }), true);
  assert.equal(await keepLocalWorkspace(11, first, { storage, database }), true);
  const a = JSON.parse(storage.getItem("mult-portas-shared-user-11-workspace-copy-v1"));
  const b = JSON.parse(storage.getItem("mult-portas-shared-user-12-workspace-copy-v1"));
  assert.equal(a.userId, 11);
  assert.equal(a.revision, "A2");
  assert.equal(b.revision, "B1");
  const days = database.stores.get("days").values;
  assert.equal(days.get(JSON.stringify([11, "2026-10-18"])).revision, "A2");
  assert.equal(days.get(JSON.stringify([12, "2026-10-18"])).revision, "B1");
  const writes = storage.writes.length;
  for (const userId of [0, -1, "11", NaN, Infinity, 9007199254740992]) assert.equal(await keepLocalWorkspace(userId, first, { storage, database }), false);
  assert.equal(storage.writes.length, writes);
});

test("security: the browser fallback can fail while independent permanent IndexedDB copies still persist", async () => {
  const database = indexedDbFixture();
  const blocked = { getItem() { throw new DOMException("storage blocked", "SecurityError"); }, setItem() { assert.fail("storage is blocked"); } };
  const snapshot = { updatedAt: "2026-10-19T02:30:00.000Z", state: { sales: ["fixture-only"] } };
  assert.equal(await keepLocalWorkspace(31, snapshot, { storage: blocked, database }), true);
  assert.ok(database.stores.get("days").values.has(JSON.stringify([31, "2026-10-18"])));
});

test("security: a denied global localStorage getter cannot block independent IndexedDB archives", async () => {
  const database = indexedDbFixture();
  await withGlobalStorageGetters({
    localStorage() { throw new DOMException("Browser storage denied", "SecurityError"); },
    indexedDB() { return database; },
  }, async () => {
    assert.equal(await keepLocalWorkspace(51, { updatedAt: "2026-10-18T15:00:00.000Z", state: { sales: ["fixture"] } }), true);
    assert.ok(database.stores.get("days").values.has(JSON.stringify([51, "2026-10-18"])));
    assert.equal(await keepLocalQuotes(51, [{ id: crypto.randomUUID(), revision: 1 }]), true);
    assert.equal(database.stores.get("quotes").values.size, 1);
  });
});

test("security: a denied global IndexedDB getter preserves the localStorage workspace fallback", async () => {
  const storage = new Storage();
  await withGlobalStorageGetters({
    localStorage() { return storage; },
    indexedDB() { throw new DOMException("Browser database denied", "SecurityError"); },
  }, async () => {
    assert.equal(await keepLocalWorkspace(52, { state: { sales: ["fixture"] } }), true);
    assert.equal(JSON.parse(storage.getItem("mult-portas-shared-user-52-workspace-copy-v1")).userId, 52);
    assert.equal(await keepLocalQuotes(52, [{ id: crypto.randomUUID(), revision: 1 }]), false);
  });
});

test("security: both denied storage getters return an unavailable result without rejected promises", async () => {
  const denied = () => { throw new DOMException("Browser storage denied", "SecurityError"); };
  await withGlobalStorageGetters({ localStorage: denied, indexedDB: denied }, async () => {
    assert.equal(await keepLocalWorkspace(53, { state: { sales: ["fixture"] } }), false);
    assert.equal(await keepLocalQuotes(53, [{ id: crypto.randomUUID(), revision: 1 }]), false);
  });
});

test("security: quote archives key records by profile, request ID and day, and preserve newer revisions", async () => {
  const database = indexedDbFixture();
  const id = crypto.randomUUID();
  await keepLocalQuotes(11, [{ id, revision: 3, clientName: "fixture A newest" }], database);
  await keepLocalQuotes(12, [{ id, revision: 1, clientName: "fixture B" }], database);
  await keepLocalQuotes(11, [{ id, revision: 2, clientName: "fixture A old" }], database);
  const saved = database.stores.get("quotes").values;
  assert.equal(saved.size, 2);
  assert.equal(saved.get(JSON.stringify([11, id, businessDay()])).record.revision, 3);
  assert.equal(saved.get(JSON.stringify([12, id, businessDay()])).record.clientName, "fixture B");
});

test("security: malformed pending data remains verbatim and recovery never touches another profile", () => {
  const storage = new Storage();
  const a = "mult-portas-shared-user-11-pending-state-v1";
  const b = "mult-portas-shared-user-12-pending-state-v1";
  const raw = '{"state":{"unfinished":';
  storage.setItem(a, raw);
  storage.setItem(b, "fixture B untouched");
  assert.deepEqual(readPendingBackup(storage, a), { status: "damaged", raw });
  archiveDamagedPendingBackup(storage, a, "mult-portas-shared-user-11-damaged-pending-archive-v1", raw);
  assert.equal(storage.getItem(a), null);
  assert.equal(storage.getItem(b), "fixture B untouched");
  const archive = JSON.parse(storage.getItem("mult-portas-shared-user-11-damaged-pending-archive-v1"));
  assert.equal(archive.entries[0].raw, raw);
});
