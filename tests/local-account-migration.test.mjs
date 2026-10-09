import assert from "node:assert/strict";
import test from "node:test";
import { importLocalAccounts, migrateLegacyEmployeeLogin, recoverLegacyEmployeeData } from "../app/lib/local-account-migration.mjs";

class Storage {
  items = new Map();
  getItem(key) { return this.items.get(key) ?? null; }
  setItem(key, value) { this.items.set(key, String(value)); }
  removeItem(key) { this.items.delete(key); }
}

const ACCOUNTS_KEY = "mult-portas-pages-accounts-v1";
const DEVICE_KEY = "mult-portas-local-import-device-v1";
const reply = (value, status = 200) => Response.json(value, { status });
const encode = (value) => btoa(String.fromCharCode(...value));
async function legacy(username = "legacy.user", id = 71) {
  const secret = crypto.randomUUID();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
  const hash = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", iterations: 210_000, salt }, key, 256));
  return { secret, account: { id, username, usernameNormalized: username.toLocaleLowerCase("pt-BR"), displayName: "Vendedor Exemplo", branch: "Araraquara", password: { salt: encode(salt), hash: encode(hash), iterations: 210_000 }, sessionVersion: crypto.randomUUID() } };
}
function saved(storage, entries) {
  storage.setItem(ACCOUNTS_KEY, JSON.stringify(entries.map((entry) => entry.account)));
  storage.setItem("mult-portas-pages-session-v1", JSON.stringify({ id: entries[0]?.account.id, version: entries[0]?.account.sessionVersion }));
  storage.setItem("mult-portas-pages-admin-v1", "preserved configuration");
  storage.setItem("mult-portas-pages-admin-session-v1", "preserved old session");
}
function state(storage, id, value = { followups: [{ id: "quote", client: "Cliente", next: "Confirmar medidas", amountCents: 234567 }], marketingDaily: { days: [{ date: "2026-10-09", seller: "Vendedor Exemplo", phone: 7 }] } }) {
  storage.setItem(`mult-portas-pages-state-v1-${id}`, JSON.stringify({ state: value, revision: "2026-10-09T12:00:00.000Z|source" }));
}
function original(storage) { return new Map(storage.items); }
function unchanged(storage, before) {
  for (const [key, raw] of before) assert.equal(storage.getItem(key), raw, `changed original key: ${key}`);
}
function user(account, id) { return { id, username: account.username, displayName: account.displayName, branch: account.branch }; }
function credentials(entry) { return { username: entry.account.username, password: entry.secret }; }
const role = () => reply({ user: null, admin: true });
function successfulImport(body, id = 1, status = "imported") {
  const entry = body.records[0];
  return reply({ results: [{ sourceId: entry.sourceId, username: entry.username, status, ...(status === "conflict" ? {} : { userId: id }) }], imported: status === "imported" ? 1 : 0, conflicts: status === "conflict" ? 1 : 0 });
}

test("privileged import verifies the remote role before reading any local account", async () => {
  for (const response of [reply({ user: { id: 1 }, admin: false }), reply({ user: null, admin: false }, 401), reply({ error: "unavailable" }, 503)]) {
    let reads = 0;
    const storage = { getItem() { reads++; throw new Error("must not read"); }, setItem() { throw new Error("must not write"); } };
    const calls = [];
    const result = await importLocalAccounts(async (path) => { calls.push(path); return response; }, storage);
    assert.deepEqual(calls, ["/api/auth/me"]);
    assert.equal(reads, 0);
    assert.equal(result.imported, 0);
    assert.ok(result.error);
  }
});

