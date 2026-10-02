import assert from "node:assert/strict";
import test from "node:test";
import { localApiFetch } from "../app/lib/github-local-api.mjs";

class Storage {
  #items = new Map();
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
}

async function call(path, method = "GET", body, signal) {
  const response = await localApiFetch(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  return { status: response.status, data: await response.json() };
}

test("GitHub Pages account and data API stays local, hashed and account-scoped", async () => {
  const previousLocal = globalThis.localStorage;
  const previousSession = globalThis.sessionStorage;
  globalThis.localStorage = new Storage();
  globalThis.sessionStorage = new Storage();
  try {
    assert.deepEqual((await call("/api/auth/me")).data, { user: null, admin: false });
    const alice = await call("/api/auth/register", "POST", {
      displayName: "Alice Silva", username: "Alice", branch: "Araraquara", password: "long-password-1",
    });
    assert.equal(alice.status, 201);
    assert.equal(alice.data.user.username, "Alice");
    assert.equal(typeof alice.data.user.id, "number");
    assert.deepEqual((await call("/api/auth/me")).data.user, alice.data.user);
    const accountStorage = globalThis.localStorage.getItem("mult-portas-pages-accounts-v1");
    assert.ok(accountStorage.includes('"salt"'));
    assert.ok(accountStorage.includes('"hash"'));
    assert.ok(!accountStorage.includes("long-password-1"));
    assert.equal((await call("/api/auth/register", "POST", {
      displayName: "Outro", username: "aLIce", branch: "São Carlos", password: "long-password-2",
    })).status, 409);
    assert.deepEqual((await call("/api/data")).data, { state: null, revision: null });

    const first = await call("/api/data", "PUT", { state: { sales: ["item-a"] }, baseRevision: null });
    assert.equal(first.status, 200);
    assert.ok(first.data.revision.includes("|"));
    const saved = await call("/api/data");
    assert.deepEqual(saved.data.state, { sales: ["item-a"] });
    const repeated = await call("/api/data", "PUT", { state: { sales: ["item-a"] }, baseRevision: null });
    assert.equal(repeated.data.revision, first.data.revision);
    const conflict = await call("/api/data", "PUT", { state: { sales: ["item-b"] }, baseRevision: null });
    assert.equal(conflict.status, 409);
    const second = await call("/api/data", "PUT", { state: { sales: ["item-b"] }, baseRevision: first.data.revision });
    assert.equal(second.status, 200);

    assert.equal((await call("/api/auth/logout", "POST")).data.ok, true);
    assert.equal((await call("/api/data")).status, 401);
    assert.equal((await call("/api/auth/login", "POST", { username: "alice", password: "invalid" })).status, 401);
    const bob = await call("/api/auth/register", "POST", {
      displayName: "Bob Costa", username: "bob", branch: "São Carlos", password: "long-password-2",
    });
    assert.equal(bob.status, 201);
    assert.notEqual(bob.data.user.id, alice.data.user.id);
    assert.deepEqual((await call("/api/data")).data, { state: null, revision: null });
    await call("/api/auth/logout", "POST");
    assert.equal((await call("/api/auth/login", "POST", { username: "ALICE", password: "long-password-1" })).status, 200);
    assert.deepEqual((await call("/api/data")).data.state, { sales: ["item-b"] });
    const profile = await call("/api/auth/profile", "PATCH", {
      displayName: "Alice Souza", username: "alice.new", branch: "São Carlos",
      currentPassword: "long-password-1", newPassword: "new-password-3",
    });
    assert.equal(profile.status, 200);
    assert.equal(profile.data.user.username, "alice.new");
    assert.equal((await call("/api/auth/login", "POST", { username: "alice", password: "long-password-1" })).status, 401);
    assert.deepEqual((await call("/api/data")).data.state, { sales: ["item-b"] });
    assert.equal((await call("/api/admin/users")).status, 501);
    assert.deepEqual((await call("/api/auth/me")).data.admin, false);
  } finally {
    if (previousLocal === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocal;
    if (previousSession === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousSession;
  }
});

test("aborted local requests do not write to storage", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(localApiFetch("/api/auth/me", { signal: controller.signal }), { name: "AbortError" });
});
