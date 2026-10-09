import assert from "node:assert/strict";
import test from "node:test";
import { archiveDamagedPendingBackup, MAX_PENDING_ARCHIVE_BYTES, MAX_PENDING_ARCHIVE_ENTRIES, readPendingBackup } from "../app/lib/pending-backup.mjs";

class Storage {
  items = new Map();
  mutations = [];
  getItem(key) { return this.items.get(key) ?? null; }
  setItem(key, value) { this.mutations.push({ kind: "set", key }); this.items.set(key, String(value)); }
  removeItem(key) { this.mutations.push({ kind: "remove", key }); this.items.delete(key); }
}
const pendingKey = "mult-portas-shared-user-7-pending-state-v1";
const archiveKey = "mult-portas-shared-user-7-recovery-v1";
const pending = (patch = {}) => ({ state: { sales: ["qualify"], followups: [{ id: "quote", client: "Cliente", next: "Retornar" }] }, baseRevision: null, updatedAt: "2026-10-09T16:00:00.000Z", ...patch });
const archive = (entries) => JSON.stringify({ schemaVersion: 1, entries });
const entry = (raw) => ({ capturedAt: "2026-10-09T16:00:00.000Z", raw });
function damaged(raw = "{incomplete") {
  const storage = new Storage();
  storage.setItem(pendingKey, raw);
  storage.mutations.length = 0;
  return storage;
}

test("pending reads distinguish absent, unavailable, damaged and valid without any mutations", () => {
  const storage = new Storage();
  assert.deepEqual(readPendingBackup(storage, pendingKey), { status: "absent" });
  assert.deepEqual(readPendingBackup(undefined, pendingKey), { status: "unavailable" });
  assert.deepEqual(readPendingBackup({ getItem() { throw new DOMException("blocked", "SecurityError"); } }, pendingKey), { status: "unavailable" });
  const raw = " \n" + JSON.stringify(pending({ baseRevision: "2026-10-09T15:00:00.000Z|revision", clientState: { schemaVersion: 1, resume: { section: "control" } } })) + " \n";
  storage.setItem(pendingKey, raw);
  storage.mutations.length = 0;
  const result = readPendingBackup(storage, pendingKey);
  assert.equal(result.status, "valid");
  assert.equal(result.raw, raw);
  assert.equal(result.pending.baseRevision, "2026-10-09T15:00:00.000Z|revision");
  assert.equal(result.pending.clientState.resume.section, "control");
  assert.equal(storage.getItem(pendingKey), raw);
  assert.deepEqual(storage.mutations, []);
});

test("missing revisions, invalid dates and damaged shapes retain their exact original bytes", () => {
  const missing = pending();
  delete missing.baseRevision;
  const missingDate = pending();
  delete missingDate.updatedAt;
  const raws = ["", "{broken", "null", "[]", JSON.stringify(missing), JSON.stringify(missingDate),
    JSON.stringify(pending({ state: [] })), JSON.stringify(pending({ state: null })),
    ...[0, false, "", "   ", "x".repeat(201), "a\nrevision"].map((baseRevision) => JSON.stringify(pending({ baseRevision }))),
    ...[0, null, "today", "2026-02-30T00:00:00.000Z", "2026-10-09T24:00:00.000Z", "2026-10-09T16:00:00.000Zjunk"].map((updatedAt) => JSON.stringify(pending({ updatedAt }))),
    JSON.stringify(pending({ clientState: [] })), JSON.stringify(pending({ clientState: { schemaVersion: 99 } })),
    JSON.stringify(pending({ state: { large: "x".repeat(400_000) } })),
  ];
  for (const raw of raws) {
    const storage = damaged(raw);
    assert.deepEqual(readPendingBackup(storage, pendingKey), { status: "damaged", raw });
    assert.equal(storage.getItem(pendingKey), raw);
    assert.deepEqual(storage.mutations, []);
  }
});

test("a confirmed archive stores the exact damaged raw before releasing only its pending key", () => {
  const raw = " \n{\"value\":\"original damaged data\"\n";
  const storage = damaged(raw);
  storage.setItem("another-account", "preserved");
  storage.mutations.length = 0;
  const result = archiveDamagedPendingBackup(storage, pendingKey, archiveKey, raw);
  assert.deepEqual(result, { archived: true, entries: 1, archiveKey });
  const saved = JSON.parse(storage.getItem(archiveKey));
  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.entries[0].raw, raw);
  assert.ok(Number.isFinite(Date.parse(saved.entries[0].capturedAt)));
  assert.equal(storage.getItem(pendingKey), null);
  assert.equal(storage.getItem("another-account"), "preserved");
  assert.deepEqual(storage.mutations, [{ kind: "set", key: archiveKey }, { kind: "remove", key: pendingKey }]);
});

test("malformed existing archives cannot be overwritten and never release damaged pending work", () => {
  const raw = "{unfinished work";
  for (const previous of ["{bad archive", "[]", "null", JSON.stringify({ entries: [] }), JSON.stringify({ schemaVersion: 2, entries: [] }), archive([entry(null)]), archive([{ capturedAt: "invalid", raw: "saved" }]), archive(Array.from({ length: 9 }, () => entry("saved")))]) {
    const storage = damaged(raw);
    storage.setItem(archiveKey, previous);
    storage.mutations.length = 0;
    assert.throws(() => archiveDamagedPendingBackup(storage, pendingKey, archiveKey, raw), /recuperação/);
    assert.equal(storage.getItem(pendingKey), raw);
    assert.equal(storage.getItem(archiveKey), previous);
    assert.deepEqual(storage.mutations, []);
  }
});

