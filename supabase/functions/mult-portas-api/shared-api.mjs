import { normalizeEmployeeState, summarizeEmployeeState } from "./lib/state-contract.mjs";
import { normalizeClientProgress } from "./lib/client-progress.mjs";
import { hasLegacyMarketingDays, preserveLegacyMarketingCounts } from "./lib/marketing-daily.mjs";

// This module is deliberately portable: no SDK, environment reads or browser
// storage. The deployment entrypoint injects the private database and secret.
const enc = new TextEncoder();
const USERNAME = /^[a-zA-Z0-9._-]{3,40}$/;
const BRANCHES = new Set(["Araraquara", "São Carlos"]);
const DEFAULT_ORIGIN = "https://icarololiveira123-art.github.io";
const AUTH_BYTES = 8_000;
const STATE_BYTES = 400_000;
const PROGRESS_BYTES = 150_000;
const IMPORT_BYTES = 8_000_000;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const PASSWORD_VERSION = "pbkdf2-sha256-v1";
const PASSWORD_ITERATIONS = 210_000;
const SESSION_HOURS = { user: 24, admin: 8 };

class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalUsername(value) {
  return value.trim().toLocaleLowerCase("pt-BR");
}

function toBase64(bytes) {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}

function fromBase64(value) {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function digestText(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}

export function normalizePasswordProof(value) {
  if (!record(value) || (value.version !== undefined && value.version !== PASSWORD_VERSION)
    || typeof value.salt !== "string" || typeof value.hash !== "string"
    || value.salt.length !== 24 || value.hash.length !== 44
    || !Number.isSafeInteger(value.iterations) || value.iterations < 100_000 || value.iterations > 1_000_000) return null;
  try {
    const salt = fromBase64(value.salt);
    const hash = fromBase64(value.hash);
    if (salt.length !== 16 || hash.length !== 32
      || toBase64(salt) !== value.salt || toBase64(hash) !== value.hash) return null;
    return { version: PASSWORD_VERSION, salt: value.salt, hash: value.hash, iterations: value.iterations };
  } catch {
    return null;
  }
}

async function derivePassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function makePasswordProof(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    version: PASSWORD_VERSION, salt: toBase64(salt),
    hash: toBase64(await derivePassword(password, salt, PASSWORD_ITERATIONS)), iterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyPassword(password, rawProof) {
  const proof = normalizePasswordProof(rawProof);
  if (!proof || typeof password !== "string" || password.length > 120) return false;
  return equalBytes(fromBase64(proof.hash), await derivePassword(password, fromBase64(proof.salt), proof.iterations));
}

function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName, branch: user.branch };
}

function adminUser(user) {
  return {
    ...publicUser(user), createdAt: user.createdAt ?? null, dataUpdatedAt: user.dataUpdatedAt ?? null,
    summary: summarizeEmployeeState(user.state ?? null),
  };
}

function parseProfile(body, requirePassword = true, passwordField = "password") {
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const branch = typeof body.branch === "string" ? body.branch.trim() : "";
  const password = typeof body[passwordField] === "string" ? body[passwordField] : "";
  if (displayName.length < 2 || displayName.length > 80) throw new ApiError(400, "Informe o nome completo do funcionário.");
  if (!USERNAME.test(username) || normalUsername(username) === "admin") throw new ApiError(400, "O usuário deve ter de 3 a 40 caracteres, sem espaços.");
  if (!BRANCHES.has(branch)) throw new ApiError(400, "Selecione Araraquara ou São Carlos.");
  if ((requirePassword || password) && (password.length < 8 || password.length > 120)) throw new ApiError(400, "A senha deve ter de 8 a 120 caracteres.");
  return { displayName, username, usernameNormalized: normalUsername(username), branch, password };
}

async function readJson(request, limit) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(415, "Envie os dados em formato JSON.");
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > limit)) throw new ApiError(413, "Os dados enviados ultrapassaram o limite.");
  if (!request.body) throw new ApiError(400, "Não foi possível ler os dados enviados.");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApiError(413, "Os dados enviados ultrapassaram o limite.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!record(value)) throw new Error("invalid");
    return value;
  } catch {
    throw new ApiError(400, "Não foi possível ler os dados enviados.");
  }
}