test("bulk import sends one bounded canonical record at a time and applies only acknowledged identity mappings", async () => {
  const first = await legacy("first.local", 1);
  const second = await legacy("second.local", 2);
  const storage = new Storage();
  saved(storage, [first, second]);
  state(storage, 1);
  state(storage, 2);
  storage.setItem("mult-portas-guia-user-1-resume-v1", JSON.stringify({ section: "marketing" }));
  storage.setItem("mult-portas-guia-learning-v1-user-2-brand-brimak", JSON.stringify({ stage: "quality", answers: { brand: 1 } }));
  storage.setItem("mult-portas-shared-learning-v1-user-2-brand-brimak", "damaged destination retained");
  storage.setItem("mult-portas-guia-user-1-pending-state-v1", JSON.stringify({ state: { followups: [{ id: "newer", client: "Atualizado", next: "Retornar", amountCents: 88888 }] }, baseRevision: "old", updatedAt: "2026-10-09T13:00:00.000Z" }));
  const before = original(storage);
  const sent = [];
  const notifications = [];
  const result = await importLocalAccounts(async (path, init) => {
    if (path === "/api/auth/me") return role();
    assert.equal(path, "/api/admin/import-local");
    const body = JSON.parse(init.body);
    sent.push(body);
    assert.equal(body.records.length, 1);
    const entry = body.records[0];
    assert.match(entry.sourceId, /^[a-f0-9-]{36}:\d+$/);
    assert.equal(body.batchId, entry.sourceId);
    assert.deepEqual(Object.keys(entry.password).sort(), ["hash", "iterations", "salt", "version"]);
    assert.equal(entry.password.iterations, 210_000);
    assert.equal(atob(entry.password.salt).length, 16);
    assert.equal(atob(entry.password.hash).length, 32);
    assert.equal(JSON.stringify(body).includes(first.secret), false);
    assert.equal(JSON.stringify(body).includes(second.secret), false);
    return successfulImport(body, sent.length === 1 ? 91 : 2);
  }, storage, (progress) => notifications.push(progress));
  assert.equal(result.imported, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.remaining, 0);
  assert.equal(result.mappings[0].oldId, 1);
  assert.equal(result.mappings[0].userId, 91);
  assert.equal(sent[0].records[0].state.followups[0].id, "newer");
  assert.equal(sent[1].records[0].state.marketingDaily.days[0].phone, 7);
  assert.equal(storage.getItem("mult-portas-shared-user-91-resume-v1"), storage.getItem("mult-portas-guia-user-1-resume-v1"));
  assert.equal(storage.getItem("mult-portas-shared-user-1-resume-v1"), null);
  assert.equal(storage.getItem("mult-portas-shared-learning-v1-user-2-brand-brimak"), "damaged destination retained");
  assert.equal(notifications.length, 2);
  unchanged(storage, before);
});

test("damaged, oversized and ambiguous records are reported by username without uploading or erasing them", async () => {
  const entries = await Promise.all([legacy("bad.state", 3), legacy("bad.progress", 4), legacy("truncated.state", 5), legacy("bad.proof", 6)]);
  entries[3].account.password.hash = "invalid";
  const storage = new Storage();
  saved(storage, entries);
  storage.setItem("mult-portas-pages-state-v1-3", "{broken");
  storage.setItem("mult-portas-guia-learning-v1-user-4-brand-brimak", "{broken");
  state(storage, 5, { sales: Array.from({ length: 121 }, (_, index) => `step-${index}`) });
  const before = original(storage);
  const calls = [];
  const result = await importLocalAccounts(async (path) => { calls.push(path); return role(); }, storage);
  assert.deepEqual(calls, ["/api/auth/me"]);
  assert.equal(result.skipped, 4);
  assert.deepEqual(result.results.map((entry) => entry.username), entries.map((entry) => entry.account.username));
  assert.equal(result.imported, 0);
  unchanged(storage, before);
});

