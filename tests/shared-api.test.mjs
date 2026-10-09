import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSharedApi, digestText, makePasswordProof, normalizePasswordProof, verifyPassword } from "../supabase/functions/mult-portas-api/shared-api.mjs";
import { createRestStore } from "../supabase/functions/mult-portas-api/rest-store.mjs";
import { normalizeClientProgress } from "../supabase/functions/mult-portas-api/lib/client-progress.mjs";

const ORIGIN = "https://icarololiveira123-art.github.io";
const BASE = "https://example-project.supabase.co/functions/v1/mult-portas-api";
const freshSecret = () => crypto.randomUUID();
const clone = (value) => structuredClone(value);

// A shared persistent test store models separate computers, isolates and tokens.
// A before-write hook lets tests revoke/rotate after the HTTP session check.
class MemoryStore {
  users = new Map();
  sessions = new Map();
  states = new Map();
  rates = new Map();
  batches = new Map();
  imports = new Map();
  nextId = 1;
  proof = null;
  calls = [];
  beforeExecute = null;

  constructor(clock) { this.clock = clock; }
  session(auth) {
    const session = this.sessions.get(auth?.tokenHash);
    if (!session || session.revoked || Date.parse(session.expiresAt) <= this.clock()) return null;
    if (session.role === "admin") return session.version === auth.adminVersion ? session : null;
    const user = this.users.get(session.userId);
    return user && !user.deleted && session.version === user.sessionVersion ? session : null;
  }
  userNamed(handle) { return [...this.users.values()].find((user) => !user.deleted && user.usernameNormalized === handle); }
  userWithState(user) {
    const data = this.states.get(user.id);
    return { ...clone(user), state: data?.state ?? null, clientState: data?.clientState ?? { schemaVersion: 1 }, dataUpdatedAt: data?.updatedAt ?? null };
  }
  createUser(payload) {
    if (this.userNamed(payload.usernameNormalized)) return { status: "username-conflict" };
    const user = { id: this.nextId++, username: payload.username, usernameNormalized: payload.usernameNormalized,
      displayName: payload.displayName, branch: payload.branch, password: clone(payload.password), sessionVersion: crypto.randomUUID(), createdAt: new Date(this.clock()).toISOString() };
    this.users.set(user.id, user);
    return { user: clone(user) };
  }
  async execute(action, payload = {}, auth = null) {
    this.calls.push(action);
    if (this.beforeExecute) await this.beforeExecute(action, payload, auth);
    const protectedActions = ["resolve_session", "get_state", "save_state", "update_user", "list_users", "get_user_detail", "admin_create_user", "admin_update_user", "delete_user", "import_local"];
    let session;
    if (protectedActions.includes(action)) {
      session = this.session(auth);
      if (!session) return { status: "unauthorized" };
      if (["list_users", "get_user_detail", "admin_create_user", "admin_update_user", "delete_user", "import_local"].includes(action) && session.role !== "admin") return { status: "forbidden" };
      if (["get_state", "save_state", "update_user"].includes(action) && (session.role !== "user" || payload.userId !== session.userId)) return { status: "forbidden" };
    }
    if (action === "get_access_proof") return { proof: this.proof };
    if (action === "rate_limit") {
      const old = this.rates.get(payload.bucket);
      const current = !old || old.start + payload.seconds * 1000 <= this.clock() ? { start: this.clock(), count: 0 } : old;
      current.count += 1;
      this.rates.set(payload.bucket, current);
      return { allowed: current.count <= payload.max, retryAfter: Math.max(1, Math.ceil((current.start + payload.seconds * 1000 - this.clock()) / 1000)) };
    }
    if (action === "get_user_by_username") return { user: clone(this.userNamed(payload.usernameNormalized) ?? null) };
    if (action === "resolve_session") return { session: clone(session), user: session.role === "user" ? clone(this.users.get(session.userId)) : null };
    if (action === "create_session") {
      if (payload.role === "user") {
        const user = this.users.get(payload.userId);
        if (!user || user.deleted || user.sessionVersion !== payload.version) return { status: "version-conflict" };
      }
      this.sessions.set(payload.tokenHash, clone(payload));
      return { ok: true };
    }
    if (action === "revoke_session") {
      const target = this.sessions.get(payload.tokenHash);
      if (target) target.revoked = true;
      return { ok: true };
    }
    if (["create_user", "admin_create_user"].includes(action)) return this.createUser(payload);
    if (action === "get_state") return clone(this.states.get(payload.userId) ?? { state: null, revision: null, clientState: { schemaVersion: 1 } });
    if (action === "save_state") {
      const old = this.states.get(payload.userId);
      const progress = payload.clientState === undefined ? old?.clientState ?? { schemaVersion: 1 } : mergeProgress(old?.clientState, payload.clientState);
      if ((old?.revision ?? null) !== payload.baseRevision) {
        if (old && JSON.stringify(old.state) === JSON.stringify(payload.state) && JSON.stringify(old.clientState) === JSON.stringify(progress)) return { ok: true, revision: old.revision };
        return { status: "state-conflict", revision: old?.revision ?? null };
      }
      this.states.set(payload.userId, { state: clone(payload.state), clientState: progress, revision: payload.revision, updatedAt: payload.updatedAt });
      return { ok: true, revision: payload.revision };
    }
    if (["update_user", "admin_update_user"].includes(action)) {
      const user = this.users.get(payload.userId);
      if (!user || user.deleted) return { status: "not-found" };
      if (action === "update_user" && user.sessionVersion !== payload.expectedVersion) return { status: "version-conflict" };
      const duplicate = this.userNamed(payload.usernameNormalized);
      if (duplicate && duplicate.id !== user.id) return { status: "username-conflict" };
      Object.assign(user, { username: payload.username, usernameNormalized: payload.usernameNormalized, displayName: payload.displayName, branch: payload.branch, sessionVersion: crypto.randomUUID() });
      if (payload.password) user.password = clone(payload.password);
      for (const stored of this.sessions.values()) if (stored.userId === user.id) stored.revoked = true;
      return { user: clone(user) };
    }
    if (action === "delete_user") {
      const user = this.users.get(payload.userId);
      if (!user || user.deleted) return { status: "not-found" };
      user.deleted = true;
      user.sessionVersion = crypto.randomUUID();
      for (const stored of this.sessions.values()) if (stored.userId === user.id) stored.revoked = true;
      return { ok: true };
    }
    if (action === "list_users") return { users: [...this.users.values()].filter((user) => !user.deleted).map((user) => this.userWithState(user)) };
    if (action === "get_user_detail") {
      const user = this.users.get(payload.userId);
      return user && !user.deleted ? { user: this.userWithState(user) } : { status: "not-found" };
    }
    if (action === "import_local") {
      const prior = this.batches.get(payload.batchId);
      if (prior) return prior.digest === payload.digest ? clone(prior.result) : { status: "batch-conflict" };
      const results = [];
      let imported = 0;
      let conflicts = 0;
      for (const entry of payload.records) {
        const old = this.imports.get(entry.sourceId);
        let result;
        if (old) {
          result = old.digest === entry.digest && old.result.status === "imported" && !this.users.get(old.result.userId)?.deleted
            ? { ...clone(old.result), status: "already-imported" }
            : { sourceId: entry.sourceId, username: entry.username, status: "conflict" };
        } else {
          const created = this.createUser(entry);
          if (created.user) {
            const { user } = created;
            this.states.set(user.id, { state: clone(entry.state), clientState: clone(entry.clientState), revision: `${new Date(this.clock()).toISOString()}|${crypto.randomUUID()}` });
            result = { sourceId: entry.sourceId, username: entry.username, status: "imported", userId: user.id };
            imported += 1;
          } else result = { sourceId: entry.sourceId, username: entry.username, status: "conflict" };
          this.imports.set(entry.sourceId, { digest: entry.digest, result: clone(result) });
        }
        if (result.status === "conflict") conflicts += 1;
        results.push(result);
      }
      const result = { results, imported, conflicts };
      this.batches.set(payload.batchId, { digest: payload.digest, result: clone(result) });
      return result;
    }
    throw new Error(`Unknown store action ${action}`);
  }
}

