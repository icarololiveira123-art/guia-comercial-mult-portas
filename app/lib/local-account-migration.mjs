import { normalizeEmployeeState } from "../api/data/state-contract.mjs";
import { clientProgressStorageKeys, collectClientProgress, migrateClientProgress } from "./client-progress.mjs";

// This is an authenticated, explicit transfer of legacy browser accounts.
// Legacy credentials, sessions, saved work and progress are never modified.
const ACCOUNTS_KEY = "mult-portas-pages-accounts-v1";
const DEVICE_KEY = "mult-portas-local-import-device-v1";
const STATE_PREFIX = "mult-portas-pages-state-v1-";
const MAX_STATE_BYTES = 400_000;
const MAX_ACCOUNTS_BYTES = 1_000_000;
const USERNAME = /^[a-zA-Z0-9._-]{3,40}$/;
const BRANCHES = new Set(["Araraquara", "São Carlos"]);
const encoder = new TextEncoder();

/** @typedef {{getItem:(key:string)=>string|null,setItem:(key:string,value:string)=>void,removeItem?:(key:string)=>void}} MigrationStorage */
/** @typedef {(path:string,init?:RequestInit)=>Promise<Response>} MigrationRequest */
/** @typedef {{signal?:AbortSignal}} MigrationOptions */

function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function handle(value) { return value.trim().toLocaleLowerCase("pt-BR"); }
function json(value, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
function checkAbort(signal) { if (signal?.aborted) throw new DOMException("A operação foi cancelada.", "AbortError"); }
function bytes(value) { return encoder.encode(value).byteLength; }
function storageValue(storage) {
  const value = storage ?? globalThis.localStorage;
  if (!value || typeof value.getItem !== "function" || typeof value.setItem !== "function") throw new Error("storage unavailable");
  return value;
}
function parse(raw, limit) {
  if (bytes(raw) > limit) throw new Error("oversized local record");
  return JSON.parse(raw);
}
function accounts(storage) {
  const raw = storage.getItem(ACCOUNTS_KEY);
  if (raw === null) return [];
  const value = parse(raw, MAX_ACCOUNTS_BYTES);
  if (!Array.isArray(value)) throw new Error("damaged local accounts");
  return value;
}
function base64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}
function decoded(value) { return Uint8Array.from(atob(value), (letter) => letter.charCodeAt(0)); }
function passwordProof(value) {
  if (!record(value) || value.iterations !== 210_000
    || value.version !== undefined && value.version !== "pbkdf2-sha256-v1"
    || typeof value.salt !== "string" || typeof value.hash !== "string") return null;
  try {
    const salt = decoded(value.salt);
    const hash = decoded(value.hash);
    if (salt.length !== 16 || hash.length !== 32 || base64(salt) !== value.salt || base64(hash) !== value.hash) return null;
    return { version: "pbkdf2-sha256-v1", salt: value.salt, hash: value.hash, iterations: value.iterations };
  } catch { return null; }
}
function profile(value) {
  if (!record(value) || !Number.isSafeInteger(value.id) || value.id <= 0
    || typeof value.username !== "string" || !USERNAME.test(value.username.trim())
    || handle(value.username) === "admin" || typeof value.displayName !== "string"
    || value.displayName.trim().length < 2 || value.displayName.trim().length > 80
    || !BRANCHES.has(value.branch)
    || value.usernameNormalized !== undefined && value.usernameNormalized !== handle(value.username)) return null;
  const password = passwordProof(value.password);
  return password ? { oldId: value.id, username: value.username.trim(), displayName: value.displayName.trim(), branch: value.branch, password } : null;
}