function checkSignal(request) {
  if (request.signal.aborted) throw new ApiError(499, "A operação foi cancelada.");
}

function checkSize(value, max) {
  if (enc.encode(JSON.stringify(value)).length > max) throw new ApiError(413, "Os dados enviados ultrapassaram o limite.");
}

function requireResult(result) {
  if (!record(result)) throw new Error("invalid_store_response");
  if (result.status === "unauthorized") throw new ApiError(401, "Sessão expirada. Entre novamente.");
  if (result.status === "forbidden") throw new ApiError(403, "Acesso não autorizado.");
  if (result.status === "not-found") throw new ApiError(404, "Conta não encontrada.");
  if (result.status === "username-conflict") throw new ApiError(409, "Esse usuário já está cadastrado.");
  if (result.status === "version-conflict") throw new ApiError(409, "A conta foi alterada. Entre novamente.");
  if (result.status === "batch-conflict") throw new ApiError(409, "Esta identificação de importação já foi usada com outros dados.");
  if (result.status === "progress-too-large") throw new ApiError(413, "O progresso enviado ultrapassou o limite. Seus dados salvos foram preservados.");
  return result;
}

function validOrigin(origin, allowLocalhost) {
  try {
    const url = new URL(origin);
    return url.origin === origin && !url.username && !url.password
      && (url.protocol === "https:" || (allowLocalhost && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
  } catch { return false; }
}

/**
 * store.execute(action, payload, auth) calls a service_role-only database RPC.
 * The RPC must atomically re-check auth on EACH protected action, not trust the
 * earlier HTTP session read, and enforce ownership/CAS inside its transaction.
 * normalizeClientState is the shared, strict whitelist for resume/catalog data.
 */
export function createSharedApi({ store, accessPassword = "", allowedOrigins = [DEFAULT_ORIGIN], allowLocalhost = false,
  normalizeClientState = normalizeClientProgress,
  now = () => new Date(), getTrustedClientIp = null, onError = (details) => { void details; } }) {
  if (!store || typeof store.execute !== "function") throw new Error("A persistent private store is required.");
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length || allowedOrigins.some((origin) => !validOrigin(origin, allowLocalhost))) throw new Error("Exact HTTPS origins are required.");
  const origins = new Set(allowedOrigins);
  let environmentProof;
  let dummyProof;

  async function accessProof() {
    if (typeof accessPassword === "string" && accessPassword.length >= 5 && accessPassword.length <= 120) {
      environmentProof ??= makePasswordProof(accessPassword);
      const proof = await environmentProof;
      // A stable, server-only version ensures rotation invalidates every isolate.
      return { proof, version: await digestText(`mp-admin-secret-v1:${accessPassword}`) };
    }
    const config = await store.execute("get_access_proof", {});
    const proof = normalizePasswordProof(config?.proof);
    return proof ? { proof, version: await digestText(JSON.stringify(proof)) } : null;
  }

  async function execute(action, payload = {}, auth = null) {
    return requireResult(await store.execute(action, payload, auth));
  }

  async function rate(bucket, max, seconds, clock) {
    const result = await execute("rate_limit", {
      bucket: await digestText(bucket), max, seconds, now: clock.toISOString(),
    });
    if (!result.allowed) throw new ApiError(429, "Muitas tentativas. Aguarde alguns minutos e tente novamente.", { retryAfter: result.retryAfter ?? seconds });
  }

  async function authenticate(request, clock, required = true) {
    const header = request.headers.get("authorization");
    if (!header) {
      if (!required) return null;
      throw new ApiError(401, "Sessão expirada. Entre novamente.");
    }
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
    if (!match) throw new ApiError(401, "Sessão expirada. Entre novamente.");
    const access = await accessProof();
    const auth = { tokenHash: await digestText(match[1]), adminVersion: access?.version ?? "", now: clock.toISOString() };
    const resolved = await execute("resolve_session", {}, auth);
    if (!resolved.session) throw new ApiError(401, "Sessão expirada. Entre novamente.");
    return { ...auth, session: resolved.session, user: resolved.user ?? null };
  }

  function requireAdmin(auth) {
    if (auth?.session.role !== "admin") throw new ApiError(403, "Acesso não autorizado.");
  }

  async function newSession(role, user, version, clock) {
    const token = toBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const expiresAt = new Date(clock.getTime() + SESSION_HOURS[role] * 3_600_000).toISOString();
    await execute("create_session", {
      tokenHash: await digestText(token), role, userId: user?.id ?? null, version,
      createdAt: clock.toISOString(), expiresAt,
    });
    return { token, expiresAt, ...(role === "admin" ? { admin: true, user: null } : { user: publicUser(user), admin: false }) };
  }

  function normalizeProgress(value) {
    if (!record(value)) throw new ApiError(400, "O progresso salvo precisa estar em um objeto.");
    checkSize(value, PROGRESS_BYTES);
    try { return normalizeClientState(value); }
    catch { throw new ApiError(400, "O progresso enviado contém dados inválidos."); }
  }

  async function dispatch(request, route, clock, ingress) {
    const method = request.method;
    if (route === "/api/health" && method === "GET") return { value: { ok: true, apiVersion: 1 } };
    if (route === "/api/auth/admin/status" && method === "GET") return { value: { configured: Boolean(await accessProof()) } };
    if (route === "/api/auth/me" && method === "GET") {
      const auth = await authenticate(request, clock, false);
      return { value: { user: auth?.user ? publicUser(auth.user) : null, admin: auth?.session.role === "admin" } };
    }
    if (route === "/api/auth/logout" && method === "POST") {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "");
      if (match) await execute("revoke_session", { tokenHash: await digestText(match[1]), now: clock.toISOString() });
      return { value: { ok: true } };
    }
    if (route === "/api/auth/login" && method === "POST") {
      await rate(`login-ingress:${ingress}`, 60, 600, clock);
      const body = await readJson(request, AUTH_BYTES);
      if (typeof body.username !== "string" || !USERNAME.test(body.username.trim()) || typeof body.password !== "string" || !body.password || body.password.length > 120) throw new ApiError(400, "Informe usuário e senha válidos.");
      const handle = normalUsername(body.username);
      await rate(`login-account:${handle}`, 10, 900, clock);
      if (handle === "admin") {
        const access = await accessProof();
        // Keep missing/unconfigured login computationally comparable.
        dummyProof ??= makePasswordProof(crypto.randomUUID());
        const valid = await verifyPassword(body.password, access?.proof ?? await dummyProof);
        checkSignal(request);
        if (!valid || !access) throw new ApiError(401, "Usuário ou senha incorretos.");
        return { value: await newSession("admin", null, access.version, clock) };
      }
      const found = await execute("get_user_by_username", { usernameNormalized: handle });
      dummyProof ??= makePasswordProof(crypto.randomUUID());
      const valid = await verifyPassword(body.password, found.user?.password ?? await dummyProof);
      checkSignal(request);
      if (!valid || !found.user) throw new ApiError(401, "Usuário ou senha incorretos.");
      return { value: await newSession("user", found.user, found.user.sessionVersion, clock) };
    }
    if (route === "/api/auth/register" && method === "POST") {
      await rate(`register-ingress:${ingress}`, 12, 3_600, clock);
      const profile = parseProfile(await readJson(request, AUTH_BYTES));
      const password = await makePasswordProof(profile.password);
      checkSignal(request);
      const created = await execute("create_user", { ...profile, password, createdAt: clock.toISOString() });
      return { status: 201, value: await newSession("user", created.user, created.user.sessionVersion, clock) };
    }
    const auth = await authenticate(request, clock);
    await rate(`session:${auth.tokenHash}`, 300, 60, clock);
    if (route === "/api/auth/profile" && method === "PATCH") {
      if (auth.session.role !== "user" || !auth.user) throw new ApiError(403, "Acesso não autorizado.");
      const body = await readJson(request, AUTH_BYTES);
      const profile = parseProfile(body, false, "newPassword");
      if (profile.usernameNormalized !== auth.user.usernameNormalized || profile.password) {
        await rate(`profile-password:${auth.user.id}`, 10, 900, clock);
        if (typeof body.currentPassword !== "string" || !(await verifyPassword(body.currentPassword, auth.user.password))) throw new ApiError(403, "A senha atual está incorreta.");
      }
      const password = profile.password ? await makePasswordProof(profile.password) : null;
      checkSignal(request);
      const updated = await execute("update_user", {
        userId: auth.user.id, expectedVersion: auth.user.sessionVersion, ...profile,
        password, updatedAt: clock.toISOString(),
      }, auth);
      return { value: await newSession("user", updated.user, updated.user.sessionVersion, clock) };
    }
    if (route === "/api/data" && ["GET", "PUT"].includes(method)) {
      if (auth.session.role !== "user") throw new ApiError(403, "Acesso não autorizado.");
      if (method === "GET") {
        const result = await execute("get_state", { userId: auth.user.id }, auth);
        return { value: { state: result.state ?? null, revision: result.revision ?? null, clientState: result.clientState ?? { schemaVersion: 1 } } };
      }
      const body = await readJson(request, STATE_BYTES + PROGRESS_BYTES + 10_000);
      if (!record(body.state)) throw new ApiError(400, "Os dados do funcionário precisam estar em um objeto.");
      if (!Object.hasOwn(body, "baseRevision") || (body.baseRevision !== null && (typeof body.baseRevision !== "string" || body.baseRevision.length > 120))) throw new ApiError(400, "A versão dos dados é inválida.");
      checkSize(body.state, STATE_BYTES);
      const state = normalizeEmployeeState(body.state);
      if (hasLegacyMarketingDays(body.state.marketingDaily)) {
        const previous = await execute("get_state", { userId: auth.user.id }, auth);
        state.marketingDaily = preserveLegacyMarketingCounts(body.state.marketingDaily, previous.state?.marketingDaily);
        // Keep the caller's original revision: a concurrent update must still
        // conflict rather than be replaced after this compatibility read.
      }
      checkSize(state, STATE_BYTES);
      const clientState = Object.hasOwn(body, "clientState") ? normalizeProgress(body.clientState) : undefined;
      checkSignal(request);
      const result = await execute("save_state", {
        userId: auth.user.id, state, baseRevision: body.baseRevision,
        ...(clientState === undefined ? {} : { clientState }),
        revision: `${clock.toISOString()}|${crypto.randomUUID()}`, updatedAt: clock.toISOString(),
      }, auth);
      if (result.status === "state-conflict") throw new ApiError(409, "Estes dados foram alterados em outro computador. Recarregue antes de salvar.", { revision: result.revision ?? null });
      return { value: { ok: true, revision: result.revision } };
    }
    if (route === "/api/admin/import-local" && method === "POST") {
      requireAdmin(auth);
      await rate(`import:${auth.tokenHash}`, 180, 3_600, clock);
      const body = await readJson(request, IMPORT_BYTES);
      if (typeof body.batchId !== "string" || !/^[a-zA-Z0-9._:-]{8,120}$/.test(body.batchId)
        || !Array.isArray(body.records) || !body.records.length || body.records.length > 120) throw new ApiError(400, "A importação precisa ter uma identificação e até 120 contas.");
      const ids = new Set();
      const records = [];
      for (const item of body.records) {
        if (!record(item) || typeof item.sourceId !== "string" || !/^[a-zA-Z0-9._:-]{1,160}$/.test(item.sourceId) || ids.has(item.sourceId)) throw new ApiError(400, "A identificação de uma conta importada é inválida ou repetida.");
        ids.add(item.sourceId);
        const profile = parseProfile(item, false);
        const password = normalizePasswordProof(item.password);
        if (!password) throw new ApiError(400, "Uma conta contém dados de acesso inválidos.");
        if (item.state !== undefined && item.state !== null && !record(item.state)) throw new ApiError(400, "Os dados de uma conta importada são inválidos.");
        checkSize(item.state ?? {}, STATE_BYTES);
        const state = item.state ? normalizeEmployeeState(item.state) : null;
        const clientState = item.clientState === undefined ? { schemaVersion: 1 } : normalizeProgress(item.clientState);
        const entry = { sourceId: item.sourceId, displayName: profile.displayName, username: profile.username,
          usernameNormalized: profile.usernameNormalized, branch: profile.branch, password, state, clientState };
        records.push({ ...entry, digest: await digestText(JSON.stringify(entry)) });
      }
      checkSignal(request);
      const batchDigest = await digestText(JSON.stringify(records));
      const result = await execute("import_local", { batchId: body.batchId, digest: batchDigest, records, now: clock.toISOString() }, auth);
      return { value: { results: result.results, imported: result.imported, conflicts: result.conflicts } };
    }
    const userMatch = /^\/api\/admin\/users\/([1-9]\d*)$/.exec(route);
    if (route === "/api/admin/users" || userMatch) {
      requireAdmin(auth);
      const userId = userMatch ? Number(userMatch[1]) : null;
      if (userId !== null && !Number.isSafeInteger(userId)) throw new ApiError(404, "Conta não encontrada.");
      if (route === "/api/admin/users" && method === "GET") {
        const result = await execute("list_users", {}, auth);
        return { value: { users: result.users.map(adminUser) } };
      }
      if (route === "/api/admin/users" && method === "POST") {
        const profile = parseProfile(await readJson(request, AUTH_BYTES));
        const password = await makePasswordProof(profile.password);
        checkSignal(request);
        const result = await execute("admin_create_user", { ...profile, password, createdAt: clock.toISOString() }, auth);
        return { status: 201, value: { user: adminUser(result.user) } };
      }
      if (userId !== null && method === "GET") {
        const result = await execute("get_user_detail", { userId }, auth);
        return { value: { user: adminUser(result.user), state: result.user.state ?? null,
          clientState: result.user.clientState ?? { schemaVersion: 1 }, summary: summarizeEmployeeState(result.user.state ?? null) } };
      }
      if (userId !== null && method === "PATCH") {
        const profile = parseProfile(await readJson(request, AUTH_BYTES), false);
        const password = profile.password ? await makePasswordProof(profile.password) : null;
        checkSignal(request);
        const result = await execute("admin_update_user", { userId, ...profile, password, updatedAt: clock.toISOString() }, auth);
        return { value: { user: adminUser(result.user) } };
      }
      if (userId !== null && method === "DELETE") {
        checkSignal(request);
        await execute("delete_user", { userId, now: clock.toISOString() }, auth);
        return { value: { ok: true, id: userId } };
      }
    }
    throw new ApiError(404, "Recurso não encontrado.");
  }

  return async function sharedApi(request) {
    const origin = request.headers.get("origin") ?? "";
    const approved = origins.has(origin);
    const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin", "X-Content-Type-Options": "nosniff" });
    if (approved) headers.set("Access-Control-Allow-Origin", origin);
    function response(value, status = 200) {
      if (value?.retryAfter) headers.set("Retry-After", String(value.retryAfter));
      return Response.json(value, { status, headers });
    }
    try {
      if (!approved) throw new ApiError(403, "Origem não autorizada.");
      if (request.method === "OPTIONS") {
        const preflight = request.headers.get("access-control-request-method") ?? "";
        const requested = (request.headers.get("access-control-request-headers") ?? "").split(",").map((key) => key.trim().toLowerCase()).filter(Boolean);
        if (!METHODS.has(preflight) || requested.some((key) => !["authorization", "content-type"].includes(key))) throw new ApiError(403, "Solicitação não autorizada.");
        headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
        headers.set("Access-Control-Max-Age", "600");
        return new Response(null, { status: 204, headers });
      }
      if (!METHODS.has(request.method)) throw new ApiError(405, "Método não permitido.");
      checkSignal(request);
      const path = new URL(request.url).pathname;
      const route = path.replace(/^\/(?:functions\/v1\/)?mult-portas-api(?=\/|$)/, "");
      const clock = now();
      // Never trust an arbitrary X-Forwarded-For sent by a client. Deployments
      // without a documented trusted gateway address share an aggregate bucket;
      // separate normalized account buckets still protect every login.
      const trusted = typeof getTrustedClientIp === "function" ? getTrustedClientIp(request) : "aggregate";
      const ingress = typeof trusted === "string" && trusted.length <= 200 ? trusted : "aggregate";
      await rate(`ingress:${ingress}`, 1_200, 60, clock);
      const result = await dispatch(request, route, clock, ingress);
      return response(result.value, result.status ?? 200);
    } catch (error) {
      if (error instanceof ApiError) return response({ error: error.message, ...error.extra }, error.status);
      onError({ code: "shared_api_failed", name: error?.name ?? "Error" });
      return response({ error: "Não foi possível acessar os dados compartilhados. Tente novamente." }, 503);
    }
  };
}
