import assert from "node:assert/strict";
import test from "node:test";
import { localApiFetch } from "../app/lib/github-local-api.mjs";

class Storage {
  #items = new Map();
  get length() { return this.#items.size; }
  key(index) { return [...this.#items.keys()][index] ?? null; }
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
}

async function request(path, method = "GET", body) {
  const response = await localApiFetch(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

function profile(username, password) {
  return { displayName: `${username} Silva`, username, branch: "Araraquara", password };
}

test("admin setup and CRUD preserve existing users and isolate local account data", async () => {
  const previousLocal = globalThis.localStorage;
  const previousSession = globalThis.sessionStorage;
  const local = new Storage();
  const employeeTab = new Storage();
  const adminTab = new Storage();
  globalThis.localStorage = local;
  globalThis.sessionStorage = employeeTab;
  try {
    const alice = await request("/api/auth/register", "POST", profile("alice", "alice-password-1"));
    assert.equal(alice.status, 201);
    const aliceId = alice.data.user.id;
    const state = { sales: ["item-a"], metrics: { quotes: 2, closed: 1 }, training: { rounds: 1, scoreHistory: [8] } };
    assert.equal((await request("/api/data", "PUT", { state, baseRevision: null })).status, 200);
    local.setItem(`mult-portas-guia-user-${aliceId}-resume-v1`, JSON.stringify({ section: "catalog" }));
    local.setItem(`mult-portas-guia-learning-v1-user-${aliceId}-brand-brimak`, "progress-a");
    assert.deepEqual((await request("/api/auth/admin/status")).data, { configured: false });
    assert.equal((await request("/api/admin/users")).status, 401);
    assert.equal((await request("/api/auth/admin/setup", "POST", { password: "short" })).status, 400);

    globalThis.sessionStorage = adminTab;
    assert.equal((await request("/api/auth/admin/setup", "POST", { password: "unique-admin-password-1" })).status, 201);
    assert.deepEqual((await request("/api/auth/admin/status")).data, { configured: true });
    assert.deepEqual((await request("/api/auth/me")).data, { user: null, admin: true });
    assert.equal((await request("/api/auth/admin/setup", "POST", { password: "another-admin-password" })).status, 409);
    const adminStorage = local.getItem("mult-portas-pages-admin-v1");
    assert.ok(adminStorage.includes('"salt"'));
    assert.ok(adminStorage.includes('"hash"'));
    assert.ok(!adminStorage.includes("unique-admin-password-1"));

    const list = await request("/api/admin/users");
    assert.equal(list.status, 200);
    assert.equal(list.data.users.length, 1);
    assert.equal(list.data.users[0].id, aliceId);
    assert.equal(list.data.users[0].summary.quotes, 2);
    assert.equal(list.data.users[0].dataUpdatedAt !== null, true);
    const details = await request(`/api/admin/users/${aliceId}`);
    assert.equal(details.status, 200);
    assert.equal(details.data.state.metrics.quotes, 2);
    assert.equal(details.data.summary.learningIndex > 0, true);

    assert.equal((await request("/api/admin/users", "POST", profile("ALICE", "other-password"))).status, 409);
    assert.equal((await request("/api/admin/users", "POST", profile("admin", "other-password"))).status, 400);
    const bob = await request("/api/admin/users", "POST", profile("bob", "bob-password-1"));
    assert.equal(bob.status, 201);
    const bobId = bob.data.user.id;
    assert.notEqual(bobId, aliceId);
    const update = await request(`/api/admin/users/${bobId}`, "PATCH", {
      ...profile("bob.new", "new-bob-password-1"), branch: "São Carlos",
    });
    assert.equal(update.status, 200);
    assert.equal(update.data.user.id, bobId);
    assert.equal(update.data.user.username, "bob.new");
    assert.equal((await request(`/api/admin/users/${bobId}`, "PATCH", profile("alice", ""))).status, 409);
    assert.equal((await request(`/api/admin/users/${bobId}`)).data.user.username, "bob.new");

    local.setItem(`mult-portas-guia-user-${bobId}-resume-v1`, "progress-b");
    local.setItem(`mult-portas-guia-learning-v1-user-${bobId}-brand-brimak`, "progress-b");
    local.setItem(`mult-portas-guia-study-sheet-v1-user-${bobId}-brand-brimak`, "notes-b");
    local.setItem(`mult-portas-guia-catalog-view-v1-user-${bobId}-brand-brimak`, "fiches");
    local.setItem(`mult-portas-guia-user-${bobId}9-resume-v1`, "other-account");
    const removed = await request(`/api/admin/users/${bobId}`, "DELETE");
    assert.equal(removed.status, 200);
    assert.equal(local.getItem(`mult-portas-guia-user-${bobId}-resume-v1`), null);
    assert.equal(local.getItem(`mult-portas-guia-learning-v1-user-${bobId}-brand-brimak`), null);
    assert.equal(local.getItem(`mult-portas-guia-study-sheet-v1-user-${bobId}-brand-brimak`), null);
    assert.equal(local.getItem(`mult-portas-guia-catalog-view-v1-user-${bobId}-brand-brimak`), null);
    assert.equal(local.getItem(`mult-portas-guia-user-${bobId}9-resume-v1`), "other-account");
    assert.ok(local.getItem(`mult-portas-guia-user-${aliceId}-resume-v1`));
    assert.ok(local.getItem(`mult-portas-pages-state-v1-${aliceId}`));
    assert.equal((await request("/api/admin/users")).data.users.length, 1);

    assert.equal((await request("/api/auth/logout", "POST")).status, 200);
    assert.equal((await request("/api/admin/users")).status, 401);
    assert.equal((await request("/api/auth/login", "POST", { username: "admin", password: "wrong-password" })).status, 401);
    assert.equal((await request("/api/auth/login", "POST", { username: "ADMIN", password: "unique-admin-password-1" })).status, 200);
    assert.deepEqual((await request("/api/auth/me")).data, { user: null, admin: true });
    assert.equal((await request("/api/admin/users")).status, 200);

    globalThis.sessionStorage = employeeTab;
    assert.deepEqual((await request("/api/auth/me")).data.user.id, aliceId);
    assert.deepEqual((await request("/api/data")).data.state, state);
  } finally {
    if (previousLocal === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocal;
    if (previousSession === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousSession;
  }
});

test("damaged or existing admin record cannot be replaced through setup", async () => {
  const previousLocal = globalThis.localStorage;
  const previousSession = globalThis.sessionStorage;
  const local = new Storage();
  globalThis.localStorage = local;
  globalThis.sessionStorage = new Storage();
  try {
    for (const damaged of ["{broken", "null", "{}", '"admin"']) {
      local.setItem("mult-portas-pages-admin-v1", damaged);
      assert.equal((await request("/api/auth/admin/status")).status, 503);
      assert.equal((await request("/api/auth/admin/setup", "POST", { password: "new-password-123" })).status, 503);
      assert.equal(local.getItem("mult-portas-pages-admin-v1"), damaged);
    }
  } finally {
    if (previousLocal === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocal;
    if (previousSession === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousSession;
  }
});
