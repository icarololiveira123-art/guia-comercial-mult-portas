// Shared sessions belong to this tab and this API endpoint. Existing browser
// accounts and saved work are never read, removed, or used as a network fallback.
export const SHARED_SESSION_KEY = "mult-portas-shared-session-v1";

const API_PREFIX = "/functions/v1/";
const PUBLIC_ROUTES = new Set([
  "/api/auth/login", "/api/auth/register", "/api/auth/admin/status",
]);
const AUTH_ROUTES = new Set(["/api/auth/login", "/api/auth/register"]);
const MAX_RESPONSE_LENGTH = 2_000_000;
const BRANCHES = new Set(["Araraquara", "São Carlos"]);

function json(value, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function abortError() {
  return new DOMException("A operação foi cancelada porque o acesso foi alterado.", "AbortError");
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw new DOMException("A operação foi cancelada.", "AbortError");
}

/**
 * Accept only the supported Edge function location. Local development requires
 * an explicit opt-in; neither configuration nor request paths can add an origin.
 * @param {string} baseUrl
 * @param {{allowLocalhost?: boolean}} [options]
 */
export function validateSharedApiBase(baseUrl, { allowLocalhost = false } = {}) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new Error("O endereço do serviço de acesso não foi configurado.");
  }
  const supplied = baseUrl.trim();
  let url;
  try { url = new URL(supplied); } catch {
    throw new Error("O endereço do serviço de acesso é inválido.");
  }
  const supportedHost = /^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname);
  const localhost = allowLocalhost && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const path = url.pathname.replace(/\/$/, "");
  const supportedPath = /^\/functions\/v1\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(path);
  const directPath = /^https?:\/\/[^/?#\\]+\/functions\/v1\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\/?$/i.test(supplied);
  if (url.username || url.password || url.search || url.hash || !supportedPath || !directPath
    || /[\u0000-\u0020\u007f]/.test(supplied)
    || !(supportedHost && url.protocol === "https:" && !url.port)
      && !(localhost && ["http:", "https:"].includes(url.protocol))) {
    throw new Error("O endereço do serviço de acesso não é permitido.");
  }
  url.pathname = path;
  return url.href;
}

function validUser(user) {
  return Boolean(user && typeof user === "object" && !Array.isArray(user)
    && Number.isSafeInteger(user.id) && user.id > 0
    && typeof user.username === "string" && user.username.length >= 3 && user.username.length <= 40
    && typeof user.displayName === "string" && user.displayName.length >= 2 && user.displayName.length <= 80
    && BRANCHES.has(user.branch));
}

function validToken(token) {
  // Bearer b64token syntax, including opaque UUID/base64url tokens. Never allow
  // whitespace/control characters to become request headers.
  return typeof token === "string" && token.length > 0 && token.length <= 4096
    && /^[A-Za-z0-9._~+/-]+=*$/.test(token);
}

function sessionIdentity(payload) {
  if (payload.admin === true && (payload.user === undefined || payload.user === null)) {
    return { admin: true, userId: null };
  }
  if (payload.admin !== true && validUser(payload.user)) {
    return { admin: false, userId: payload.user.id };
  }
  return null;
}

function storageError() {
  return json({ error: "Não foi possível guardar o acesso nesta aba. Seus dados anteriores foram preservados." }, 503);
}

function sanitizedPayload(payload) {
  const clean = { ...payload };
  delete clean.token;
  delete clean.access_token;
  delete clean.refresh_token;
  return clean;
}

/**
 * A fetch-compatible adapter for the shared API; this never uses browser cookies.
 * @param {{baseUrl: string, fetchImpl?: typeof fetch, storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">, allowLocalhost?: boolean}} options
 * @returns {(path: string, init?: RequestInit) => Promise<Response>}
 */
