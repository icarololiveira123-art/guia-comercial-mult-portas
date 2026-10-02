// GitHub Pages does not execute the Next.js API routes. This adapter keeps the
// employee workspace usable on one browser only. Client-side login is a local
// account selector, not server-side access control or a safe place for secrets.
const ACCOUNTS_KEY = "mult-portas-pages-accounts-v1";
const SESSION_KEY = "mult-portas-pages-session-v1";
const STATE_PREFIX = "mult-portas-pages-state-v1-";
const ITERATIONS = 210_000;
const USERNAME = /^[a-zA-Z0-9._-]{3,40}$/;
const BRANCHES = new Set(["Araraquara", "São Carlos"]);
const encoder = new TextEncoder();

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function abortIfRequested(signal) {
  if (signal?.aborted) throw new DOMException("A operação foi cancelada.", "AbortError");
}

function getStorage(kind) {
  const storage = globalThis[kind];
  if (!storage) throw new Error("O armazenamento deste navegador está indisponível.");
  return storage;
}

function parseStored(raw, emptyValue) {
  if (raw === null) return emptyValue;
  try {
    return JSON.parse(raw);
  } catch {
    // Never overwrite damaged storage: it may still contain recoverable work.
    throw new Error("Os dados locais não puderam ser lidos. Nada foi alterado.");
  }
}

function accounts() {
  const value = parseStored(getStorage("localStorage").getItem(ACCOUNTS_KEY), []);
  if (!Array.isArray(value)) throw new Error("Os dados locais não puderam ser lidos. Nada foi alterado.");
  return value;
}

function saveAccounts(value) {
  getStorage("localStorage").setItem(ACCOUNTS_KEY, JSON.stringify(value));
}

function currentAccount(all = accounts()) {
  const session = parseStored(getStorage("sessionStorage").getItem(SESSION_KEY), null);
  if (!session || !Number.isSafeInteger(session.id) || typeof session.version !== "string") return null;
  return all.find((account) => account.id === session.id && account.sessionVersion === session.version) ?? null;
}

function publishAccount(account) {
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    branch: account.branch,
  };
}

function normalUsername(value) {
  return value.trim().toLocaleLowerCase("pt-BR");
}

function randomId(all) {
  // The existing React state uses numeric employee ids for storage key scoping.
  let id;
  do {
    const bytes = new Uint32Array(2);
    crypto.getRandomValues(bytes);
    id = (bytes[0] & 0x1fffff) * 0x100000000 + bytes[1];
  } while (id === 0 || all.some((account) => account.id === id));
  return id;
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derivePassword(password, salt, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt,
    iterations,
  }, key, 256));
}

async function passwordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toBase64(salt), hash: toBase64(await derivePassword(password, salt)), iterations: ITERATIONS };
}

async function matchesPassword(password, record) {
  if (!record || typeof record.salt !== "string" || typeof record.hash !== "string"
    || !Number.isSafeInteger(record.iterations) || record.iterations < 100_000 || record.iterations > 1_000_000) return false;
  try {
    const expected = fromBase64(record.hash);
    const actual = await derivePassword(password, fromBase64(record.salt), record.iterations);
    if (expected.length !== actual.length) return false;
    let difference = 0;
    for (let i = 0; i < expected.length; i += 1) difference |= expected[i] ^ actual[i];
    return difference === 0;
  } catch {
    return false;
  }
}

function readBody(init, maxLength, invalidMessage) {
  if (typeof init.body !== "string" || init.body.length > maxLength) {
    return { error: json({ error: init.body?.length > maxLength ? "Os dados enviados ultrapassaram o limite." : invalidMessage }, init.body?.length > maxLength ? 413 : 400) };
  }
  try {
    const value = JSON.parse(init.body);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return { value };
  } catch {
    return { error: json({ error: invalidMessage }, 400) };
  }
}

function storageError(error) {
  const quota = error?.name === "QuotaExceededError";
  return json({ error: quota
    ? "Este navegador não tem espaço para salvar os dados. Libere espaço antes de continuar."
    : "O armazenamento deste navegador está indisponível. Seus dados não foram alterados." }, quota ? 507 : 503);
}

/**
 * Responds with the same JSON shapes as the employee API, wholly in the
 * current browser. Do not use this as authentication for protected resources.
 * Password hashes and private work remain readable/replaceable by scripts or
 * people with access to this browser's origin storage.
 */
