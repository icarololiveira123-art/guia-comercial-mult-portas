import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("auth-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

function executionContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

async function requestJson(worker, path, init = {}) {
  const response = await worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    executionContext(),
  );
  const raw = await response.text();
  assert.ok(raw.trim(), `${path} returned an empty response`);
  return { response, body: JSON.parse(raw) };
}

test("auth and employee-data errors always return JSON", async () => {
  const worker = await loadWorker();
  const jsonHeaders = { "Content-Type": "application/json" };

  const invalidRegister = await requestJson(worker, "/api/auth/register", {
    method: "POST",
    headers: jsonHeaders,
    body: "null",
  });
  assert.equal(invalidRegister.response.status, 400);
  assert.equal(invalidRegister.body.error, "Não foi possível ler o cadastro.");

  const invalidLogin = await requestJson(worker, "/api/auth/login", {
    method: "POST",
    headers: jsonHeaders,
    body: "[]",
  });
  assert.equal(invalidLogin.response.status, 400);
  assert.equal(invalidLogin.body.error, "Não foi possível ler o login.");

  const unauthenticatedData = await requestJson(worker, "/api/data");
  assert.equal(unauthenticatedData.response.status, 401);
  assert.equal(unauthenticatedData.body.error, "Sessão expirada.");

  const logout = await requestJson(worker, "/api/auth/logout", { method: "POST" });
  assert.equal(logout.response.status, 200);
  assert.equal(logout.body.ok, true);
  assert.match(logout.response.headers.get("set-cookie") ?? "", /mp_employee_session=;/);
});

test("the GitHub mirror cannot call the private application API", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("https://guia-comercial-mult-portas.eletrovale-cont.chatgpt.site/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://icaroluciano13-dot.github.io" },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    executionContext(),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(JSON.parse(await response.text()), { error: "Solicitação não autorizada." });
});

test("admin policy delegates trusted frontend checks and keeps the password server-side", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/admin/_lib.ts", import.meta.url), "utf8");
  assert.match(source, /ADMIN_PASSWORD\s*=\s*runtimeEnv\.ADMIN_PASSWORD/);
  assert.match(source, /export function isAdminRequest/);
  assert.match(source, /isTrustedAppRequest\(request\)/);
  assert.doesNotMatch(source, /ADMIN_PASSWORD\s*=\s*["']admin["']/);

  const securitySource = await readFile(new URL("../app/api/_security.ts", import.meta.url), "utf8");
  assert.doesNotMatch(securitySource, /github\.io/);
  assert.match(securitySource, /new URL\(origin\)\.origin === requestOrigin/);
});

test("auth rejects malformed and oversized bodies before storage work", async () => {
  const worker = await loadWorker();
  const malformedLogin = await requestJson(worker, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: 123, password: "senha" }),
  });
  assert.equal(malformedLogin.response.status, 400);

  const malformedRegister = await requestJson(worker, "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: {}, username: "teste", branch: "Araraquara", password: "senha-segura" }),
  });
  assert.equal(malformedRegister.response.status, 400);

  const oversizedLogin = await requestJson(worker, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "teste", password: "x".repeat(9_000) }),
  });
  assert.equal(oversizedLogin.response.status, 413);
});

test("login attempts are rate limited before repeated expensive authentication", async () => {
  const worker = await loadWorker();
  let latest;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    latest = await requestJson(worker, "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.77" },
      body: JSON.stringify({ username: "rate-limit-user", password: "senha-incorreta" }),
    });
  }
  assert.equal(latest.response.status, 429);
  assert.ok(Number(latest.response.headers.get("retry-after")) > 0);
});