// The state normalizer performs approved legacy conversions. Reject damaged
// shapes and any conversion that would silently drop/truncate saved content.
function checkPreserved(source, normalized, path = "") {
  if (source === undefined) return;
  if (normalized === null && source !== null && !(typeof source === "string" && !source.trim())) throw new Error("damaged local value");
  if (Array.isArray(normalized)) {
    const original = Array.isArray(source) ? source : path === "factory" && record(source) ? source.items : null;
    if (!Array.isArray(original) || original.length > normalized.length) throw new Error("truncated local collection");
    for (let index = 0; index < original.length; index++) {
      const item = original[index];
      const key = record(item) && typeof item.id === "string" ? "id" : record(item) && typeof item.date === "string" ? "date" : null;
      const next = key ? normalized.find((entry) => record(entry) && entry[key] === item[key].trim()) : normalized[index];
      checkPreserved(item, next, `${path}.${index}`);
    }
    return;
  }
  if (record(normalized)) {
    if (!record(source)) throw new Error("damaged local object");
    for (const [key, next] of Object.entries(normalized)) {
      if (key === "schemaVersion" || !Object.hasOwn(source, key)) continue;
      // The existing app intentionally retires the full expired default campaign.
      if (path === "messages.fair" && ["eventDate", "eventTime", "discount"].includes(key)
        && source.eventDate === "sábado, 29/08" && source.eventTime === "das 9h às 17h" && source.discount === "até 60% OFF") continue;
      checkPreserved(source[key], next, path ? `${path}.${key}` : key);
    }
    return;
  }
  if (typeof source === "string" && typeof normalized === "string") {
    const trimmed = source.trim();
    if (trimmed.length > normalized.length && trimmed.startsWith(normalized)) throw new Error("truncated local text");
  } else if (typeof source === "number" && typeof normalized === "number") {
    if (!Number.isFinite(source) || source < 0 || normalized < source) throw new Error("invalid local number");
  } else if (source !== null && normalized !== null && typeof source !== typeof normalized) {
    // Earlier factory exports stored prices as numbers, which normalize to text.
    if (!(typeof source === "number" && typeof normalized === "string" && String(source) === normalized)) throw new Error("damaged local value");
  }
}
function safeState(value) {
  if (!record(value) || bytes(JSON.stringify(value)) > MAX_STATE_BYTES) throw new Error("damaged local state");
  const normalized = normalizeEmployeeState(value);
  checkPreserved(value, normalized);
  if (bytes(JSON.stringify(normalized)) > MAX_STATE_BYTES) throw new Error("oversized normalized state");
  return normalized;
}
function hasProgress(value) { return value.resume !== undefined || value.brands && Object.keys(value.brands).length > 0; }
function progress(oldId, storage) {
  // The portable collector skips damaged entries. For account migration report
  // them explicitly instead of declaring an incomplete transfer successful.
  for (const key of clientProgressStorageKeys(oldId, { scope: "local" })) {
    const raw = storage.getItem(key);
    if (raw === null) continue;
    const isolated = collectClientProgress(oldId, { getItem: (candidate) => candidate === key ? raw : null, setItem() {} }, { scope: "local" });
    if (!hasProgress(isolated)) throw new Error("damaged local progress");
  }
  return collectClientProgress(oldId, storage, { scope: "local" });
}
function snapshot(account, storage) {
  const committedRaw = storage.getItem(`${STATE_PREFIX}${account.oldId}`);
  let committed = null;
  if (committedRaw !== null) {
    const value = parse(committedRaw, MAX_STATE_BYTES + 8_000);
    if (!record(value) || typeof value.revision !== "string" || !value.revision) throw new Error("damaged local revision");
    committed = { state: safeState(value.state), date: Date.parse(value.revision.split("|", 1)[0]) };
  }
  const pendingRaw = storage.getItem(`mult-portas-guia-user-${account.oldId}-pending-state-v1`);
  let pending = null;
  if (pendingRaw !== null) {
    const value = parse(pendingRaw, MAX_STATE_BYTES + 8_000);
    if (!record(value) || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))
      || value.baseRevision !== null && typeof value.baseRevision !== "string") throw new Error("damaged local backup");
    pending = { state: safeState(value.state), date: Date.parse(value.updatedAt) };
  }
  return {
    state: pending && (!committed || !Number.isFinite(committed.date) || pending.date >= committed.date) ? pending.state : committed?.state ?? null,
    clientState: progress(account.oldId, storage),
  };
}
async function matches(password, proof, signal) {
  checkAbort(signal);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: decoded(proof.salt), iterations: proof.iterations }, key, 256));
  checkAbort(signal);
  const expected = decoded(proof.hash);
  let different = actual.length ^ expected.length;
  for (let index = 0; index < actual.length; index++) different |= actual[index] ^ expected[index];
  return different === 0;
}
function init(method, body, signal) {
  return { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) };
}
async function responseJson(response) {
  const raw = await response.text();
  if (bytes(raw) > 1_000_000) throw new Error("oversized response");
  const value = JSON.parse(raw);
  if (!record(value)) throw new Error("invalid response");
  return value;
}
function validReturnedUser(value, account) {
  return record(value) && Number.isSafeInteger(value.id) && value.id > 0
    && typeof value.username === "string" && handle(value.username) === handle(account.username)
    && value.displayName === account.displayName && value.branch === account.branch;
}

/**
 * Call only after a shared employee login returned 401. This verifies the exact
 * legacy proof before registration; existing shared usernames are never replaced.
 * @param {MigrationRequest} request
 * @param {{username:string,password:string}} credentials
 * @param {MigrationStorage} [storage]
 * @param {MigrationOptions} [options]
 * @returns {Promise<Response|null>}
 */