function mergeProgress(base, incoming) {
  const result = clone(base ?? { schemaVersion: 1 });
  if (incoming.resume) {
    result.resume = { ...result.resume, ...incoming.resume };
    if (incoming.resume.factoryWizardDraft) result.resume.factoryWizardDraft = { ...base?.resume?.factoryWizardDraft, ...incoming.resume.factoryWizardDraft };
  }
  if (incoming.brands) {
    result.brands ??= {};
    for (const [brand, part] of Object.entries(incoming.brands)) {
      const old = result.brands[brand] ?? {};
      result.brands[brand] = { ...old, ...part,
        ...(part.learning ? { learning: { ...old.learning, ...part.learning } } : {}),
        ...(part.studySheet ? { studySheet: { ...old.studySheet, ...part.studySheet } } : {}) };
    }
  }
  return normalizeClientProgress(result);
}

function fixture({ accessPassword = freshSecret() } = {}) {
  let instant = Date.parse("2026-10-09T17:00:00Z");
  const store = new MemoryStore(() => instant);
  const options = { store, accessPassword, now: () => new Date(instant) };
  const handler = createSharedApi(options);
  async function call(path, { method = "GET", body, token, origin = ORIGIN, headers = {}, signal } = {}, target = handler) {
    const request = new Request(`${BASE}${path}`, { method, headers: { Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }), ...(signal ? { signal } : {}) });
    const response = await target(request);
    return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
  }
  async function register(username = "alice") {
    const password = freshSecret();
    const result = await call("/api/auth/register", { method: "POST", body: { username, displayName: "Funcionário Teste", branch: "Araraquara", password } });
    assert.equal(result.status, 201);
    return { ...result.body, password };
  }
  async function privileged() {
    const result = await call("/api/auth/login", { method: "POST", body: { username: "admin", password: accessPassword } });
    assert.equal(result.status, 200);
    return result.body.token;
  }
  return { store, handler, options, call, register, privileged, advance: (ms) => { instant += ms; } };
}