test("the device and per-record batch identifiers are stable across safe retries", async () => {
  const entry = await legacy();
  const storage = new Storage();
  saved(storage, [entry]);
  state(storage, entry.account.id);
  const requests = [];
  let round = 0;
  const request = async (path, init) => {
    if (path === "/api/auth/me") return role();
    const body = JSON.parse(init.body);
    requests.push(body);
    return successfulImport(body, 83, round === 0 ? "imported" : "already-imported");
  };
  const first = await importLocalAccounts(request, storage);
  round++;
  const before = original(storage);
  const second = await importLocalAccounts(request, storage);
  assert.deepEqual(requests[0], requests[1]);
  assert.ok(storage.getItem(DEVICE_KEY));
  assert.equal(first.imported, 1);
  assert.equal(second.alreadyImported, 1);
  assert.equal(second.mappings[0].userId, 83);
  unchanged(storage, before);
});

test("an import failure stops subsequent uploads and keeps all existing data intact", async () => {
  const entries = await Promise.all([legacy("first.entry", 31), legacy("second.entry", 32)]);
  const storage = new Storage();
  saved(storage, entries);
  state(storage, 31);
  state(storage, 32);
  const before = original(storage);
  const sent = [];
  const result = await importLocalAccounts(async (path, init) => {
    if (path === "/api/auth/me") return role();
    sent.push(JSON.parse(init.body));
    return reply({ error: "session expired" }, 403);
  }, storage);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].records[0].username, "first.entry");
  assert.equal(result.failed, 1);
  assert.equal(result.remaining, 1);
  assert.equal(result.imported, 0);
  unchanged(storage, before);
});

test("conflicts and malformed server identity mappings never copy progress into another account", async () => {
  const entry = await legacy();
  for (const outcome of ["conflict", "wrong-source", "wrong-user", "bad-id"]) {
    const storage = new Storage();
    saved(storage, [entry]);
    storage.setItem(`mult-portas-guia-user-${entry.account.id}-resume-v1`, JSON.stringify({ section: "catalog" }));
    const before = original(storage);
    const result = await importLocalAccounts(async (path, init) => {
      if (path === "/api/auth/me") return role();
      const body = JSON.parse(init.body);
      const source = body.records[0];
      return reply({ results: [{ sourceId: outcome === "wrong-source" ? "other" : source.sourceId, username: outcome === "wrong-user" ? "another.user" : source.username, status: outcome === "conflict" ? "conflict" : "imported", userId: outcome === "bad-id" ? -1 : 12 }] });
    }, storage);
    assert.equal(result.imported, 0);
    assert.equal(storage.getItem("mult-portas-shared-user-12-resume-v1"), null);
    assert.equal(outcome === "conflict" ? result.conflicts : result.failed, 1);
    unchanged(storage, before);
  }
});

test("own-account migration never registers unknown, reserved or incorrectly authenticated local accounts", async () => {
  const entry = await legacy();
  const storage = new Storage();
  saved(storage, [entry]);
  const before = original(storage);
  let sent = 0;
  const request = async () => { sent++; throw new Error("must not register"); };
  for (const input of [{ username: "missing.user", password: crypto.randomUUID() }, { username: entry.account.username, password: crypto.randomUUID() }, { username: "admin", password: crypto.randomUUID() }]) {
    assert.equal(await migrateLegacyEmployeeLogin(request, input, storage), null);
  }
  assert.equal(sent, 0);
  unchanged(storage, before);
});