export async function migrateLegacyEmployeeLogin(request, { username, password }, storage, { signal } = {}) {
  checkAbort(signal);
  if (typeof username !== "string" || !USERNAME.test(username.trim()) || handle(username) === "admin"
    || typeof password !== "string" || password.length < 8 || password.length > 120) return null;
  let currentStorage;
  let account;
  try {
    currentStorage = storageValue(storage);
    const all = accounts(currentStorage);
    const matched = all.filter((entry) => record(entry) && typeof entry.username === "string" && handle(entry.username) === handle(username));
    if (matched.length !== 1) return null;
    account = profile(matched[0]);
    if (!account || all.filter((entry) => record(entry) && entry.id === account.oldId).length !== 1) return null;
  } catch { return json({ error: "Os acessos deste navegador precisam ser recuperados. Nada anterior foi alterado." }, 503); }
  if (!(await matches(password, account.password, signal))) return null;
  let saved;
  try { saved = snapshot(account, currentStorage); }
  catch { return json({ error: "Os dados deste navegador precisam ser recuperados antes da transferência. Nada anterior foi alterado." }, 503); }
  checkAbort(signal);
  const response = await request("/api/auth/register", init("POST", {
    username: account.username, displayName: account.displayName, branch: account.branch, password,
  }, signal));
  checkAbort(signal);
  if (response.status === 409) return json({ error: "Não foi possível transferir este acesso automaticamente. Os dados deste navegador foram preservados.", migrationConflict: true }, 409);
  if (!response.ok) return response;
  if (response.status !== 201) return json({ error: "O servidor não confirmou a criação do acesso. Os dados anteriores foram preservados." }, 502);
  let payload;
  try { payload = await responseJson(response); }
  catch { return json({ error: "O servidor não confirmou os dados do acesso. Os dados anteriores foram preservados." }, 502); }
  checkAbort(signal);
  if (payload.admin === true || !validReturnedUser(payload.user, account)) return json({ error: "O servidor não confirmou o acesso correto. Os dados anteriores foram preservados." }, 502);
  const pendingKey = `mult-portas-shared-user-${payload.user.id}-pending-state-v1`;
  const pending = { state: saved.state ?? normalizeEmployeeState(null), baseRevision: null, updatedAt: new Date().toISOString(), clientState: saved.clientState };
  const serialized = JSON.stringify(pending);
  let queued = false;
  try {
    checkAbort(signal);
    if (currentStorage.getItem(pendingKey) === null) {
      currentStorage.setItem(pendingKey, serialized);
      queued = currentStorage.getItem(pendingKey) === serialized;
    }
    migrateClientProgress(account.oldId, payload.user.id, currentStorage, { fromScope: "local", toScope: "shared" });
  } catch (error) { if (error?.name === "AbortError") throw error; }
  let synced = false;
  let revision;
  if (queued) {
    try {
      checkAbort(signal);
      const result = await request("/api/data", init("PUT", { state: pending.state, baseRevision: null, clientState: pending.clientState }, signal));
      checkAbort(signal);
      if (result.ok) {
        const acknowledgement = await responseJson(result);
        checkAbort(signal);
        if (acknowledgement.ok === true && typeof acknowledgement.revision === "string" && acknowledgement.revision.length > 0 && acknowledgement.revision.length <= 200) {
          synced = true;
          revision = acknowledgement.revision;
          // Remove only our exact acknowledged shared queue entry. Legacy keys
          // and a newer queued edit remain untouched.
          if (currentStorage.getItem(pendingKey) === serialized) currentStorage.removeItem?.(pendingKey);
        }
      }
    } catch (error) { if (error?.name === "AbortError") throw error; }
  }
  return json({ user: { id: payload.user.id, username: payload.user.username, displayName: payload.user.displayName, branch: payload.user.branch },
    ...(typeof payload.expiresAt === "string" ? { expiresAt: payload.expiresAt } : {}),
    migrationPending: !synced, migrationStatus: synced ? "synced" : "pending",
    ...(revision ? { revision } : {}),
    ...(!synced ? { migrationWarning: "O acesso foi transferido, mas os dados ainda aguardam confirmação de salvamento. Os originais deste navegador foram preservados." } : {}),
  }, response.status);
}

function deviceId(storage) {
  const original = storage.getItem(DEVICE_KEY);
  if (original !== null) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(original)) throw new Error("damaged migration ID");
    return original;
  }
  const created = crypto.randomUUID();
  storage.setItem(DEVICE_KEY, created);
  if (storage.getItem(DEVICE_KEY) !== created) throw new Error("migration ID unavailable");
  return created;
}
function notify(callback, value) { try { callback?.(value); } catch { /* A UI callback cannot change the import result. */ } }