test("quota failures and unconfirmed writes preserve the original pending record", () => {
  const raw = "{quota recovery";
  const quota = damaged(raw);
  const previous = archive([entry("older")]);
  quota.setItem(archiveKey, previous);
  quota.mutations.length = 0;
  quota.setItem = () => { throw new DOMException("quota full", "QuotaExceededError"); };
  assert.throws(() => archiveDamagedPendingBackup(quota, pendingKey, archiveKey, raw), /não confirmou/);
  assert.equal(quota.getItem(pendingKey), raw);
  assert.equal(quota.getItem(archiveKey), previous);
  assert.deepEqual(quota.mutations, []);
  const unconfirmed = damaged(raw);
  unconfirmed.setItem = () => {};
  assert.throws(() => archiveDamagedPendingBackup(unconfirmed, pendingKey, archiveKey, raw), /não confirmou/);
  assert.equal(unconfirmed.getItem(pendingKey), raw);
  assert.equal(unconfirmed.getItem(archiveKey), null);
  assert.deepEqual(unconfirmed.mutations, []);
});

test("a newer pending value arriving during the archive write cannot be removed", () => {
  const raw = "{old damaged pending";
  const newer = JSON.stringify(pending({ state: { sales: ["newer-edit"] } }));
  const storage = damaged(raw);
  const set = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    set(key, value);
    if (key === archiveKey) storage.items.set(pendingKey, newer);
  };
  assert.throws(() => archiveDamagedPendingBackup(storage, pendingKey, archiveKey, raw), /dados mudaram/);
  assert.equal(storage.getItem(pendingKey), newer);
  assert.equal(JSON.parse(storage.getItem(archiveKey)).entries[0].raw, raw);
  assert.equal(storage.mutations.some((action) => action.kind === "remove"), false);
});

test("a changed archive observed before writing cannot be replaced with a stale archive", () => {
  const raw = "{source pending";
  const storage = damaged(raw);
  const oldArchive = archive([entry("old")]);
  const newArchive = archive([entry("new")]);
  storage.setItem(archiveKey, oldArchive);
  storage.mutations.length = 0;
  const get = storage.getItem.bind(storage);
  let archiveReads = 0;
  storage.getItem = (key) => {
    if (key === archiveKey && ++archiveReads === 2) storage.items.set(archiveKey, newArchive);
    return get(key);
  };
  assert.throws(() => archiveDamagedPendingBackup(storage, pendingKey, archiveKey, raw), /dados mudaram/);
  assert.equal(get(pendingKey), raw);
  assert.equal(get(archiveKey), newArchive);
  assert.deepEqual(storage.mutations, []);
});

test("archive retention keeps at most eight newest entries and bounds total encoded bytes", () => {
  const raw = "{newest";
  const storage = damaged(raw);
  storage.setItem(archiveKey, archive(Array.from({ length: 8 }, (_, index) => entry(`old-${index}`))));
  const result = archiveDamagedPendingBackup(storage, pendingKey, archiveKey, raw);
  const entries = JSON.parse(storage.getItem(archiveKey)).entries;
  assert.equal(result.entries, MAX_PENDING_ARCHIVE_ENTRIES);
  assert.equal(entries.length, 8);
  assert.equal(entries[0].raw, "old-1");
  assert.equal(entries[7].raw, raw);
  const largeRaw = "x".repeat(550_000);
  const large = damaged(largeRaw);
  large.setItem(archiveKey, archive(Array.from({ length: 7 }, (_, index) => entry(`old-${index}` + "x".repeat(500_000)))));
  archiveDamagedPendingBackup(large, pendingKey, archiveKey, largeRaw);
  const serialized = large.getItem(archiveKey);
  const largeEntries = JSON.parse(serialized).entries;
  assert.ok(new TextEncoder().encode(serialized).byteLength <= MAX_PENDING_ARCHIVE_BYTES);
  assert.ok(largeEntries.length <= MAX_PENDING_ARCHIVE_ENTRIES);
  assert.equal(largeEntries.at(-1).raw, largeRaw);
  assert.equal(large.getItem(pendingKey), null);
});

test("valid, unavailable and changed sources cannot be silently discarded", () => {
  const validRaw = JSON.stringify(pending());
  const valid = damaged(validRaw);
  assert.throws(() => archiveDamagedPendingBackup(valid, pendingKey, archiveKey, validRaw), /backup mudou/);
  assert.equal(valid.getItem(pendingKey), validRaw);
  assert.deepEqual(valid.mutations, []);
  const changed = damaged("{new");
  assert.throws(() => archiveDamagedPendingBackup(changed, pendingKey, archiveKey, "{old"), /backup mudou/);
  assert.equal(changed.getItem(pendingKey), "{new");
  assert.deepEqual(changed.mutations, []);
  const blocked = { getItem() { throw new DOMException("blocked", "SecurityError"); }, setItem() { assert.fail("write blocked storage"); }, removeItem() { assert.fail("remove blocked source"); } };
  assert.throws(() => archiveDamagedPendingBackup(blocked, pendingKey, archiveKey, "{old"), /não está disponível/);
});

test("failed removal keeps the verified archive and reports that the pending record remains", () => {
  const raw = "{recoverable";
  const storage = damaged(raw);
  storage.removeItem = () => { throw new DOMException("blocked", "SecurityError"); };
  assert.throws(() => archiveDamagedPendingBackup(storage, pendingKey, archiveKey, raw), /arquivado.*não pôde ser liberada/);
  assert.equal(storage.getItem(pendingKey), raw);
  assert.equal(JSON.parse(storage.getItem(archiveKey)).entries[0].raw, raw);
});
