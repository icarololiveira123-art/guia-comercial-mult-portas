import assert from "node:assert/strict";
import test from "node:test";
import { createSharedApiFetch, SHARED_SESSION_KEY, validateSharedApiBase } from "../app/lib/shared-api-client.mjs";

const BASE = "https://abcdefghijklmnopqrst.supabase.co/functions/v1/mult-portas-api";
const expiry = () => new Date(Date.now() + 86_400_000).toISOString();

class Storage {
  #items = new Map();
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function employee(id = 1) {
  return { id, username: `employee-${id}`, displayName: `Funcionário ${id}`, branch: "Araraquara" };
}

function loggedIn(storage, id = 1, endpoint = BASE) {
  const session = {
    endpoint, token: crypto.randomUUID(), generation: crypto.randomUUID(),
    admin: false, userId: id, expiresAt: expiry(),
  };
  storage.setItem(SHARED_SESSION_KEY, JSON.stringify(session));
  return session;
}

async function request(api, path, method = "GET", body, extra = {}) {
  const response = await api(path, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }), ...extra,
  });
  return { status: response.status, data: await response.json() };
}

// Disposable credentials and bearer tokens are generated per test, never
// deployed or embedded in the application's source configuration.
function centralServer() {
  const users = new Map();
  const sessions = new Map();
  const states = new Map();
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname.slice(new URL(BASE).pathname.length);
    calls.push({ url, ...init, headers: new Headers(init.headers) });
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    const token = new Headers(init.headers).get("Authorization")?.replace(/^Bearer /, "");
    const user = sessions.get(token);
    if (path === "/api/auth/admin/status") return Response.json({ configured: true });
    if (path === "/api/auth/register" && init.method === "POST") {
      if (users.has(body.username)) return Response.json({ error: "Esse usuário já está cadastrado." }, { status: 409 });
      const record = { ...employee(users.size + 1), ...body };
      users.set(body.username, record);
      const publicUser = { ...record };
      delete publicUser.password;
      const nextToken = crypto.randomUUID();
      sessions.set(nextToken, publicUser);
      return Response.json({ user: publicUser, token: nextToken, expiresAt: expiry() }, { status: 201 });
    }
    if (path === "/api/auth/login") {
      const found = users.get(body.username);
      if (!found || found.password !== body.password) return Response.json({ error: "Usuário ou senha incorretos." }, { status: 401 });
      const publicUser = { ...found };
      delete publicUser.password;
      const nextToken = crypto.randomUUID();
      sessions.set(nextToken, publicUser);
      return Response.json({ user: publicUser, token: nextToken, expiresAt: expiry() });
    }
    if (!user) return Response.json({ error: "Sessão expirada." }, { status: 401 });
    if (path === "/api/auth/me") return Response.json({ user, admin: false });
    if (path === "/api/auth/logout") {
      sessions.delete(token);
      return Response.json({ ok: true });
    }
    if (path === "/api/data") {
      const stored = states.get(user.id) ?? { state: null, revision: null };
      if (init.method === "GET") return Response.json(stored);
      if (body.baseRevision !== stored.revision) return Response.json({ error: "Dados alterados em outro aparelho.", revision: stored.revision }, { status: 409 });
      const revision = crypto.randomUUID();
      states.set(user.id, { state: body.state, revision });
      return Response.json({ ok: true, revision });
    }
    return Response.json({ error: "Recurso não encontrado." }, { status: 404 });
  };
  return { fetchImpl, calls, sessions };
}