test("two computers sign in to the same shared account and retain isolated work with atomic revision conflicts", async () => {
  const f = fixture();
  const first = await f.register();
  const secondHandler = createSharedApi(f.options);
  const second = await f.call("/api/auth/login", { method: "POST", body: { username: "ALICE", password: first.password } }, secondHandler);
  assert.equal(second.status, 200);
  assert.equal(second.body.user.id, first.user.id);
  assert.notEqual(second.body.token, first.token);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify([...f.store.users.values()]).includes(first.password));
  assert.ok(!JSON.stringify([...f.store.sessions.values()]).includes(first.token));
  const initial = await f.call("/api/data", { token: first.token });
  assert.deepEqual(initial.body, { state: null, revision: null, clientState: { schemaVersion: 1 } });
  const progress = { schemaVersion: 1, resume: { section: "catalog", brand: "brimak" }, brands: { brimak: { learning: { stage: "quality", answers: { measures: 2 } }, studySheet: { measure: "90 × 210 cm", pending: "confirmar" }, view: "pdfs" } } };
  const saved = await f.call("/api/data", { method: "PUT", token: first.token, body: {
    baseRevision: null, state: { sales: ["acolhimento"], marketingDaily: { days: [{ date: "2026-10-09", seller: "Funcionário Teste", newContacts: 3 }] }, followups: [{ id: "first", client: "Cliente", next: "Retornar", amountCents: 125050 }], role: "admin" }, clientState: progress,
  } });
  assert.equal(saved.status, 200);
  const otherComputer = await f.call("/api/data", { token: second.body.token }, secondHandler);
  assert.equal(otherComputer.body.state.marketingDaily.days[0].newContacts, 3);
  assert.equal(otherComputer.body.state.followups[0].amountCents, 125050);
  assert.ok(!Object.hasOwn(otherComputer.body.state, "role"));
  assert.deepEqual(otherComputer.body.clientState, progress);
  assert.equal((await f.call("/api/data", { method: "PUT", token: second.body.token, body: { state: { sales: ["new"] }, baseRevision: null } })).status, 409);
  assert.equal((await f.call("/api/data", { method: "PUT", token: second.body.token, body: { state: { sales: ["new"] } } })).status, 400);
  const updated = await f.call("/api/data", { method: "PUT", token: second.body.token, body: { state: otherComputer.body.state, baseRevision: saved.body.revision, clientState: { schemaVersion: 1, resume: { section: "training" }, brands: { brimak: { learning: { answers: {} }, studySheet: { measure: "" } } } } } });
  assert.equal(updated.status, 200);
  const merged = (await f.call("/api/data", { token: first.token })).body.clientState;
  assert.equal(merged.resume.brand, "brimak");
  assert.equal(merged.resume.section, "training");
  assert.equal(merged.brands.brimak.learning.stage, "quality");
  assert.deepEqual(merged.brands.brimak.learning.answers, {});
  assert.equal(merged.brands.brimak.studySheet.pending, "confirmar");
  assert.equal(merged.brands.brimak.studySheet.measure, "");
  const bob = await f.register("bob");
  assert.equal((await f.call("/api/data", { token: bob.token })).body.state, null);
  assert.equal((await f.call(`/api/admin/users/${first.user.id}`, { token: bob.token })).status, 403);
  assert.equal((await f.store.execute("get_state", { userId: first.user.id }, { tokenHash: await digestText(bob.token), adminVersion: "" })).status, "forbidden");
});

