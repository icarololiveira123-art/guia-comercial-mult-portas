import assert from "node:assert/strict";
import test from "node:test";
import { localApiFetch } from "../app/lib/github-local-api.mjs";
import { getMarketingDay, resetMarketingDay, setMarketingCount } from "../app/lib/marketing-daily.mjs";

class Storage {
  #items = new Map();
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

function registration(username, password) {
  return {
    displayName: `${username} Silva`, username, branch: "Araraquara", password,
  };
}

test("local accounts keep work isolated across tabs, logouts, reloads and profile changes", async () => {
  const previousLocal = globalThis.localStorage;
  const previousSession = globalThis.sessionStorage;
  const sharedStorage = new Storage();
  const aliceTab = new Storage();
  const bobTab = new Storage();
  globalThis.localStorage = sharedStorage;
  globalThis.sessionStorage = aliceTab;

  try {
    const alice = await request("/api/auth/register", "POST", registration("alice", "alice-password-123"));
    assert.equal(alice.status, 201);
    const aliceState = { sales: ["step-1"], followups: [{ id: "alice-quote", client: "Alice client", next: "Return", amountCents: 125050 }], training: { rounds: 2 } };
    const aliceSaved = await request("/api/data", "PUT", { state: aliceState, baseRevision: null });
    assert.equal(aliceSaved.status, 200);

    globalThis.sessionStorage = bobTab;
    assert.deepEqual((await request("/api/auth/me")).data, { user: null, admin: false });
    assert.equal((await request("/api/data")).status, 401);
    const bob = await request("/api/auth/register", "POST", registration("bob", "bob-password-456"));
    assert.equal(bob.status, 201);
    assert.notEqual(bob.data.user.id, alice.data.user.id);
    assert.deepEqual((await request("/api/data")).data, { state: null, revision: null });
    const bobState = { sales: ["step-3"], followups: [{ id: "bob-quote", client: "Bob client", next: "Return", amountCents: 98765 }], training: { rounds: 7 } };
    assert.equal((await request("/api/data", "PUT", { state: bobState, baseRevision: null })).status, 200);

    // Closing and reopening a tab keeps the same account's work in localStorage.
    globalThis.sessionStorage = aliceTab;
    assert.equal((await request("/api/auth/me")).data.user.id, alice.data.user.id);
    assert.deepEqual((await request("/api/data")).data.state, aliceState);
    assert.equal((await request("/api/auth/logout", "POST")).status, 200);
    assert.equal((await request("/api/data")).status, 401);
    assert.equal((await request("/api/auth/login", "POST", { username: "alice", password: "alice-password-123" })).status, 200);
    assert.deepEqual((await request("/api/data")).data.state, aliceState);

    const changed = await request("/api/auth/profile", "PATCH", {
      displayName: "Alice Atualizada", username: "alice.nova", branch: "São Carlos",
      currentPassword: "alice-password-123", newPassword: "alice-password-789",
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.user.id, alice.data.user.id);
    assert.deepEqual((await request("/api/data")).data.state, aliceState);
    await request("/api/auth/logout", "POST");
    assert.equal((await request("/api/auth/login", "POST", { username: "alice", password: "alice-password-123" })).status, 401);
    assert.equal((await request("/api/auth/login", "POST", { username: "alice.nova", password: "alice-password-789" })).status, 200);
    assert.deepEqual((await request("/api/data")).data.state, aliceState);

    globalThis.sessionStorage = bobTab;
    assert.equal((await request("/api/auth/me")).data.user.id, bob.data.user.id);
    assert.deepEqual((await request("/api/data")).data.state, bobState);

    globalThis.sessionStorage = aliceTab;
    let current = await request("/api/data");
    const editedState = { ...aliceState, followups: [{ ...aliceState.followups[0], client: "Alice client edited", status: "Negociação ativa", next: "Confirm measures", priority: "Alta", done: true, amountCents: 234567 }] };
    assert.equal((await request("/api/data", "PUT", { state: editedState, baseRevision: current.data.revision })).status, 200);
    current = await request("/api/data");
    assert.deepEqual(current.data.state, editedState);
    const clearedState = { ...editedState, followups: [{ ...editedState.followups[0], amountCents: null }] };
    assert.equal((await request("/api/data", "PUT", { state: clearedState, baseRevision: current.data.revision })).status, 200);
    assert.deepEqual((await request("/api/data")).data.state, clearedState);
    globalThis.sessionStorage = bobTab;
    assert.deepEqual((await request("/api/data")).data.state, bobState);
  } finally {
    if (previousLocal === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocal;
    if (previousSession === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousSession;
  }
});

test("daily marketing reports persist per account and resetting one day cannot change another user's report", async () => {
  const previousLocal = globalThis.localStorage;
  const previousSession = globalThis.sessionStorage;
  globalThis.localStorage = new Storage();
  const firstTab = new Storage();
  const secondTab = new Storage();
  globalThis.sessionStorage = firstTab;
  const firstSecret = crypto.randomUUID();
  const secondSecret = crypto.randomUUID();
  try {
    const first = await request("/api/auth/register", "POST", registration("marketing.a", firstSecret));
    assert.equal(first.status, 201);
    let marketingDaily = setMarketingCount({ days: [] }, "2026-10-08", "Vendedor A", "newContacts", 3);
    marketingDaily = setMarketingCount(marketingDaily, "2026-10-09", "Vendedor A", "phone", 2);
    const original = { marketingDaily, followups: [{ id: "keep", client: "Cliente exemplo", next: "Retornar" }] };
    assert.equal((await request("/api/data", "PUT", { state: original, baseRevision: null })).status, 200);

    globalThis.sessionStorage = secondTab;
    assert.equal((await request("/api/auth/register", "POST", registration("marketing.b", secondSecret))).status, 201);
    assert.equal((await request("/api/data")).data.state, null);
    const secondState = { marketingDaily: setMarketingCount({ days: [] }, "2026-10-09", "Vendedor B", "phone", 7) };
    assert.equal((await request("/api/data", "PUT", { state: secondState, baseRevision: null })).status, 200);

    globalThis.sessionStorage = firstTab;
    await request("/api/auth/logout", "POST");
    assert.equal((await request("/api/auth/login", "POST", { username: "marketing.a", password: firstSecret })).status, 200);
    const reloaded = await request("/api/data");
    assert.deepEqual(reloaded.data.state, original);
    const reset = { ...original, marketingDaily: resetMarketingDay(marketingDaily, "2026-10-09", "Vendedor A") };
    assert.equal((await request("/api/data", "PUT", { state: reset, baseRevision: reloaded.data.revision })).status, 200);
    const saved = (await request("/api/data")).data.state;
    assert.equal(getMarketingDay(saved.marketingDaily, "2026-10-09", "Vendedor A").phone, 0);
    assert.equal(getMarketingDay(saved.marketingDaily, "2026-10-08", "Vendedor A").newContacts, 3);
    assert.deepEqual(saved.followups, original.followups);

    globalThis.sessionStorage = secondTab;
    assert.deepEqual((await request("/api/data")).data.state, secondState);
  } finally {
    if (previousLocal === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocal;
    if (previousSession === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousSession;
  }
});

test("a storage failure or damaged saved state cannot silently replace another account's work", async () => {
  const previousLocal = globalThis.localStorage;
  const previousSession = globalThis.sessionStorage;
  globalThis.localStorage = new Storage();
  globalThis.sessionStorage = new Storage();
  try {
    const user = await request("/api/auth/register", "POST", registration("clara", "clara-password-123"));
    assert.equal(user.status, 201);
    const stateKey = `mult-portas-pages-state-v1-${user.data.user.id}`;
    const saved = await request("/api/data", "PUT", { state: { sales: ["original"] }, baseRevision: null });
    assert.equal(saved.status, 200);
    const original = globalThis.localStorage.getItem(stateKey);
    globalThis.localStorage.setItem(stateKey, "{broken JSON");
    assert.equal((await request("/api/data")).status, 503);
    assert.equal((await request("/api/data", "PUT", { state: { sales: ["replacement"] }, baseRevision: saved.data.revision })).status, 503);
    assert.equal(globalThis.localStorage.getItem(stateKey), "{broken JSON");
    globalThis.localStorage.setItem(stateKey, original);
    assert.deepEqual((await request("/api/data")).data.state, { sales: ["original"] });
  } finally {
    if (previousLocal === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocal;
    if (previousSession === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousSession;
  }
});