test("workspace transitions preserve the panel token, bind refreshes to the selected user and restore a removed account", async () => {
  const storage = new Storage();
  const token = crypto.randomUUID();
  const original = { endpoint: BASE, token, generation: "panel", admin: true, userId: null };
  storage.setItem(SHARED_SESSION_KEY, JSON.stringify(original));
  const paths = [];
  let refreshUser = employee(7);
  let unavailable = false;
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async (url, init) => {
    const path = url.slice(BASE.length); paths.push(path);
    assert.equal(init.headers.get("Authorization"), `Bearer ${token}`);
    if (path === "/api/admin/users/7/access") return Response.json(unavailable
      ? { user: null, admin: true, workspaceAccess: false }
      : { user: refreshUser, admin: false, workspaceAccess: true });
    if (path === "/api/admin/users/7/workspace") return Response.json({ state: { sales: ["kept"] }, revision: "current" });
    if (path === "/api/admin/access/end") return Response.json({ user: null, admin: true, workspaceAccess: false });
    return Response.json({ user: null, admin: true });
  } });
  assert.equal((await request(api, "/api/admin/users/7/access", "POST")).status, 200);
  assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, token);
  assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).workspaceUserId, 7);
  assert.equal((await request(api, "/api/data")).data.state.sales[0], "kept");
  assert.equal(paths.at(-1), "/api/admin/users/7/workspace");
  const selectedRaw = storage.getItem(SHARED_SESSION_KEY);
  refreshUser = employee(8);
  assert.equal((await request(api, "/api/auth/me")).status, 502);
  assert.equal(storage.getItem(SHARED_SESSION_KEY), selectedRaw);
  refreshUser = employee(7);
  unavailable = true;
  const restored = await request(api, "/api/auth/me");
  assert.equal(restored.status, 200);
  assert.equal(restored.data.admin, true);
  assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).workspaceUserId, undefined);
  assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, token);
});

test("workspace access refuses invalid identities and storage failures without replacing the existing session", async () => {
  const storage = new Storage();
  storage.setItem(SHARED_SESSION_KEY, JSON.stringify({ endpoint: BASE, token: crypto.randomUUID(), generation: "panel", admin: true, userId: null }));
  const original = storage.getItem(SHARED_SESSION_KEY);
  let resultUser = employee(9);
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async () => Response.json({ user: resultUser, admin: false, workspaceAccess: true }) });
  assert.equal((await request(api, "/api/admin/users/7/access", "POST")).status, 502);
  assert.equal(storage.getItem(SHARED_SESSION_KEY), original);
  resultUser = employee(7);
  storage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
  assert.equal((await request(api, "/api/admin/users/7/access", "POST")).status, 503);
  assert.equal(storage.getItem(SHARED_SESSION_KEY), original);
});

test("returning to the panel cancels a delayed workspace result and keeps the original authority", async () => {
  const storage = new Storage();
  const token = crypto.randomUUID();
  storage.setItem(SHARED_SESSION_KEY, JSON.stringify({ endpoint: BASE, token, generation: "workspace", admin: true, userId: null, workspaceUserId: 7 }));
  const slow = deferred();
  let waiting;
  const started = new Promise(resolve => { waiting = resolve; });
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async (url) => {
    if (url.endsWith("/workspace")) { waiting(); return slow.promise; }
    return Response.json({ user: null, admin: true, workspaceAccess: false });
  } });
  const pending = api("/api/data");
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await started;
  assert.equal((await request(api, "/api/admin/access/end", "POST")).status, 200);
  slow.resolve(Response.json({ state: { sales: ["stale"] }, revision: "stale" }));
  await rejected;
  const stored = JSON.parse(storage.getItem(SHARED_SESSION_KEY));
  assert.equal(stored.token, token);
  assert.equal(stored.workspaceUserId, undefined);
  assert.equal(stored.admin, true);
});

test("employee sessions cannot activate the workspace context through client storage or public routes", async () => {
  const storage = new Storage();
  const original = { endpoint: BASE, token: crypto.randomUUID(), generation: "employee", admin: false, userId: 7 };
  storage.setItem(SHARED_SESSION_KEY, JSON.stringify(original));
  let calls = 0;
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async () => { calls += 1; return Response.json({}); } });
  assert.equal((await request(api, "/api/admin/users/8/access", "POST")).status, 403);
  assert.equal((await request(api, "/api/admin/access/end", "POST")).status, 403);
  storage.setItem(SHARED_SESSION_KEY, JSON.stringify({ ...original, workspaceUserId: 8 }));
  assert.equal((await request(api, "/api/data")).status, 503);
  assert.equal(calls, 0);
});