test("admin login rejects an unapproved web origin", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("https://guia-comercial-mult-portas.eletrovale-cont.chatgpt.site/api/auth/login", {
      method: "POST",
      headers: {
        Origin: "https://example.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    executionContext(),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(JSON.parse(await response.text()), { error: "Solicitação não autorizada." });
});

test("valid admin credentials can create a session without a browser identity header", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
  assert.match(source, /constantTimeEqual\(await digest\(password\), await digest\(ADMIN_PASSWORD\)\)/);
  assert.doesNotMatch(source, /password === ADMIN_PASSWORD/);
  assert.doesNotMatch(source, /isOwnerRequest/);
  assert.doesNotMatch(source, /oai-authenticated-user-email/);
});

test("switching roles clears the opposite authentication cookie", async () => {
  const { readFile } = await import("node:fs/promises");
  const loginSource = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
  const registerSource = await readFile(new URL("../app/api/auth/register/route.ts", import.meta.url), "utf8");
  const logoutSource = await readFile(new URL("../app/api/auth/logout/route.ts", import.meta.url), "utf8");
  assert.match(loginSource, /clearedSessionCookie\(request\)/);
  assert.match(loginSource, /clearedAdminCookie\(request\)/);
  assert.match(registerSource, /clearedAdminCookie\(request\)/);
  assert.match(logoutSource, /deleteAdminSession\(request\)/);
});

test("admin profile management exposes protected create, edit and delete routes", async () => {
  const { readFile } = await import("node:fs/promises");
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const collectionRoute = await readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8");
  const itemRoute = await readFile(new URL("../app/api/admin/users/[id]/route.ts", import.meta.url), "utf8");
  assert.match(collectionRoute, /export async function POST/);
  assert.match(collectionRoute, /getAdminSession/);
  assert.match(itemRoute, /export async function PATCH/);
  assert.match(itemRoute, /export async function DELETE/);
  assert.match(itemRoute, /employeeSessions/);
  assert.match(itemRoute, /employeeData/);
  assert.match(itemRoute, /getAdminSession/);
  assert.match(pageSource, /detailsRequestRef/);
  assert.match(pageSource, /detailsRequestRef\.current\?\.id !== requestId/);
  assert.match(pageSource, /detailsError \? \(/);
  assert.match(pageSource, /value\.split\("\|", 1\)\[0\]/);
});

test("admin refresh action remains legible while loading", async () => {
  const { readFile } = await import("node:fs/promises");
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(pageSource, /className="button account-refresh"/);
  assert.match(pageSource, /loading \? "Atualizando…" : "Atualizar"/);
  assert.match(styles, /\.account-refresh\s*\{[^}]*color:\s*#3f4b52[^}]*background:\s*#f4f6f6/s);
  assert.match(styles, /\.account-refresh:disabled\s*\{[^}]*color:\s*#69767d[^}]*opacity:\s*1/s);
});

test("employee authentication UI stays separate from the guide workspace", async () => {
  const { readFile } = await import("node:fs/promises");
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const authSource = await readFile(new URL("../app/auth-screen.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /from ["']\.\/auth-screen["']/);
  assert.doesNotMatch(pageSource, /function AuthScreen\(/);
  assert.match(authSource, /export function AuthScreen/);
  assert.match(authSource, /className="auth-shell"/);
});

test("employees can securely edit their own profile without reloading account data", async () => {
  const { readFile } = await import("node:fs/promises");
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const profileRoute = await readFile(new URL("../app/api/auth/profile/route.ts", import.meta.url), "utf8");
  assert.match(pageSource, /className="profile-button"/);
  assert.match(pageSource, /await flushPendingState\(\)/);
  assert.match(pageSource, /apiFetch\("\/api\/auth\/profile"/);
  assert.match(pageSource, /const authUserId = authUser\?\.id \?\? null/);
  assert.match(pageSource, /\}, \[authUserId\]\);/);
  assert.match(profileRoute, /getSessionUser/);
  assert.match(profileRoute, /rejectUntrustedMutation/);
  assert.match(profileRoute, /verifyPassword/);
  assert.match(profileRoute, /normalizeUsername/);
  assert.match(profileRoute, /employeeSessions/);
  assert.match(profileRoute, /createSession/);
  assert.match(profileRoute, /Esse usuário já está cadastrado/);
  assert.doesNotMatch(styles, /\.profile-button, \.user-chip\s*\{\s*display:\s*none/);
  assert.match(pageSource, /button:not\(\[disabled\]\)/);
});

test("employee-facing interface contains no AI product branding", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Treino IA|feedback da IA|ChatGPT|OpenAI|GPT/);
  assert.match(source, /Treino prático/);
  assert.match(source, /feedback contextual/);
});

test("employee learning metric is stored with the training progress", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /scoreHistory: number\[\]/);
  assert.match(source, /skillHistory: TrainingSkillScores\[\]/);
  assert.match(source, /scoreHistory: \[\.\.\.current\.scoreHistory, score\]/);
  assert.match(source, /ÍNDICE DE APRENDIZADO/);
  assert.match(source, /learningMetric/);
  assert.match(source, /writeScopedLocalState\(authUser\.id/);
});

test("new employee workspaces start empty and counters are account-scoped", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const defaultFollowUps: LocalFollowUp\[\] = \[\];/);
  assert.match(source, /quotes: 0/);
  assert.match(source, /officialQuotes: 0/);
  assert.match(source, /incompleteQuotes: 0/);
  assert.match(source, /normalizeMetrics/);
  assert.match(source, /portfolioCount/);
  assert.doesNotMatch(source, /LEGACY_MIGRATION_KEY/);
  assert.doesNotMatch(source, /<strong>20<\/strong><small>orçamentos na agenda/);
});