test("password typos keep the session, profile rotation and removal revoke other devices without losing retained work", async () => {
  const f = fixture();
  const alice = await f.register();
  const second = await f.call("/api/auth/login", { method: "POST", body: { username: "alice", password: alice.password } });
  const profile = { displayName: "Nome Atualizado", username: "alice.next", branch: "São Carlos", currentPassword: freshSecret(), newPassword: freshSecret() };
  assert.equal((await f.call("/api/auth/profile", { method: "PATCH", token: alice.token, body: profile })).status, 403);
  assert.equal((await f.call("/api/auth/me", { token: alice.token })).status, 200);
  profile.currentPassword = alice.password;
  const update = await f.call("/api/auth/profile", { method: "PATCH", token: alice.token, body: profile });
  assert.equal(update.status, 200);
  assert.notEqual(update.body.token, alice.token);
  assert.equal((await f.call("/api/auth/me", { token: alice.token })).status, 401);
  assert.equal((await f.call("/api/data", { token: second.body.token })).status, 401);
  assert.equal((await f.call("/api/auth/me", { token: update.body.token })).body.user.username, "alice.next");
  const save = await f.call("/api/data", { method: "PUT", token: update.body.token, body: { state: { sales: ["saved"] }, baseRevision: null } });
  assert.equal(save.status, 200);
  const privileged = await f.privileged();
  assert.equal((await f.call(`/api/admin/users/${alice.user.id}`, { method: "DELETE", token: privileged })).status, 200);
  assert.equal((await f.call("/api/auth/me", { token: update.body.token })).status, 401);
  assert.deepEqual(f.store.states.get(alice.user.id).state.sales, ["saved"]);
  const recreated = await f.register("alice.next");
  assert.notEqual(recreated.user.id, alice.user.id);
  assert.equal((await f.call("/api/data", { token: recreated.token })).body.state, null);
});

test("revocation between HTTP authentication and a database write cannot authorize stale updates", async () => {
  const f = fixture();
  const alice = await f.register();
  f.store.beforeExecute = async (action, _payload, auth) => {
    if (action === "save_state") f.store.sessions.get(auth.tokenHash).revoked = true;
  };
  const result = await f.call("/api/data", { method: "PUT", token: alice.token, body: { state: { sales: ["must-not-save"] }, baseRevision: null } });
  assert.equal(result.status, 401);
  assert.equal(f.store.states.size, 0);
});