test("two computers share an account's saved work while another account remains separate", async () => {
  const server = centralServer();
  const firstStorage = new Storage();
  const secondStorage = new Storage();
  const otherStorage = new Storage();
  const first = createSharedApiFetch({ baseUrl: BASE, storage: firstStorage, fetchImpl: server.fetchImpl });
  const second = createSharedApiFetch({ baseUrl: BASE, storage: secondStorage, fetchImpl: server.fetchImpl });
  const other = createSharedApiFetch({ baseUrl: BASE, storage: otherStorage, fetchImpl: server.fetchImpl });
  const password = crypto.randomUUID();
  const registration = await request(first, "/api/auth/register", "POST", { ...employee(), password });
  assert.equal(registration.status, 201);
  assert.equal(registration.data.user.id, 1);
  assert.equal(Object.hasOwn(registration.data, "token"), false);
  assert.equal(server.calls[0].headers.has("Authorization"), false);
  const login = await request(second, "/api/auth/login", "POST", { username: employee().username, password });
  assert.equal(login.status, 200);
  assert.deepEqual(login.data.user, registration.data.user);
  assert.notEqual(JSON.parse(firstStorage.getItem(SHARED_SESSION_KEY)).token, JSON.parse(secondStorage.getItem(SHARED_SESSION_KEY)).token);

  const state = { metrics: { quotes: 7 }, marketingDaily: [{ date: "2026-10-09", counts: [4, 1, 2, 0, 3] }] };
  const saved = await request(first, "/api/data", "PUT", { state, baseRevision: null });
  assert.equal(saved.status, 200);
  const loaded = await request(second, "/api/data");
  assert.deepEqual(loaded.data, { state, revision: saved.data.revision });
  assert.equal((await request(second, "/api/data", "PUT", { state: { metrics: { quotes: 9 } }, baseRevision: null })).status, 409);
  const freshClient = createSharedApiFetch({ baseUrl: BASE, storage: secondStorage, fetchImpl: server.fetchImpl });
  assert.equal((await request(freshClient, "/api/auth/me")).data.user.id, 1);

  await request(other, "/api/auth/register", "POST", { ...employee(2), password: crypto.randomUUID() });
  assert.deepEqual((await request(other, "/api/data")).data, { state: null, revision: null });
  const secondToken = JSON.parse(secondStorage.getItem(SHARED_SESSION_KEY)).token;
  assert.equal((await request(second, "/api/auth/logout", "POST")).data.ok, true);
  assert.equal(secondStorage.getItem(SHARED_SESSION_KEY), null);
  assert.equal(server.sessions.has(secondToken), false);
  assert.deepEqual((await request(second, "/api/auth/me")).data, { user: null, admin: false });
  assert.deepEqual((await request(first, "/api/data")).data.state, state);
});

test("endpoint validation refuses arbitrary origins, credentials, paths and insecure production URLs", () => {
  assert.equal(validateSharedApiBase(`${BASE}/`), BASE);
  const rejected = [
    "", "not-a-url", "https://example.com/functions/v1/mult-portas-api",
    BASE.replace("https:", "http:"), BASE.replace(".supabase.co", ".supabase.co.evil.test"),
    BASE.replace("https://", "https://person:secret@"), `${BASE}?key=value`, `${BASE}#section`,
    `${BASE}/api`, BASE.replace("/functions/v1/", "/other/"), `${BASE}/../other`,
    BASE.replace(".supabase.co", ".supabase.co:444"), "http://localhost:54321/functions/v1/mult-portas-api",
  ];
  for (const baseUrl of rejected) assert.throws(() => createSharedApiFetch({ baseUrl }), /serviço de acesso/);
  assert.equal(validateSharedApiBase("http://127.0.0.1:54321/functions/v1/mult-portas-api", { allowLocalhost: true }), "http://127.0.0.1:54321/functions/v1/mult-portas-api");
  assert.throws(() => validateSharedApiBase("http://localhost.evil.test:54321/functions/v1/mult-portas-api", { allowLocalhost: true }), /não é permitido/);
});