test("valid local login queues the exact authorized account before saving and reports success only after server acknowledgement", async () => {
  const entry = await legacy("CASE.USER", 2);
  const storage = new Storage();
  saved(storage, [entry]);
  state(storage, 2);
  storage.setItem("mult-portas-guia-user-2-resume-v1", JSON.stringify({ section: "marketing", trainingInput: "Retomar a conversa" }));
  storage.setItem("mult-portas-guia-learning-v1-user-2-brand-brimak", JSON.stringify({ stage: "measures", answers: { brand: 1 } }));
  storage.setItem("mult-portas-shared-learning-v1-user-2-brand-brimak", JSON.stringify({ stage: "practice" }));
  const before = original(storage);
  const paths = [];
  const response = await migrateLegacyEmployeeLogin(async (path, init) => {
    paths.push(path);
    if (path === "/api/auth/register") {
      const body = JSON.parse(init.body);
      assert.equal(body.password, entry.secret);
      assert.deepEqual(Object.keys(body).sort(), ["branch", "displayName", "password", "username"]);
      return reply({ user: user(entry.account, 2), token: crypto.randomUUID() }, 201);
    }
    assert.equal(path, "/api/data");
    const pending = JSON.parse(storage.getItem("mult-portas-shared-user-2-pending-state-v1"));
    const body = JSON.parse(init.body);
    assert.equal(pending.baseRevision, null);
    assert.deepEqual(body.state, pending.state);
    assert.deepEqual(body.clientState, pending.clientState);
    assert.equal(body.state.followups[0].amountCents, 234567);
    assert.equal(body.clientState.resume.section, "marketing");
    return reply({ ok: true, revision: "shared-saved" });
  }, { username: "case.user", password: entry.secret }, storage);
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.migrationStatus, "synced");
  assert.equal(payload.migrationPending, false);
  assert.equal(payload.token, undefined);
  assert.equal(payload.password, undefined);
  assert.deepEqual(paths, ["/api/auth/register", "/api/data"]);
  assert.equal(storage.getItem("mult-portas-shared-user-2-pending-state-v1"), null);
  assert.equal(storage.getItem("mult-portas-shared-user-2-resume-v1"), storage.getItem("mult-portas-guia-user-2-resume-v1"));
  assert.equal(storage.getItem("mult-portas-shared-learning-v1-user-2-brand-brimak"), before.get("mult-portas-shared-learning-v1-user-2-brand-brimak"));
  unchanged(storage, before);
});

test("a registration race or existing shared username cannot overwrite the central account or local work", async () => {
  const entry = await legacy();
  const storage = new Storage();
  saved(storage, [entry]);
  state(storage, entry.account.id);
  storage.setItem(`mult-portas-guia-user-${entry.account.id}-resume-v1`, JSON.stringify({ section: "control" }));
  const before = original(storage);
  const paths = [];
  const response = await migrateLegacyEmployeeLogin(async (path) => { paths.push(path); return reply({ error: "duplicate" }, 409); }, credentials(entry), storage);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).migrationConflict, true);
  assert.deepEqual(paths, ["/api/auth/register"]);
  assert.equal([...storage.items.keys()].some((key) => key.startsWith("mult-portas-shared")), false);
  unchanged(storage, before);
});

test("failed or malformed initial saves retain a recoverable shared queue and never claim data was synchronized", async () => {
  const entry = await legacy();
  for (const failure of ["network", "server", "ack"]) {
    const storage = new Storage();
    saved(storage, [entry]);
    state(storage, entry.account.id);
    storage.setItem(`mult-portas-guia-user-${entry.account.id}-resume-v1`, JSON.stringify({ section: "catalog" }));
    const before = original(storage);
    const response = await migrateLegacyEmployeeLogin(async (path) => {
      if (path === "/api/auth/register") return reply({ user: user(entry.account, 88) }, 201);
      if (failure === "network") throw new TypeError("network unavailable");
      return failure === "server" ? reply({ error: "unavailable" }, 503) : reply({ ok: true });
    }, credentials(entry), storage);
    const payload = await response.json();
    assert.equal(payload.migrationPending, true);
    assert.equal(payload.migrationStatus, "pending");
    assert.ok(payload.migrationWarning);
    const queued = JSON.parse(storage.getItem("mult-portas-shared-user-88-pending-state-v1"));
    assert.equal(queued.baseRevision, null);
    assert.equal(queued.state.followups[0].amountCents, 234567);
    assert.equal(queued.clientState.resume.section, "catalog");
    assert.ok(Number.isFinite(Date.parse(queued.updatedAt)));
    unchanged(storage, before);
  }
});