test("a database progress limit never produces false save success and business-only retry preserves remote notes", async () => {
  const f = fixture();
  const alice = await f.register();
  const progress = { schemaVersion: 1, brands: { brimak: { studySheet: { pending: "Anotação preservada" } } } };
  const saved = await f.call("/api/data", { method: "PUT", token: alice.token, body: { state: { sales: ["first"] }, baseRevision: null, clientState: progress } });
  assert.equal(saved.status, 200);
  const execute = f.store.execute.bind(f.store);
  f.store.execute = async (action, payload, auth) => action === "save_state" && payload.clientState !== undefined
    ? { status: "progress-too-large" } : execute(action, payload, auth);
  const failed = await f.call("/api/data", { method: "PUT", token: alice.token, body: { state: { sales: ["next"] }, baseRevision: saved.body.revision, clientState: { schemaVersion: 1 } } });
  assert.equal(failed.status, 413);
  assert.equal(failed.body.ok, undefined);
  assert.deepEqual(f.store.states.get(alice.user.id).state.sales, ["first"]);
  const retry = await f.call("/api/data", { method: "PUT", token: alice.token, body: { state: { sales: ["next"] }, baseRevision: saved.body.revision } });
  assert.equal(retry.status, 200);
  assert.deepEqual(f.store.states.get(alice.user.id).state.sales, ["next"]);
  assert.deepEqual(f.store.states.get(alice.user.id).clientState, progress);
});

test("logout, expiry and privileged secret rotation invalidate opaque sessions", async () => {
  const f = fixture();
  const alice = await f.register();
  assert.equal((await f.call("/api/auth/logout", { method: "POST", token: alice.token })).status, 200);
  assert.equal((await f.call("/api/auth/me", { token: alice.token })).status, 401);
  const again = await f.call("/api/auth/login", { method: "POST", body: { username: "alice", password: alice.password } });
  f.advance(25 * 3_600_000);
  assert.equal((await f.call("/api/data", { token: again.body.token })).status, 401);
  const token = await f.privileged();
  const rotated = createSharedApi({ ...f.options, accessPassword: freshSecret() });
  assert.equal((await f.call("/api/admin/users", { token }, rotated)).status, 401);
  assert.deepEqual((await f.call("/api/auth/me")).body, { user: null, admin: false });
  assert.equal((await f.call("/api/auth/admin/setup", { method: "POST", body: { password: freshSecret() } })).status, 401);
});

test("the private database proof configures requested access without a credential in public assets", async () => {
  const f = fixture({ accessPassword: "" });
  assert.equal((await f.call("/api/auth/admin/status")).body.configured, false);
  const password = freshSecret();
  f.store.proof = await makePasswordProof(password);
  const login = await f.call("/api/auth/login", { method: "POST", body: { username: "admin", password } });
  assert.equal(login.status, 200);
  assert.equal(login.body.admin, true);
  assert.equal((await f.call("/api/admin/users", { token: login.body.token })).status, 200);
  f.store.proof = await makePasswordProof(freshSecret());
  assert.equal((await f.call("/api/admin/users", { token: login.body.token })).status, 401);
});

test("account and aggregate throttles persist across function isolates and cannot be reset with forwarded headers", async () => {
  const f = fixture();
  const otherIsolate = createSharedApi(f.options);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await f.call("/api/auth/login", { method: "POST", body: { username: "unknown", password: freshSecret() }, headers: { "X-Forwarded-For": `${attempt}.1.1.1` } }, attempt % 2 ? otherIsolate : f.handler);
    assert.equal(result.status, 401);
  }
  const blocked = await f.call("/api/auth/login", { method: "POST", body: { username: "UNKNOWN", password: freshSecret() }, headers: { "X-Forwarded-For": "totally-different" } }, otherIsolate);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  f.advance(901_000);
  assert.equal((await f.call("/api/auth/login", { method: "POST", body: { username: "unknown", password: freshSecret() } }, otherIsolate)).status, 401);
});