test("AI coach uses the round and an explicit scoring rubric", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/coach/route.ts", import.meta.url), "utf8");
  assert.match(source, /turn\?: number/);
  assert.match(source, /Rubrica da nota/);
  assert.match(source, /Rodada:/);
  assert.match(source, /não dê nota alta apenas porque a mensagem parece educada/);
});

test("AI coach exposes professional competency feedback and safe output limits", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/coach/route.ts", import.meta.url), "utf8");
  assert.match(source, /skillScores/);
  assert.match(source, /coachQuestion/);
  assert.match(source, /retryGuide/);
  assert.match(source, /cleanText/);
  assert.match(source, /format:\s*\{\s*type: "json_schema"/s);
  assert.match(source, /type: "json_schema"/);
  assert.match(source, /calculateCoachScore/);
  assert.match(source, /CUSTOMER_ROLE_CONTRACT/);
  assert.match(source, /sanitizeCustomerReply/);
  const customerPolicy = await readFile(new URL("../app/api/coach/customer-policy.mjs", import.meta.url), "utf8");
  assert.match(customerPolicy, /CUSTOMER_ROLE_LEAK_PATTERNS/);
  assert.match(customerPolicy, /customerReplyFallback/);
  assert.match(source, /store: false/);
  assert.match(source, /max_output_tokens: 800/);
});

test("employee data and coach payloads have bounded, defensive parsing", async () => {
  const { readFile } = await import("node:fs/promises");
  const dataRoute = await readFile(new URL("../app/api/data/route.ts", import.meta.url), "utf8");
  const coachRoute = await readFile(new URL("../app/api/coach/route.ts", import.meta.url), "utf8");
  assert.match(dataRoute, /MAX_REQUEST_BODY_LENGTH/);
  assert.match(dataRoute, /request\.text\(\)/);
  assert.match(coachRoute, /MAX_COACH_BODY_LENGTH/);
  assert.match(coachRoute, /isRecord\(parsed\)/);
  assert.match(coachRoute, /scenarioSignals/);
});

test("failed loads and logout cannot silently overwrite or discard employee data", async () => {
  const { readFile } = await import("node:fs/promises");
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const dataSource = await readFile(new URL("../app/api/data/route.ts", import.meta.url), "utf8");
  assert.match(pageSource, /setDataLoadError/);
  assert.match(pageSource, /Nenhum dado será sobrescrito/);
  assert.match(pageSource, /readLocalPendingState/);
  assert.match(pageSource, /writeLocalPendingState/);
  assert.match(pageSource, /keepalive: true/);
  assert.match(pageSource, /if \(!\(await flushPendingState\(\)\)\)/);
  assert.match(pageSource, /if \(!response\.ok \|\| data\.ok !== true\)/);
  assert.match(dataSource, /baseRevision/);
  assert.match(dataSource, /status[^\n]*409|, 409\)/);
  assert.match(dataSource, /and\(eq\(employeeData\.userId, user\.id\), eq\(employeeData\.updatedAt, baseRevision\)\)/);
  assert.match(dataSource, /current\?\.stateJson === stateJson/);
  assert.match(dataSource, /crypto\.randomUUID\(\)/);
  assert.match(dataSource, /new Date\(\)\.toISOString\(\).*crypto\.randomUUID\(\)/s);
  assert.match(dataSource, /dados salvos estão temporariamente indisponíveis/);
  assert.doesNotMatch(dataSource, /catch\s*\{\s*return emptyResponse\(\);\s*\}/s);
});

test("training requests and pending microphone access cannot update a stale session", async () => {
  const { readFile } = await import("node:fs/promises");
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /trainingRequestRef/);
  assert.match(pageSource, /requestController\.signal/);
  assert.match(pageSource, /trainingRequestRef\.current\?\.id !== requestId/);
  assert.match(pageSource, /cancelTrainingRequest\(\);\s*cancelPendingVoiceCapture\(\);\s*if \(isRecording\) stopVoiceCapture\(\);/s);
  assert.match(pageSource, /voiceCaptureAttemptRef\.current !== attempt/);
  assert.match(pageSource, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(pageSource, /if \(authUserId\) return;/);
});

test("coach endpoint rejects unauthenticated requests with JSON", async () => {
  const worker = await loadWorker();
  const result = await requestJson(worker, "/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sellerMessage: "Olá", scenario: { title: "Teste" } }),
  });
  assert.equal(result.response.status, 401);
  assert.equal(result.body.error, "Faça login para usar o treinador.");
});