test("authorization is attached only to the fixed API and cookies and redirects are disabled", async () => {
  const storage = new Storage();
  const session = loggedIn(storage);
  const calls = [];
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return Response.json({ configured: true });
  } });
  for (const path of ["https://evil.test/api/data", "//evil.test/api/data", "/api/../data", "/api/%2e%2e/data", "/api/data#part", "/api/data\\extra"]) {
    assert.equal((await api(path)).status, 400);
  }
  assert.equal(calls.length, 0);
  await api("/api/data?revision=latest", { credentials: "include", redirect: "follow", headers: { Authorization: `Bearer ${crypto.randomUUID()}`, "X-Trace": "test" } });
  const protectedCall = calls[0];
  assert.equal(protectedCall.url, `${BASE}/api/data?revision=latest`);
  assert.equal(protectedCall.init.headers.get("Authorization"), `Bearer ${session.token}`);
  assert.equal(protectedCall.init.headers.get("X-Trace"), "test");
  assert.equal(protectedCall.init.credentials, "omit");
  assert.equal(protectedCall.init.redirect, "error");
  assert.equal(protectedCall.init.referrerPolicy, "no-referrer");
  await api("/api/auth/admin/status", { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(calls[1].init.headers.has("Authorization"), false);

  const redirected = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async () => new Response(null, { status: 302, headers: { Location: "https://evil.test/collect" } }) });
  assert.equal((await request(redirected, "/api/data")).status, 502);
  assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, session.token);
});

test("network failures keep the shared session and never use or erase browser-only accounts", async () => {
  const previousLocal = globalThis.localStorage;
  let localTouches = 0;
  globalThis.localStorage = { getItem() { localTouches += 1; throw new Error("must not read"); }, setItem() { localTouches += 1; }, removeItem() { localTouches += 1; } };
  try {
    const storage = new Storage();
    const session = loggedIn(storage);
    const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async () => { throw new TypeError("network unavailable"); } });
    const result = await request(api, "/api/data");
    assert.equal(result.status, 503);
    assert.match(result.data.error, /conectar ao servidor/);
    assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, session.token);
    assert.equal(localTouches, 0);
  } finally {
    if (previousLocal === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocal;
  }
});

test("a failed new login preserves the existing account and strips any returned token", async () => {
  const storage = new Storage();
  const session = loggedIn(storage);
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async (_url, init) => {
    assert.equal(init.headers.has("Authorization"), false);
    return Response.json({ error: "Usuário ou senha incorretos.", token: crypto.randomUUID() }, { status: 401 });
  } });
  const result = await request(api, "/api/auth/login", "POST", { username: employee(2).username, password: crypto.randomUUID() });
  assert.equal(result.status, 401);
  assert.equal(Object.hasOwn(result.data, "token"), false);
  assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, session.token);
});

test("newer login wins and an older login response cannot change the active account", async () => {
  const storage = new Storage();
  const firstResponse = deferred();
  const secondToken = crypto.randomUUID();
  let count = 0;
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async () => {
    count += 1;
    return count === 1 ? firstResponse.promise : Response.json({ user: employee(2), token: secondToken, expiresAt: expiry() });
  } });
  const first = api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: employee().username, password: crypto.randomUUID() }) });
  const second = await request(api, "/api/auth/login", "POST", { username: employee(2).username, password: crypto.randomUUID() });
  assert.equal(second.data.user.id, 2);
  firstResponse.resolve(Response.json({ user: employee(), token: crypto.randomUUID(), expiresAt: expiry() }));
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, secondToken);
});

test("a stale unauthorized read cannot destroy a new account's session", async () => {
  const storage = new Storage();
  loggedIn(storage);
  const pendingRead = deferred();
  const newToken = crypto.randomUUID();
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async (url) => url.endsWith("/api/data")
    ? pendingRead.promise : Response.json({ user: employee(2), token: newToken, expiresAt: expiry() }) });
  const oldRead = api("/api/data");
  await request(api, "/api/auth/login", "POST", { username: employee(2).username, password: crypto.randomUUID() });
  pendingRead.resolve(Response.json({ error: "Sessão expirada." }, { status: 401 }));
  await assert.rejects(oldRead, { name: "AbortError" });
  assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, newToken);
});

test("stale successful save and initial session check do not return another account's results", async () => {
  for (const path of ["/api/data", "/api/auth/me"]) {
    const storage = new Storage();
    loggedIn(storage);
    const pending = deferred();
    const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async (url) => url.endsWith("/api/auth/login")
      ? Response.json({ user: employee(2), token: crypto.randomUUID(), expiresAt: expiry() }) : pending.promise });
    const older = api(path, { method: path === "/api/data" ? "PUT" : "GET", ...(path === "/api/data" ? { body: JSON.stringify({ state: { metrics: { quotes: 1 } }, baseRevision: null }) } : {}) });
    await request(api, "/api/auth/login", "POST", { username: employee(2).username, password: crypto.randomUUID() });
    pending.resolve(Response.json(path === "/api/data" ? { ok: true, revision: crypto.randomUUID() } : { user: employee(), admin: false }));
    await assert.rejects(older, { name: "AbortError" });
    assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).userId, 2);
  }
});