test("origin allowlist, preflight, JSON/body bounds and strict known progress reject unsafe requests", async () => {
  const f = fixture();
  for (const origin of ["https://icarololiveira123-art.github.io.evil.example", "null", "https://someoneelse.github.io", "http://icarololiveira123-art.github.io", ""]) {
    const result = await f.call("/api/auth/me", { origin });
    assert.equal(result.status, 403);
    assert.equal(result.headers.get("access-control-allow-origin"), null);
  }
  const allowed = await f.call("/api/data", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "authorization, content-type" } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(allowed.headers.get("access-control-allow-credentials"), null);
  assert.equal((await f.call("/api/data", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "authorization, x-untrusted" } })).status, 403);
  assert.equal((await f.call("/api/auth/login", { method: "POST", body: "{bad-json" })).status, 400);
  assert.equal((await f.call("/api/auth/login", { method: "POST", body: "x".repeat(8_001) })).status, 413);
  assert.equal((await f.call("/api/auth/login", { method: "POST", body: {}, headers: { "Content-Type": "text/plain" } })).status, 415);
  const alice = await f.register();
  assert.equal((await f.call("/api/data", { method: "PUT", token: alice.token, body: { state: {}, baseRevision: null, clientState: { schemaVersion: 1, sessionToken: freshSecret() } } })).status, 400);
  assert.equal((await f.call("/api/data", { method: "PUT", token: alice.token, body: { state: {}, baseRevision: null, clientState: { schemaVersion: 1, brands: { fake: { view: "pdfs" } } } } })).status, 400);
  assert.equal(f.store.states.size, 0);
  const controller = new AbortController();
  controller.abort();
  assert.equal((await f.call("/api/auth/register", { method: "POST", body: {}, signal: controller.signal })).status, 499);
});

test("privileged migration preserves salted legacy logins and state, reports conflicts, and is idempotent by source and batch", async () => {
  const f = fixture();
  const alice = await f.register();
  const token = await f.privileged();
  const password = freshSecret();
  const legacyProof = await makePasswordProof(password);
  delete legacyProof.version;
  const entry = { sourceId: `${crypto.randomUUID()}:3579`, username: "legacy", displayName: "Nome Legado", branch: "São Carlos", password: legacyProof,
    state: { followups: [{ id: "legacy-followup", client: "Cliente antigo", next: "Atualizar", amountCents: 250000 }], marketingDaily: { days: [{ date: "2026-10-08", seller: "Nome Legado", phone: 4 }] } }, clientState: { schemaVersion: 1, resume: { section: "marketing" } } };
  const batch = { batchId: crypto.randomUUID(), records: [entry, { ...entry, sourceId: `${crypto.randomUUID()}:123`, username: "alice" }] };
  assert.equal((await f.call("/api/admin/import-local", { method: "POST", token: alice.token, body: batch })).status, 403);
  const first = await f.call("/api/admin/import-local", { method: "POST", token, body: batch });
  assert.equal(first.status, 200);
  assert.equal(first.body.imported, 1);
  assert.equal(first.body.conflicts, 1);
  assert.equal(first.body.results[1].status, "conflict");
  const oldId = first.body.results[0].userId;
  assert.notEqual(oldId, alice.user.id);
  const repeated = await f.call("/api/admin/import-local", { method: "POST", token, body: batch });
  assert.deepEqual(repeated.body, first.body);
  assert.equal(f.store.users.size, 2);
  const differentBatch = await f.call("/api/admin/import-local", { method: "POST", token, body: { ...batch, batchId: crypto.randomUUID(), records: [entry] } });
  assert.equal(differentBatch.body.results[0].status, "already-imported");
  const changedBatch = await f.call("/api/admin/import-local", { method: "POST", token, body: { ...batch, records: [{ ...entry, state: { sales: ["should-not-replace"] } }] } });
  assert.equal(changedBatch.status, 409);
  const loginElsewhere = await f.call("/api/auth/login", { method: "POST", body: { username: "LEGACY", password } }, createSharedApi(f.options));
  assert.equal(loginElsewhere.status, 200);
  const restored = (await f.call("/api/data", { token: loginElsewhere.body.token })).body;
  assert.equal(restored.state.followups[0].amountCents, 250000);
  assert.equal(restored.state.marketingDaily.days[0].phone, 4);
  assert.equal(restored.clientState.resume.section, "marketing");
  assert.ok(!JSON.stringify([...f.store.users.values()]).includes(password));
  const broken = { ...entry, sourceId: crypto.randomUUID(), username: "invalid-proof", password: { ...legacyProof, iterations: 1 } };
  assert.equal((await f.call("/api/admin/import-local", { method: "POST", token, body: { batchId: crypto.randomUUID(), records: [broken] } })).status, 400);
  assert.equal(f.store.users.size, 2);
});