export async function localApiFetch(path, init = {}) {
  const signal = init.signal;
  abortIfRequested(signal);
  const route = typeof path === "string" ? path.split("?", 1)[0] : "";
  const method = (init.method ?? "GET").toUpperCase();

  try {
    if (route.startsWith("/api/admin/")) {
      return json({ error: "A gestão de equipe exige um servidor e não está disponível no GitHub Pages." }, 501);
    }

    if (route === "/api/auth/me" && method === "GET") {
      const user = currentAccount();
      return json({ user: user ? publishAccount(user) : null, admin: false });
    }

    if (route === "/api/auth/logout" && method === "POST") {
      getStorage("sessionStorage").removeItem(SESSION_KEY);
      return json({ ok: true });
    }

    if (route === "/api/auth/register" && method === "POST") {
      const parsed = readBody(init, 8_000, "Não foi possível ler o cadastro.");
      if (parsed.error) return parsed.error;
      const { displayName, username, branch, password } = parsed.value;
      if ([displayName, username, branch, password].some((value) => typeof value !== "string")) {
        return json({ error: "Preencha o cadastro com dados válidos." }, 400);
      }
      const name = displayName.trim();
      const handle = username.trim();
      const normalized = normalUsername(handle);
      if (name.length < 2 || name.length > 80) return json({ error: "Informe o nome completo do funcionário." }, 400);
      if (!USERNAME.test(handle)) return json({ error: "O usuário deve ter de 3 a 40 caracteres, sem espaços." }, 400);
      if (normalized === "admin") return json({ error: "Esse usuário já está cadastrado." }, 409);
      if (!BRANCHES.has(branch.trim())) return json({ error: "Selecione Araraquara ou São Carlos." }, 400);
      if (password.length < 8 || password.length > 120) return json({ error: "A senha deve ter pelo menos 8 caracteres." }, 400);
      const all = accounts();
      if (all.some((account) => account.usernameNormalized === normalized)) return json({ error: "Esse usuário já está cadastrado." }, 409);
      const pass = await passwordRecord(password);
      abortIfRequested(signal);
      const account = {
        id: randomId(all), username: handle, usernameNormalized: normalized,
        displayName: name, branch: branch.trim(), password: pass,
        sessionVersion: crypto.randomUUID(),
      };
      // Refresh the list after slow PBKDF2 work to catch another registration.
      const latest = accounts();
      if (latest.some((other) => other.usernameNormalized === normalized)) return json({ error: "Esse usuário já está cadastrado." }, 409);
      while (latest.some((other) => other.id === account.id)) account.id = randomId(latest);
      saveAccounts([...latest, account]);
      getStorage("sessionStorage").setItem(SESSION_KEY, JSON.stringify({ id: account.id, version: account.sessionVersion }));
      return json({ user: publishAccount(account) }, 201);
    }

    if (route === "/api/auth/login" && method === "POST") {
      const parsed = readBody(init, 8_000, "Não foi possível ler o login.");
      if (parsed.error) return parsed.error;
      const { username, password } = parsed.value;
      if (typeof username !== "string" || typeof password !== "string") return json({ error: "Informe usuário e senha válidos." }, 400);
      if (!username.trim() || !password) return json({ error: "Informe usuário e senha." }, 400);
      const account = accounts().find((user) => user.usernameNormalized === normalUsername(username));
      const valid = account ? await matchesPassword(password, account.password) : false;
      abortIfRequested(signal);
      if (!valid) return json({ error: "Usuário ou senha incorretos." }, 401);
      // A profile change in another tab may have invalidated this account.
      const current = accounts().find((user) => user.id === account.id);
      if (!current || current.sessionVersion !== account.sessionVersion) return json({ error: "Tente entrar novamente." }, 409);
      getStorage("sessionStorage").setItem(SESSION_KEY, JSON.stringify({ id: current.id, version: current.sessionVersion }));
      return json({ user: publishAccount(current) });
    }

    if (route === "/api/auth/profile" && method === "PATCH") {
      const all = accounts();
      const account = currentAccount(all);
      if (!account) return json({ error: "Sessão expirada." }, 401);
      const parsed = readBody(init, 8_000, "Não foi possível ler os dados do perfil.");
      if (parsed.error) return parsed.error;
      const source = parsed.value;
      const name = typeof source.displayName === "string" ? source.displayName.trim() : "";
      const handle = typeof source.username === "string" ? source.username.trim() : "";
      const normalized = normalUsername(handle);
      const branch = typeof source.branch === "string" ? source.branch.trim() : "";
      const newPassword = typeof source.newPassword === "string" ? source.newPassword : "";
      const currentPassword = typeof source.currentPassword === "string" ? source.currentPassword : "";
      if (name.length < 2 || name.length > 80) return json({ error: "Informe seu nome completo." }, 400);
      if (!USERNAME.test(handle) || normalized === "admin") return json({ error: "O usuário deve ter de 3 a 40 caracteres, sem espaços." }, 400);
      if (!BRANCHES.has(branch)) return json({ error: "Selecione Araraquara ou São Carlos." }, 400);
      if (newPassword && (newPassword.length < 8 || newPassword.length > 120)) return json({ error: "A nova senha deve ter de 8 a 120 caracteres." }, 400);
      const usernameChanged = normalized !== account.usernameNormalized;
      if ((usernameChanged || newPassword) && !currentPassword) return json({ error: "Informe a senha atual para alterar o usuário ou a senha." }, 400);
      if ((usernameChanged || newPassword) && !(await matchesPassword(currentPassword, account.password))) {
        abortIfRequested(signal);
        return json({ error: "A senha atual está incorreta." }, 401);
      }
      abortIfRequested(signal);
      const latest = accounts();
      const old = currentAccount(latest);
      if (!old || old.sessionVersion !== account.sessionVersion) return json({ error: "Sessão expirada." }, 401);
      if (latest.some((other) => other.id !== account.id && other.usernameNormalized === normalized)) {
        return json({ error: "Esse usuário já está cadastrado." }, 409);
      }
      const password = newPassword ? await passwordRecord(newPassword) : old.password;
      abortIfRequested(signal);
      const updated = {
        ...old, displayName: name, username: handle, usernameNormalized: normalized,
        branch, password, sessionVersion: newPassword ? crypto.randomUUID() : old.sessionVersion,
      };
      saveAccounts(latest.map((entry) => entry.id === updated.id ? updated : entry));
      if (newPassword) getStorage("sessionStorage").setItem(SESSION_KEY, JSON.stringify({ id: updated.id, version: updated.sessionVersion }));
      return json({ user: publishAccount(updated) });
    }

    if (route === "/api/data" && (method === "GET" || method === "PUT")) {
      const account = currentAccount();
      if (!account) return json({ error: "Sessão expirada." }, 401);
      const storage = getStorage("localStorage");
      const key = `${STATE_PREFIX}${account.id}`;
      const stored = parseStored(storage.getItem(key), null);
      if (stored !== null && (!stored || typeof stored !== "object" || typeof stored.revision !== "string" || !stored.state)) {
        return json({ error: "Os dados salvos não puderam ser lidos. Nada foi alterado." }, 503);
      }
      if (method === "GET") return json({ state: stored?.state ?? null, revision: stored?.revision ?? null });
      const parsed = readBody(init, 450_000, "Dados inválidos.");
      if (parsed.error) return parsed.error;
      const { state, baseRevision } = parsed.value;
      if (!state || typeof state !== "object" || Array.isArray(state)) {
        return json({ error: "Os dados do funcionário precisam estar em um objeto." }, 400);
      }
      if (baseRevision !== undefined && baseRevision !== null && typeof baseRevision !== "string") {
        return json({ error: "A versão dos dados é inválida." }, 400);
      }
      const stateJson = JSON.stringify(state);
      if (stateJson.length > 400_000) return json({ error: "Os dados salvos ultrapassaram o limite." }, 413);
      if (Object.hasOwn(parsed.value, "baseRevision") && (baseRevision ?? null) !== (stored?.revision ?? null)) {
        // Treat a repeated save of the same state as idempotent.
        if (stored && JSON.stringify(stored.state) === stateJson) return json({ ok: true, revision: stored.revision });
        return json({ error: "Estes dados foram alterados em outra aba. Recarregue antes de salvar.", revision: stored?.revision ?? null }, 409);
      }
      abortIfRequested(signal);
      const revision = `${new Date().toISOString()}|${crypto.randomUUID()}`;
      storage.setItem(key, JSON.stringify({ state, revision }));
      return json({ ok: true, revision });
    }

    return json({ error: "Este recurso requer um servidor e não está disponível nesta versão local." }, 501);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return storageError(error);
  }
}