test("another adapter instance sharing the tab also invalidates stale responses", async () => {
  const storage = new Storage();
  loggedIn(storage);
  const pending = deferred();
  const first = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: () => pending.promise });
  const oldRead = first("/api/data");
  const replacementToken = crypto.randomUUID();
  const second = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async () => Response.json({ user: employee(2), token: replacementToken }) });
  await request(second, "/api/auth/login", "POST", { username: employee(2).username, password: crypto.randomUUID() });
  pending.resolve(Response.json({ error: "Sessão expirada." }, { status: 401 }));
  await assert.rejects(oldRead, { name: "AbortError" });
  assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, replacementToken);
});

test("matching expired me becomes a normal logged-out result, other unauthorized requests remain 401", async () => {
  for (const path of ["/api/auth/me", "/api/data"]) {
    const storage = new Storage();
    loggedIn(storage);
    const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async () => Response.json({ error: "Sessão expirada." }, { status: 401 }) });
    const result = await request(api, path);
    assert.equal(result.status, path === "/api/auth/me" ? 200 : 401);
    if (path === "/api/auth/me") assert.deepEqual(result.data, { user: null, admin: false });
    assert.equal(storage.getItem(SHARED_SESSION_KEY), null);
  }
});

test("logout failures preserve the session until explicit successful revocation", async () => {
  for (const response of [
    Response.json({ error: "Servidor indisponível." }, { status: 503 }),
    Response.json({ error: "Saída não confirmada." }, { status: 401 }),
    Response.json({ ok: false }), new Response(null, { status: 204 }),
  ]) {
    const storage = new Storage();
    const original = loggedIn(storage);
    const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async () => response });
    const result = await request(api, "/api/auth/logout", "POST");
    assert.notEqual(result.status, 200);
    assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, original.token);
  }
});

test("an old logout cannot clear a newly selected account", async () => {
  const storage = new Storage();
  loggedIn(storage);
  const logout = deferred();
  const newToken = crypto.randomUUID();
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async (url) => url.endsWith("/api/auth/logout")
    ? logout.promise : Response.json({ user: employee(2), token: newToken }) });
  const oldLogout = api("/api/auth/logout", { method: "POST" });
  await request(api, "/api/auth/login", "POST", { username: employee(2).username, password: crypto.randomUUID() });
  logout.resolve(Response.json({ ok: true }));
  await assert.rejects(oldLogout, { name: "AbortError" });
  assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, newToken);
});

test("aborting login before fetch or while reading its body never saves a token", async () => {
  const storage = new Storage();
  const canceled = new AbortController();
  canceled.abort();
  let calls = 0;
  const pendingBody = deferred();
  const bodyStarted = deferred();
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async () => {
    calls += 1;
    return { ok: true, status: 200, headers: new Headers(), redirected: false, url: "", text: () => { bodyStarted.resolve(); return pendingBody.promise; } };
  } });
  await assert.rejects(api("/api/auth/login", { method: "POST", signal: canceled.signal }), { name: "AbortError" });
  assert.equal(calls, 0);
  const controller = new AbortController();
  const pending = api("/api/auth/login", { method: "POST", signal: controller.signal });
  await bodyStarted.promise;
  controller.abort();
  pendingBody.resolve(JSON.stringify({ user: employee(), token: crypto.randomUUID() }));
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(storage.getItem(SHARED_SESSION_KEY), null);
});

test("invalid access DTOs and malformed JSON never replace a valid session", async () => {
  for (const payload of [
    { user: employee() }, { user: { ...employee(), id: "1" }, token: crypto.randomUUID() },
    { user: employee(), token: "" }, { user: employee(), token: "line\nbreak" },
    { user: employee(), token: crypto.randomUUID(), expiresAt: "invalid date" },
    { admin: true, user: employee(), token: crypto.randomUUID() },
  ]) {
    const storage = new Storage();
    const original = loggedIn(storage);
    const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async () => Response.json(payload) });
    assert.equal((await request(api, "/api/auth/login", "POST", { username: employee().username, password: crypto.randomUUID() })).status, 502);
    assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, original.token);
  }
  const storage = new Storage();
  const original = loggedIn(storage);
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async () => new Response("<html>unexpected</html>") });
  const result = await request(api, "/api/data");
  assert.equal(result.status, 502);
  assert.match(result.data.error, /resposta inválida/);
  assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, original.token);
});

