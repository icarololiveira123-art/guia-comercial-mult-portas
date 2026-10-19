import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Exercise the real standalone guards without loading Cloudflare, a database,
// a server or any remote service. Each import receives isolated quota state.
async function loadGuard(relative) {
  async function moduleUrl(path) {
    const source = await readFile(path, "utf8");
    let { outputText } = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    for (const match of outputText.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
      const dependency = new URL(match[1], path);
      if (!/\.[cm]?[jt]s$/.test(dependency.pathname)) dependency.pathname += ".ts";
      outputText = outputText.replace(match[0], `from ${JSON.stringify(await moduleUrl(dependency))}`);
    }
    return `data:text/javascript;base64,${Buffer.from(`${outputText}\n// ${crypto.randomUUID()}`).toString("base64")}`;
  }
  return import(await moduleUrl(new URL(relative, import.meta.url)));
}

const appOrigin = "https://legacy-app.example.test";
function request({ origin = appOrigin, method = "POST", ip = "192.0.2.1" } = {}) {
  const headers = { "cf-connecting-ip": ip };
  if (origin !== null) headers.Origin = origin;
  return new Request(`${appOrigin}/api/auth/login`, { method, headers });
}

test("legacy boundary: hostile and malformed Origin values cannot reuse cookie-backed writes", async () => {
  const guard = await loadGuard("../app/api/_security.ts");
  const origins = ["null", "https://foreign.example.test", `${appOrigin}.foreign.example.test`,
    "https://legacy-app.example.test@foreign.example.test", "http://legacy-app.example.test",
    "http://localhost", "https://legacy-app.example.test https://foreign.example.test", "://invalid"];
  for (const origin of origins) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const blocked = guard.rejectUntrustedMutation(request({ origin, method }));
      assert.equal(blocked?.status, 403, `${method} ${origin}`);
      assert.equal(blocked.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(await blocked.json(), { error: "Solicitação não autorizada." });
    }
  }
  assert.equal(guard.rejectUntrustedMutation(request()), null);
});

test("legacy boundary: development HTTP exceptions do not accept lookalike remote hosts", async () => {
  const guard = await loadGuard("../app/api/_security.ts");
  for (const host of ["localhost", "127.0.0.1", "terminal.local"]) {
    const origin = `http://${host}:5173`;
    assert.equal(guard.isTrustedAppRequest(new Request(`${origin}/api/data`, { headers: { Origin: origin } })), true);
  }
  for (const host of ["localhost.evil.invalid", "127.0.0.1.evil.invalid", "terminal.local.evil.invalid", "evil.invalid"]) {
    const origin = `http://${host}:5173`;
    assert.equal(guard.isTrustedAppRequest(new Request(`${origin}/api/data`, { headers: { Origin: origin } })), false);
  }
});

test("legacy boundary: login quota follows normalized account across distinct source addresses", async () => {
  const guard = await loadGuard("../app/api/auth/_request-guard.ts");
  for (let i = 0; i < 8; i++) {
    const keys = guard.loginRateKeys(request({ ip: `192.0.2.${i + 1}` }), i % 2 ? " Synthetic.User " : "synthetic.user");
    assert.equal(guard.consumeLoginQuota(keys), null);
  }
  const blocked = guard.consumeLoginQuota(guard.loginRateKeys(request({ ip: "192.0.2.50" }), "SYNTHETIC.USER"));
  assert.ok(blocked > 0 && blocked <= 600);
});

test("legacy boundary: a successful synthetic login cannot clear the shared source budget", async () => {
  const guard = await loadGuard("../app/api/auth/_request-guard.ts");
  for (let i = 0; i < 100; i++) {
    const keys = guard.loginRateKeys(request(), `synthetic-${i}`);
    assert.equal(guard.consumeLoginQuota(keys), null);
    guard.clearAuthQuota(keys);
  }
  assert.ok(guard.consumeLoginQuota(guard.loginRateKeys(request(), "another-synthetic-account")) > 0);
});

test("legacy boundary: registration account and source budgets are enforced independently", async () => {
  const guard = await loadGuard("../app/api/auth/_request-guard.ts");
  for (let i = 0; i < 3; i++) assert.equal(guard.consumeRegistrationQuota(request({ ip: `192.0.2.${i + 1}` }), "synthetic.register"), null);
  assert.ok(guard.consumeRegistrationQuota(request({ ip: "192.0.2.99" }), "SYNTHETIC.REGISTER") > 0);
  for (let i = 0; i < 5; i++) assert.equal(guard.consumeRegistrationQuota(request({ ip: "198.51.100.1" }), `synthetic-${i}`), null);
  assert.ok(guard.consumeRegistrationQuota(request({ ip: "198.51.100.1" }), "synthetic-over-budget") > 0);
});

test("legacy boundary: malformed auth bodies and declared overflow fail before credentials can be processed", async () => {
  const guard = await loadGuard("../app/api/auth/_request-guard.ts");
  for (const raw of ["null", "[]", "true", "1", '"text"', "", '{"invalid":', "{} extra"]) {
    const parsed = await guard.readBoundedAuthJson(new Request(`${appOrigin}/api/auth/login`, { method: "POST", body: raw }), "Invalid synthetic body");
    assert.equal(parsed.response?.status, 400, raw);
  }
  let read = false;
  const declaredOverflow = await guard.readBoundedAuthJson({
    headers: new Headers({ "Content-Length": "8193" }),
    async text() { read = true; throw new Error("must not read declared overflow"); },
  }, "Invalid synthetic body");
  assert.equal(declaredOverflow.response?.status, 413);
  assert.equal(read, false);
});