test("unexpected registration identities cannot create a shared backup or trigger a data upload", async () => {
  const entry = await legacy();
  for (const returned of [user({ ...entry.account, username: "different.user" }, 5), user(entry.account, -1), { ...user(entry.account, 5), branch: "other" }]) {
    const storage = new Storage();
    saved(storage, [entry]);
    state(storage, entry.account.id);
    const before = original(storage);
    const paths = [];
    const response = await migrateLegacyEmployeeLogin(async (path) => { paths.push(path); return reply({ user: returned }, 201); }, credentials(entry), storage);
    assert.equal(response.status, 502);
    assert.deepEqual(paths, ["/api/auth/register"]);
    assert.equal([...storage.items.keys()].some((key) => key.startsWith("mult-portas-shared")), false);
    unchanged(storage, before);
  }
});

test("damaged local business data blocks own-account registration until it can be recovered", async () => {
  const entry = await legacy();
  const storage = new Storage();
  saved(storage, [entry]);
  storage.setItem(`mult-portas-pages-state-v1-${entry.account.id}`, "{truncated");
  const before = original(storage);
  let sent = false;
  const response = await migrateLegacyEmployeeLogin(async () => { sent = true; }, credentials(entry), storage);
  assert.equal(response.status, 503);
  assert.equal(sent, false);
  unchanged(storage, before);
});

test("an existing destination queue survives registration and prevents an automatic initial overwrite", async () => {
  const entry = await legacy();
  const storage = new Storage();
  saved(storage, [entry]);
  state(storage, entry.account.id);
  storage.setItem("mult-portas-shared-user-29-pending-state-v1", "existing recoverable destination");
  const before = original(storage);
  const paths = [];
  const response = await migrateLegacyEmployeeLogin(async (path) => { paths.push(path); return reply({ user: user(entry.account, 29) }, 201); }, credentials(entry), storage);
  assert.equal((await response.json()).migrationPending, true);
  assert.deepEqual(paths, ["/api/auth/register"]);
  unchanged(storage, before);
});