test("profile token rotation retains the same identity and invalidates older pending responses", async () => {
  const storage = new Storage();
  const original = loggedIn(storage);
  const pendingRead = deferred();
  const nextToken = crypto.randomUUID();
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async (url, init) => {
    assert.equal(init.headers.get("Authorization"), `Bearer ${original.token}`);
    return url.endsWith("/api/data") ? pendingRead.promise
      : Response.json({ user: { ...employee(), displayName: "Funcionário atualizado" }, token: nextToken, expiresAt: expiry() });
  } });
  const staleRead = api("/api/data");
  const profile = await request(api, "/api/auth/profile", "PATCH", { displayName: "Funcionário atualizado", currentPassword: crypto.randomUUID(), newPassword: crypto.randomUUID() });
  assert.equal(profile.status, 200);
  assert.equal(Object.hasOwn(profile.data, "token"), false);
  assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, nextToken);
  pendingRead.resolve(Response.json({ state: null, revision: null }));
  await assert.rejects(staleRead, { name: "AbortError" });
});

test("profile success requires its rotated token and cannot switch the authenticated identity", async () => {
  for (const payload of [
    { user: employee() }, { user: employee(2), token: crypto.randomUUID() },
  ]) {
    const storage = new Storage();
    const original = loggedIn(storage);
    const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async () => Response.json(payload) });
    assert.equal((await request(api, "/api/auth/profile", "PATCH", { displayName: "Funcionário atualizado" })).status, 502);
    assert.equal(JSON.parse(storage.getItem(SHARED_SESSION_KEY)).token, original.token);
  }
});

test("privileged login keeps the existing DTO without returning its bearer token", async () => {
  const storage = new Storage();
  const token = crypto.randomUUID();
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async (_url, init) => {
    assert.equal(init.headers.has("Authorization"), false);
    return Response.json({ user: null, admin: true, token, expiresAt: expiry() });
  } });
  const result = await request(api, "/api/auth/login", "POST", { username: crypto.randomUUID(), password: crypto.randomUUID() });
  assert.equal(result.status, 200);
  assert.equal(result.data.admin, true);
  assert.equal(result.data.user, null);
  assert.equal(Object.hasOwn(result.data, "token"), false);
  const saved = JSON.parse(storage.getItem(SHARED_SESSION_KEY));
  assert.equal(saved.admin, true);
  assert.equal(saved.userId, null);
  assert.equal(saved.token, token);
});

test("sessions for another backend are neither sent nor erased", async () => {
  const storage = new Storage();
  const alternate = BASE.replace("abcdefghijklmnopqrst", "tsrqponmlkjihgfedcba");
  loggedIn(storage, 1, alternate);
  const original = storage.getItem(SHARED_SESSION_KEY);
  let calls = 0;
  const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async (_url, init) => {
    calls += 1;
    assert.equal(init.headers.has("Authorization"), false);
    return Response.json({ configured: true });
  } });
  assert.deepEqual((await request(api, "/api/auth/me")).data, { user: null, admin: false });
  assert.equal((await request(api, "/api/data")).status, 401);
  await request(api, "/api/auth/admin/status");
  assert.equal(calls, 1);
  assert.equal(storage.getItem(SHARED_SESSION_KEY), original);
});

test("damaged or unavailable shared storage fails closed without a network request", async () => {
  for (const storage of [
    { getItem() { return "{broken"; }, setItem() { throw new Error("must not write"); }, removeItem() { throw new Error("must not remove"); } },
    { getItem() { throw new Error("blocked"); }, setItem() {}, removeItem() {} },
  ]) {
    let calls = 0;
    const api = createSharedApiFetch({ baseUrl: BASE, storage, fetchImpl: async () => { calls += 1; return Response.json({ user: employee(), token: crypto.randomUUID() }); } });
    assert.equal((await request(api, "/api/auth/login", "POST", { username: employee().username, password: crypto.randomUUID() })).status, 503);
    assert.equal(calls, 0);
  }
});