test("password proofs validate canonical raw salt bytes, version and bounded work factors", async () => {
  const secret = freshSecret();
  const proof = await makePasswordProof(secret);
  assert.equal(await verifyPassword(secret, proof), true);
  assert.equal(await verifyPassword(freshSecret(), proof), false);
  for (const invalid of [{ ...proof, iterations: 99_999 }, { ...proof, iterations: 1_000_001 }, { ...proof, iterations: 210000.5 }, { ...proof, salt: "00".repeat(16) }, { ...proof, hash: "a".repeat(44) }, { ...proof, version: "unsupported" }]) assert.equal(normalizePasswordProof(invalid), null);
  const raw = Uint8Array.from(atob(proof.salt), (char) => char.charCodeAt(0));
  assert.equal(raw.byteLength, 16);
});

test("REST database transport keeps the service credential server-side and passes minimal auth context", async () => {
  const serviceKey = `sb_secret_${freshSecret()}`;
  let captured;
  const store = createRestStore({ url: "https://example-project.supabase.co", serviceKey, fetchImpl: async (url, init) => {
    captured = { url, init };
    return Response.json({ state: null });
  } });
  const tokenHash = await digestText(freshSecret());
  await store.execute("get_state", { userId: 4 }, { tokenHash, adminVersion: "version", now: new Date().toISOString(), user: { password: freshSecret() }, session: { role: "forged" } });
  assert.equal(captured.url, "https://example-project.supabase.co/rest/v1/rpc/mp_shared_store");
  assert.equal(captured.init.headers.apikey, serviceKey);
  assert.equal(captured.init.headers.Authorization, undefined);
  assert.equal(captured.init.redirect, "error");
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(Object.keys(body.p_auth).sort(), ["adminVersion", "now", "tokenHash"]);
  assert.ok(!captured.init.body.includes(serviceKey));
});

test("a database uniqueness race becomes a profile conflict without exposing private error text", async () => {
  const privateDetail = freshSecret();
  const store = createRestStore({ url: "https://example-project.supabase.co", serviceKey: `sb_secret_${freshSecret()}`,
    fetchImpl: async () => Response.json({ code: "23505", details: privateDetail }, { status: 409 }) });
  const result = await store.execute("update_user", {});
  assert.deepEqual(result, { status: "username-conflict" });
  assert.ok(!JSON.stringify(result).includes(privateDetail));
  await assert.rejects(store.execute("save_state", {}), /private_store_http_409/);
});

test("deployment normalizers remain byte-identical to the current application contract", async () => {
  for (const name of ["dalcomad-kit.mjs", "quote-amount.mjs", "marketing-daily.mjs", "client-progress.mjs"]) {
    const source = await readFile(new URL(`../app/lib/${name}`, import.meta.url), "utf8");
    const bundled = await readFile(new URL(`../supabase/functions/mult-portas-api/lib/${name}`, import.meta.url), "utf8");
    assert.equal(bundled, source, name);
  }
  const canonical = (await readFile(new URL("../app/api/data/state-contract.mjs", import.meta.url), "utf8")).replaceAll("../../lib/", "./");
  assert.equal(await readFile(new URL("../supabase/functions/mult-portas-api/lib/state-contract.mjs", import.meta.url), "utf8"), canonical);
});