/**
 * Explicit privileged import. Verify the remote role before reading any local
 * account or credential. One record per request bounds payloads and permits safe
 * retries. No server conflict or failed request can overwrite a shared account.
 * @param {MigrationRequest} request
 * @param {MigrationStorage} [storage]
 * @param {(progress:{processed:number,total:number,result:object})=>void} [onProgress]
 * @param {MigrationOptions} [options]
 */
export async function importLocalAccounts(request, storage, onProgress, { signal } = {}) {
  const summary = { total: 0, processed: 0, imported: 0, alreadyImported: 0, conflicts: 0, skipped: 0, failed: 0, remaining: 0, results: [], mappings: [], error: null };
  checkAbort(signal);
  let authorized;
  try {
    const response = await request("/api/auth/me", { method: "GET", ...(signal ? { signal } : {}) });
    checkAbort(signal);
    authorized = response.ok && await responseJson(response);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
  }
  if (!authorized || authorized.admin !== true || authorized.user != null) {
    summary.error = "O acesso atual não permite transferir as contas deste navegador.";
    return summary;
  }
  let all;
  let currentStorage;
  let device;
  try {
    checkAbort(signal);
    currentStorage = storageValue(storage);
    all = accounts(currentStorage);
    summary.total = all.length;
    if (!all.length) return summary;
    device = deviceId(currentStorage);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    summary.error = "As contas locais não puderam ser lidas com segurança. Nada anterior foi alterado.";
    summary.remaining = summary.total;
    return summary;
  }
  for (const raw of all) {
    checkAbort(signal);
    const username = record(raw) && typeof raw.username === "string" ? raw.username.slice(0, 40) : "Conta local inválida";
    const account = profile(raw);
    let saved;
    try {
      if (!account || all.filter((entry) => record(entry) && entry.id === account.oldId).length !== 1
        || all.filter((entry) => record(entry) && typeof entry.username === "string" && handle(entry.username) === handle(account.username)).length !== 1) throw new Error("ambiguous local account");
      saved = snapshot(account, currentStorage);
    } catch {
      const result = { username, status: "skipped", reason: "Dados locais inválidos, incompletos ou acima do limite; os originais foram preservados." };
      summary.results.push(result);
      summary.skipped += 1;
      summary.processed += 1;
      notify(onProgress, { processed: summary.processed, total: summary.total, result });
      continue;
    }
    const sourceId = `${device}:${account.oldId}`;
    try {
      checkAbort(signal);
      const response = await request("/api/admin/import-local", init("POST", { batchId: sourceId, records: [{
        sourceId, username: account.username, displayName: account.displayName, branch: account.branch,
        password: account.password, state: saved.state, clientState: saved.clientState,
      }] }, signal));
      checkAbort(signal);
      if (!response.ok) throw new Error("import rejected");
      const payload = await responseJson(response);
      checkAbort(signal);
      const result = Array.isArray(payload.results) && payload.results.length === 1 ? payload.results[0] : null;
      if (!record(result) || result.sourceId !== sourceId || typeof result.username !== "string" || handle(result.username) !== handle(account.username)
        || !["imported", "already-imported", "conflict"].includes(result.status)
        || result.status !== "conflict" && (!Number.isSafeInteger(result.userId) || result.userId <= 0)) throw new Error("invalid import mapping");
      const clean = { username: account.username, status: result.status, oldId: account.oldId, ...(result.status === "conflict" ? {} : { userId: result.userId }) };
      summary.results.push(clean);
      summary.processed += 1;
      if (result.status === "conflict") summary.conflicts += 1;
      else {
        if (result.status === "imported") summary.imported += 1;
        else summary.alreadyImported += 1;
        summary.mappings.push({ sourceId, oldId: account.oldId, userId: result.userId, username: account.username });
        migrateClientProgress(account.oldId, result.userId, currentStorage, { fromScope: "local", toScope: "shared" });
      }
      notify(onProgress, { processed: summary.processed, total: summary.total, result: clean });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      summary.failed += 1;
      summary.processed += 1;
      const result = { username: account.username, status: "failed", reason: "O servidor não confirmou a transferência; os originais foram preservados." };
      summary.results.push(result);
      summary.error = "A transferência foi interrompida. Entre novamente e tente transferir as contas restantes.";
      notify(onProgress, { processed: summary.processed, total: summary.total, result });
      break;
    }
  }
  summary.remaining = summary.total - summary.processed;
  return summary;
}