export function createSharedApiFetch({ baseUrl, fetchImpl, storage, allowLocalhost = false }) {
  const endpoint = validateSharedApiBase(baseUrl, { allowLocalhost });
  const endpointUrl = new URL(endpoint);
  const networkFetch = fetchImpl ?? globalThis.fetch;
  let generation = 0;

  function sessionStorage() {
    const current = storage ?? globalThis.sessionStorage;
    if (!current || typeof current.getItem !== "function" || typeof current.setItem !== "function"
      || typeof current.removeItem !== "function") throw new Error("storage unavailable");
    return current;
  }

  function snapshot() {
    const currentStorage = sessionStorage();
    const raw = currentStorage.getItem(SHARED_SESSION_KEY);
    if (raw === null) return { storage: currentStorage, raw, session: null };
    let value;
    try { value = JSON.parse(raw); } catch { throw new Error("invalid stored session"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid stored session");
    // A session for another endpoint is not attached, overwritten, or erased.
    if (value.endpoint !== endpoint) return { storage: currentStorage, raw, session: null };
    if (!validToken(value.token) || typeof value.generation !== "string" || !value.generation
      || typeof value.admin !== "boolean"
      || (value.admin ? value.userId !== null : !Number.isSafeInteger(value.userId) || value.userId <= 0)
      || (value.workspaceUserId !== undefined && (!value.admin || !Number.isSafeInteger(value.workspaceUserId) || value.workspaceUserId <= 0))) {
      throw new Error("invalid stored session");
    }
    return { storage: currentStorage, raw, session: value };
  }

  function assertCurrent(requestGeneration, captured, signal) {
    assertNotAborted(signal);
    if (requestGeneration !== generation || captured.storage.getItem(SHARED_SESSION_KEY) !== captured.raw) {
      throw abortError();
    }
  }

  return async function sharedApiFetch(path, init = {}) {
    const signal = init.signal;
    assertNotAborted(signal);
    if (typeof path !== "string" || !/^\/api\/[a-zA-Z0-9/_-]+(?:\?[^#]*)?$/.test(path)
      || path.includes("\\")) {
      return json({ error: "O endereço deste recurso é inválido." }, 400);
    }
    const route = path.split("?", 1)[0];
    const method = (init.method ?? "GET").toUpperCase();
    const authenticating = AUTH_ROUTES.has(route) && method === "POST";
    const workspaceMatch = /^\/api\/admin\/users\/([1-9]\d*)\/access$/.exec(route);
    const openingWorkspace = Boolean(workspaceMatch && method === "POST");
    const returningToPanel = route === "/api/admin/access/end" && method === "POST";
    // An older login cannot win a race with the most recent login attempt, and
    // outstanding account reads/saves cannot update the newly selected account.
    if (authenticating || openingWorkspace || returningToPanel) generation += 1;
    const requestGeneration = generation;
    let captured;
    try { captured = snapshot(); } catch { return storageError(); }

    if (!captured.session && !PUBLIC_ROUTES.has(route)) {
      if (route === "/api/auth/me" && method === "GET") return json({ user: null, admin: false });
      if (route === "/api/auth/logout" && method === "POST") return json({ ok: true });
      return json({ error: "Sessão expirada. Entre novamente." }, 401);
    }

    if ((openingWorkspace || returningToPanel) && captured.session?.admin !== true) {
      return json({ error: "Acesso não autorizado." }, 403);
    }
    if (openingWorkspace && captured.session.workspaceUserId !== undefined) {
      return json({ error: "Volte ao painel antes de abrir outro espaço." }, 409);
    }
    let networkPath = path;
    const workspaceUserId = captured.session?.workspaceUserId;
    if (workspaceUserId !== undefined) {
      if (route === "/api/data") networkPath = path.replace(route, `/api/admin/users/${workspaceUserId}/workspace`);
      if (route === "/api/auth/me" && method === "GET") networkPath = `/api/admin/users/${workspaceUserId}/access`;
    }

    const target = new URL(`${endpoint}${networkPath}`);
    if (target.origin !== endpointUrl.origin || !target.pathname.startsWith(`${endpointUrl.pathname}/api/`)
      || !endpointUrl.pathname.startsWith(API_PREFIX)) {
      return json({ error: "O endereço deste recurso não é permitido." }, 400);
    }
    let headers;
    try {
      headers = new Headers(init.headers);
      headers.delete("Authorization");
      if (captured.session && !PUBLIC_ROUTES.has(route)) headers.set("Authorization", `Bearer ${captured.session.token}`);
      headers.set("Accept", "application/json");
    } catch {
      return json({ error: "Não foi possível preparar a solicitação." }, 400);
    }

    let response;
    try {
      response = await networkFetch(target.href, {
        ...init, method, headers, credentials: "omit", redirect: "error",
        mode: "cors", cache: "no-store", referrerPolicy: "no-referrer",
      });
      assertCurrent(requestGeneration, captured, signal);
    } catch (error) {
      assertNotAborted(signal);
      if (error?.name === "AbortError") throw error;
      try { assertCurrent(requestGeneration, captured, signal); } catch (currentError) {
        if (currentError?.name === "AbortError") throw currentError;
        return storageError();
      }
      return json({ error: "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente." }, 503);
    }

    // Fetch is configured to reject redirects before a second request. Also
    // reject redirect-shaped results from an injected/custom fetch transport.
    if (response.redirected || response.type === "opaqueredirect" || response.status >= 300 && response.status < 400) {
      return json({ error: "O servidor respondeu com um endereço inesperado. Tente novamente." }, 502);
    }
    if (response.url) {
      let responseUrl;
      try { responseUrl = new URL(response.url); } catch {
        return json({ error: "O servidor respondeu com um endereço inválido." }, 502);
      }
      if (responseUrl.origin !== endpointUrl.origin || !responseUrl.pathname.startsWith(`${endpointUrl.pathname}/api/`)) {
        return json({ error: "O servidor respondeu com um endereço inesperado." }, 502);
      }
    }

    let payload;
    try {
      const contentLength = response.headers.get("Content-Length");
      if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_LENGTH) throw new Error("large response");
      const raw = await response.text();
      assertCurrent(requestGeneration, captured, signal);
      if (raw.length > MAX_RESPONSE_LENGTH) throw new Error("large response");
      payload = JSON.parse(raw);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid response");
    } catch (error) {
      assertNotAborted(signal);
      if (error?.name === "AbortError") throw error;
      try { assertCurrent(requestGeneration, captured, signal); } catch (currentError) {
        if (currentError?.name === "AbortError") throw currentError;
        return storageError();
      }
      return json({ error: "O servidor enviou uma resposta inválida. Tente novamente." }, response.ok ? 502 : response.status);
    }

    if (response.status === 401 && !PUBLIC_ROUTES.has(route) && route !== "/api/auth/logout") {
      if (captured.session) {
        try {
          assertCurrent(requestGeneration, captured, signal);
          captured.storage.removeItem(SHARED_SESSION_KEY);
          generation += 1;
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          return storageError();
        }
      }
      if (route === "/api/auth/me" && method === "GET") return json({ user: null, admin: false });
    }

    const restoringPanel = route === "/api/auth/me" && method === "GET" && workspaceUserId !== undefined
      && payload.admin === true && payload.user === null && payload.workspaceAccess === false;
    if (response.ok && route === "/api/auth/me" && method === "GET" && workspaceUserId !== undefined && !restoringPanel
      && !(payload.workspaceAccess === true && payload.admin === false && validUser(payload.user) && payload.user.id === workspaceUserId)) {
      return json({ error: "O servidor enviou dados de outra conta. Volte ao painel e tente novamente." }, 502);
    }
    if (response.ok && (openingWorkspace || returningToPanel || restoringPanel)) {
      const validIdentity = openingWorkspace
        ? payload.workspaceAccess === true && payload.admin === false && validUser(payload.user) && payload.user.id === Number(workspaceMatch[1])
        : payload.workspaceAccess === false && payload.admin === true && payload.user === null;
      if (!validIdentity || captured.session?.admin !== true) {
        return json({ error: "O servidor enviou dados de acesso inválidos. Tente novamente." }, 502);
      }
      try {
        assertCurrent(requestGeneration, captured, signal);
        const next = { ...captured.session, generation: crypto.randomUUID() };
        if (openingWorkspace) next.workspaceUserId = payload.user.id;
        else delete next.workspaceUserId;
        captured.storage.setItem(SHARED_SESSION_KEY, JSON.stringify(next));
        generation += 1;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        return storageError();
      }
    }

    if (response.ok && (authenticating || route === "/api/auth/profile" && method === "PATCH")) {
      const identity = sessionIdentity(payload);
      // The server rotates every successful profile update, including a name
      // or branch change. Its fresh token must replace the revoked old session.
      if (!identity || !validToken(payload.token)
        || route === "/api/auth/profile" && (identity.admin || identity.userId !== captured.session?.userId)) {
        return json({ error: "O servidor enviou dados de acesso inválidos. Tente novamente." }, 502);
      }
      if (payload.token !== undefined) {
        if (payload.expiresAt !== undefined && (typeof payload.expiresAt !== "string" || !Number.isFinite(Date.parse(payload.expiresAt)))) {
          return json({ error: "O servidor enviou uma validade de acesso inválida." }, 502);
        }
        try {
          assertCurrent(requestGeneration, captured, signal);
          const session = {
            endpoint, token: payload.token, generation: crypto.randomUUID(), ...identity,
            ...(payload.expiresAt === undefined ? {} : { expiresAt: payload.expiresAt }),
          };
          captured.storage.setItem(SHARED_SESSION_KEY, JSON.stringify(session));
          generation += 1;
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          return storageError();
        }
      }
    }

    if (response.ok && route === "/api/auth/logout" && method === "POST") {
      if (payload.ok !== true) return json({ error: "O servidor não confirmou a saída. Tente novamente." }, 502);
      try {
        assertCurrent(requestGeneration, captured, signal);
        if (captured.session) captured.storage.removeItem(SHARED_SESSION_KEY);
        generation += 1;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        return storageError();
      }
    }

    const clean = sanitizedPayload(payload);
    if (!response.ok && (typeof clean.error !== "string" || !clean.error.trim())) {
      clean.error = response.status === 401 ? "Sessão expirada. Entre novamente."
        : "Não foi possível concluir a solicitação. Tente novamente.";
    }
    return json(clean, response.status);
  };
}