test("legacy boundary: streaming overflow ignores a false Content-Length and cancels further input", async () => {
  const guard = await loadGuard("../app/api/auth/_request-guard.ts");
  let cancelled = false;
  let chunks = 0;
  const body = new ReadableStream({
    pull(controller) { chunks += 1; controller.enqueue(new Uint8Array(2048)); },
    cancel() { cancelled = true; },
  });
  const response = await guard.readBoundedAuthJson(new Request(`${appOrigin}/api/auth/login`, {
    method: "POST", body, duplex: "half", headers: { "Content-Length": "1" },
  }), "Invalid synthetic body");
  assert.equal(response.response?.status, 413);
  assert.equal(cancelled, true);
  assert.ok(chunks <= 6, "input is canceled just after crossing the byte boundary");
});

test("legacy boundary: UTF-8 bytes, split characters and malformed byte sequences receive bounded handling", async () => {
  const guard = await loadGuard("../app/api/auth/_request-guard.ts");
  const overLimit = JSON.stringify({ synthetic: "é".repeat(6000) });
  assert.ok(overLimit.length < 8192 && new TextEncoder().encode(overLimit).byteLength > 8192);
  assert.equal((await guard.readBoundedAuthJson(new Request(`${appOrigin}/api/auth/login`, {
    method: "POST", body: overLimit,
  }), "Invalid synthetic body")).response?.status, 413);

  const text = JSON.stringify({ synthetic: "á😀".repeat(400) });
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const split = new ReadableStream({ pull(controller) {
    if (offset >= bytes.byteLength) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, ++offset));
  } });
  const accepted = await guard.readBoundedAuthJson(new Request(`${appOrigin}/api/auth/login`, {
    method: "POST", body: split, duplex: "half",
  }), "Invalid synthetic body");
  assert.deepEqual(accepted.value, JSON.parse(text));

  const brokenUtf8 = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
  assert.equal((await guard.readBoundedAuthJson(new Request(`${appOrigin}/api/auth/login`, {
    method: "POST", body: brokenUtf8,
  }), "Invalid synthetic body")).response?.status, 400);
});

test("legacy boundary: exact byte limits apply to the shared body reader across route budgets", async () => {
  const { readLimitedRequestText, RequestBodyLimitError } = await loadGuard("../app/api/_request-body.ts");
  for (const budget of [8192, 80_000, 450_000]) {
    assert.equal((await readLimitedRequestText(new Request(`${appOrigin}/api/data`, {
      method: "POST", body: "a".repeat(budget),
    }), budget)).length, budget);
    await assert.rejects(readLimitedRequestText(new Request(`${appOrigin}/api/data`, {
      method: "POST", body: "a".repeat(budget + 1),
    }), budget), RequestBodyLimitError);
  }
  for (const value of ["-1", "NaN", "Infinity", "1e3", "99999999999999999999999999"]) {
    await assert.rejects(readLimitedRequestText(new Request(`${appOrigin}/api/data`, {
      method: "POST", body: "{}", headers: { "Content-Length": value },
    }), 8192), RequestBodyLimitError);
  }
});

test("legacy boundary: a full quota map preserves active blocks, admits known users and recovers after expiry", async (t) => {
  let now = Date.parse("2026-10-19T04:00:00Z");
  t.mock.method(Date, "now", () => now);
  const guard = await loadGuard("../app/api/auth/_request-guard.ts");
  const target = guard.loginRateKeys(request(), "synthetic-target");
  for (let i = 0; i < 8; i++) assert.equal(guard.consumeLoginQuota(target), null);
  assert.equal(guard.consumeLoginQuota(target), 600);
  const known = guard.loginRateKeys(request({ ip: "198.51.100.1" }), "synthetic-known");
  assert.equal(guard.consumeLoginQuota(known), null);
  for (let i = 0; i < 2200; i++) {
    guard.consumeLoginQuota(guard.loginRateKeys(request({ ip: `synthetic-source-${i}` }), `synthetic-churn-${i}`));
  }
  assert.equal(guard.consumeLoginQuota(target), 600, "the existing account block survives key churn");
  assert.equal(guard.consumeLoginQuota(known), null, "existing healthy account/source remain usable at capacity");
  const fresh = guard.loginRateKeys(request({ ip: "203.0.113.100" }), "synthetic-new");
  assert.ok(guard.consumeLoginQuota(fresh) > 0, "new keys fail closed while all slots have active windows");
  now += 600_001;
  assert.equal(guard.consumeLoginQuota(fresh), null, "expired windows release capacity");
});

test("legacy boundary: log details never include SQL, parameters, credentials or custom error names", async () => {
  const { safeErrorDetails } = await loadGuard("../app/api/_security.ts");
  const secret = "synthetic-proof-and-personal-data";
  const failure = new Error(`Failed query: insert into users values (?) params: ${secret}`);
  failure.name = secret;
  failure.cause = { token: secret };
  assert.deepEqual(safeErrorDetails(failure), { name: "Error" });
  assert.deepEqual(safeErrorDetails(new TypeError(secret)), { name: "TypeError" });
  assert.deepEqual(safeErrorDetails({ message: secret, name: secret, toString() { throw new Error("must not stringify"); } }), { name: "Unknown" });
  assert.equal(JSON.stringify(safeErrorDetails(failure)).includes(secret), false);
});