test("cancellation prevents further uploads and never changes legacy credentials or sessions", async () => {
  const entry = await legacy();
  const storage = new Storage();
  saved(storage, [entry]);
  state(storage, entry.account.id);
  const before = original(storage);
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  const request = async () => { requests++; return role(); };
  await assert.rejects(importLocalAccounts(request, storage, undefined, { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(migrateLegacyEmployeeLogin(request, credentials(entry), storage, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(requests, 0);
  const afterRegister = new AbortController();
  await assert.rejects(migrateLegacyEmployeeLogin(async (path, init) => {
    assert.equal(path, "/api/auth/register");
    assert.equal(init.signal, afterRegister.signal);
    afterRegister.abort();
    return reply({ user: user(entry.account, 95) }, 201);
  }, credentials(entry), storage, { signal: afterRegister.signal }), { name: "AbortError" });
  assert.equal(storage.getItem("mult-portas-shared-user-95-pending-state-v1"), null);
  unchanged(storage, before);
});

const recoveryCredentials = (entry, id = 121) => ({ ...credentials(entry), user: user(entry.account, id) });
const emptyRemote = () => ({ state: null, revision: null, clientState: { schemaVersion: 1 } });

test("successful login recovers legacy work after a lost registration response without creating a second account", async () => {
  const entry = await legacy();
  const storage = new Storage();
  saved(storage, [entry]);
  state(storage, entry.account.id);
  storage.setItem(`mult-portas-guia-user-${entry.account.id}-resume-v1`, JSON.stringify({ section: "marketing" }));
  const before = original(storage);
  const paths = [];
  const result = await recoverLegacyEmployeeData(async (path, init) => {
    paths.push([path, init.method]);
    if (path === "/api/auth/me") return reply({ user: user(entry.account, 121), admin: false });
    if (init.method === "GET") return reply(emptyRemote());
    const body = JSON.parse(init.body);
    assert.equal(body.baseRevision, null);
    assert.equal(body.state.followups[0].amountCents, 234567);
    assert.equal(body.clientState.resume.section, "marketing");
    assert.deepEqual(JSON.parse(storage.getItem("mult-portas-shared-user-121-pending-state-v1")).state, body.state);
    return reply({ ok: true, revision: "recovered-initial-state" });
  }, recoveryCredentials(entry), storage, { isCurrent: () => true });
  assert.deepEqual(result, { status: "synced", localUserId: entry.account.id, revision: "recovered-initial-state" });
  assert.deepEqual(paths, [["/api/auth/me", "GET"], ["/api/data", "GET"], ["/api/data", "PUT"]]);
  assert.equal(storage.getItem("mult-portas-shared-user-121-pending-state-v1"), null);
  assert.equal(storage.getItem("mult-portas-shared-user-121-resume-v1"), storage.getItem(`mult-portas-guia-user-${entry.account.id}-resume-v1`));
  unchanged(storage, before);
});

test("recovery verifies the exact legacy password before reading work or using the authenticated API", async () => {
  const entry = await legacy();
  const storage = new Storage();
  saved(storage, [entry]);
  state(storage, entry.account.id);
  const before = original(storage);
  let readsOfWork = 0;
  let requests = 0;
  const guardedStorage = {
    getItem(key) {
      if (key.startsWith("mult-portas-pages-state-v1-") || key.endsWith("resume-v1")) readsOfWork++;
      return storage.getItem(key);
    },
    setItem: (key, value) => storage.setItem(key, value),
  };
  const request = async () => { requests++; throw new Error("must not send"); };
  assert.equal(await recoverLegacyEmployeeData(request, { ...recoveryCredentials(entry), password: crypto.randomUUID() }, guardedStorage), null);
  assert.equal(await recoverLegacyEmployeeData(request, { ...recoveryCredentials(entry), user: user({ ...entry.account, username: "another.employee" }, 121) }, guardedStorage), null);
  assert.equal(readsOfWork, 0);
  assert.equal(requests, 0);
  unchanged(storage, before);
});

test("any remote business state, revision or noncanonical empty progress prevents automatic restoration", async () => {
  const entry = await legacy();
  for (const remote of [
    { ...emptyRemote(), state: {} },
    { ...emptyRemote(), state: { metrics: { quotes: 19 } } },
    { ...emptyRemote(), revision: "remote-work-version" },
    { ...emptyRemote(), clientState: { schemaVersion: 1, resume: { section: "catalog" } } },
    { ...emptyRemote(), clientState: { schemaVersion: 1, brands: {} } },
    { ...emptyRemote(), clientState: { schemaVersion: 1, resume: {} } },
  ]) {
    const storage = new Storage();
    saved(storage, [entry]);
    storage.setItem(`mult-portas-pages-state-v1-${entry.account.id}`, "unreadable original that must not be inspected");
    const before = original(storage);
    const paths = [];
    const result = await recoverLegacyEmployeeData(async (path, init) => {
      paths.push([path, init.method]);
      return path === "/api/auth/me" ? reply({ user: user(entry.account, 121), admin: false }) : reply(remote);
    }, recoveryCredentials(entry), storage);
    assert.equal(result.status, "skipped");
    assert.deepEqual(paths, [["/api/auth/me", "GET"], ["/api/data", "GET"]]);
    assert.equal(storage.getItem("mult-portas-shared-user-121-pending-state-v1"), null);
    unchanged(storage, before);
  }
});

test("quota-limited migration can upload originals directly and retry after an unacknowledged attempt", async () => {
  const entry = await legacy();
  const storage = new Storage();
  saved(storage, [entry]);
  state(storage, entry.account.id);
  const before = original(storage);
  const fullStorage = {
    getItem: (key) => storage.getItem(key),
    setItem() { throw new DOMException("full", "QuotaExceededError"); },
    removeItem: (key) => storage.removeItem(key),
  };
  let fail = true;
  let initialPuts = 0;
  const request = async (path, init) => {
    if (path === "/api/auth/me") return reply({ user: user(entry.account, 121), admin: false });
    if (init.method === "GET") return reply(emptyRemote());
    initialPuts++;
    assert.equal(JSON.parse(init.body).state.followups[0].amountCents, 234567);
    assert.equal(JSON.parse(init.body).baseRevision, null);
    assert.equal(storage.getItem("mult-portas-shared-user-121-pending-state-v1"), null);
    if (fail) throw new TypeError("network interrupted");
    return reply({ ok: true, revision: "quota-retry-saved" });
  };
  const first = await recoverLegacyEmployeeData(request, recoveryCredentials(entry), fullStorage);
  assert.equal(first.status, "pending");
  assert.equal(first.blockWorkspace, true);
  assert.ok(first.warning);
  fail = false;
  const second = await recoverLegacyEmployeeData(request, recoveryCredentials(entry), fullStorage);
  assert.deepEqual(second, { status: "synced", localUserId: entry.account.id, revision: "quota-retry-saved" });
  assert.equal(initialPuts, 2);
  unchanged(storage, before);
});

test("valid existing shared queues are preserved for hydration instead of overwritten by legacy recovery", async () => {
  const entry = await legacy();
  const storage = new Storage();
  saved(storage, [entry]);
  state(storage, entry.account.id);
  const pendingKey = "mult-portas-shared-user-121-pending-state-v1";
  const draft = { state: { metrics: { quotes: 33 } }, baseRevision: null, updatedAt: new Date().toISOString(), clientState: { schemaVersion: 1 } };
  storage.setItem(pendingKey, JSON.stringify(draft));
  const before = original(storage);
  const paths = [];
  const result = await recoverLegacyEmployeeData(async (path, init) => {
    paths.push([path, init.method]);
    return reply({ user: user(entry.account, 121), admin: false });
  }, recoveryCredentials(entry), storage);
  assert.equal(result.status, "pending");
  assert.equal(result.blockWorkspace, undefined);
  assert.deepEqual(paths, [["/api/auth/me", "GET"]]);
  assert.equal(storage.getItem(pendingKey), before.get(pendingKey));
  unchanged(storage, before);
});

test("damaged or unreadable destination queues block hydration and remain available for recovery", async () => {
  const entry = await legacy();
  for (const raw of ["{broken", "{}", JSON.stringify({ state: {}, baseRevision: null, updatedAt: "bad-date" }), JSON.stringify({ state: {}, baseRevision: null, updatedAt: new Date().toISOString(), clientState: { schemaVersion: 1, unknown: true } })]) {
    const storage = new Storage();
    saved(storage, [entry]);
    state(storage, entry.account.id);
    storage.setItem("mult-portas-shared-user-121-pending-state-v1", raw);
    const before = original(storage);
    let requests = 0;
    const result = await recoverLegacyEmployeeData(async (path) => {
      requests++;
      assert.equal(path, "/api/auth/me");
      return reply({ user: user(entry.account, 121), admin: false });
    }, recoveryCredentials(entry), storage);
    assert.equal(result.status, "blocked");
    assert.equal(result.blockWorkspace, true);
    assert.equal(requests, 1);
    unchanged(storage, before);
  }
  const storage = new Storage();
  saved(storage, [entry]);
  const guarded = {
    getItem(key) { if (key === "mult-portas-shared-user-121-pending-state-v1") throw new Error("blocked"); return storage.getItem(key); },
    setItem() { throw new Error("must not write"); },
  };
  const result = await recoverLegacyEmployeeData(async () => reply({ user: user(entry.account, 121), admin: false }), recoveryCredentials(entry), guarded);
  assert.equal(result.status, "blocked");
  assert.equal(result.blockWorkspace, true);
});

test("a null-revision conflict preserves both server work and a recoverable legacy draft", async () => {
  const entry = await legacy();
  const storage = new Storage();
  saved(storage, [entry]);
  state(storage, entry.account.id);
  const before = original(storage);
  const result = await recoverLegacyEmployeeData(async (path, init) => {
    if (path === "/api/auth/me") return reply({ user: user(entry.account, 121), admin: false });
    if (init.method === "GET") return reply(emptyRemote());
    assert.equal(JSON.parse(init.body).baseRevision, null);
    return reply({ error: "Workspace changed on another device.", revision: "other-device-version" }, 409);
  }, recoveryCredentials(entry), storage);
  assert.equal(result.status, "conflict");
  assert.equal(result.blockWorkspace, undefined);
  assert.equal(JSON.parse(storage.getItem("mult-portas-shared-user-121-pending-state-v1")).state.followups[0].amountCents, 234567);
  unchanged(storage, before);
});

test("unconfirmed initial PUTs permit hydration only when their exact shared backup remains recoverable", async () => {
  const entry = await legacy();
  for (const full of [false, true]) {
    const storage = new Storage();
    saved(storage, [entry]);
    state(storage, entry.account.id);
    const before = original(storage);
    const targetStorage = full ? { getItem: (key) => storage.getItem(key), setItem() { throw new DOMException("full", "QuotaExceededError"); } } : storage;
    const result = await recoverLegacyEmployeeData(async (path, init) => {
      if (path === "/api/auth/me") return reply({ user: user(entry.account, 121), admin: false });
      if (init.method === "GET") return reply(emptyRemote());
      return reply({ ok: true, revision: "" });
    }, recoveryCredentials(entry), targetStorage);
    assert.equal(result.status, "pending");
    assert.equal(result.blockWorkspace, full ? true : undefined);
    unchanged(storage, before);
  }
});

test("wrong remote identity or malformed remote data never authorize reading and uploading old work", async () => {
  const entry = await legacy();
  for (const outcome of ["wrong-id", "wrong-username", "malformed-data"]) {
    const storage = new Storage();
    saved(storage, [entry]);
    storage.setItem(`mult-portas-pages-state-v1-${entry.account.id}`, "old work must not be read");
    const before = original(storage);
    let uploads = 0;
    const result = await recoverLegacyEmployeeData(async (path, init) => {
      if (init.method === "PUT") { uploads++; throw new Error("must not upload"); }
      if (path === "/api/auth/me") return reply({ user: user({ ...entry.account, ...(outcome === "wrong-username" ? { username: "other.employee" } : {}) }, outcome === "wrong-id" ? 122 : 121), admin: false });
      return reply({ ...emptyRemote(), revision: 5 });
    }, recoveryCredentials(entry), storage);
    assert.equal(result.status, "blocked");
    assert.equal(result.blockWorkspace, true);
    assert.equal(uploads, 0);
    unchanged(storage, before);
  }
});

test("a session switch between remote inspection and upload cancels legacy restoration", async () => {
  const entry = await legacy();
  const storage = new Storage();
  saved(storage, [entry]);
  state(storage, entry.account.id);
  const before = original(storage);
  let current = true;
  let uploads = 0;
  await assert.rejects(recoverLegacyEmployeeData(async (path, init) => {
    if (path === "/api/auth/me") return reply({ user: user(entry.account, 121), admin: false });
    if (init.method === "PUT") uploads++;
    current = false;
    return reply(emptyRemote());
  }, recoveryCredentials(entry), storage, { isCurrent: () => current }), { name: "AbortError" });
  assert.equal(uploads, 0);
  assert.equal(storage.getItem("mult-portas-shared-user-121-pending-state-v1"), null);
  unchanged(storage, before);
});
