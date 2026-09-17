import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("security-test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

function runtime() {
  return {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
}

function executionContext() {
  return { waitUntil() {}, passThroughOnException() {} };
}

test("untrusted websites cannot perform session-backed mutations", async () => {
  const worker = await loadWorker();
  const paths = ["/api/auth/login", "/api/auth/register", "/api/auth/logout", "/api/auth/profile", "/api/data", "/api/coach"];
  for (const path of paths) {
    const response = await worker.fetch(new Request(`https://guia-comercial-mult-portas.eletrovale-cont.chatgpt.site${path}`, {
      method: path === "/api/data" ? "PUT" : path === "/api/auth/profile" ? "PATCH" : "POST",
      headers: { Origin: "https://example.invalid", "Content-Type": "application/json" },
      body: "{}",
    }), runtime(), executionContext());
    assert.equal(response.status, 403, path);
    assert.deepEqual(JSON.parse(await response.text()), { error: "Solicitação não autorizada." });
  }
});

test("an attached custom domain can perform exact same-origin mutations", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("https://www.multportasguia.com/api/auth/logout", {
    method: "POST",
    headers: { Origin: "https://www.multportasguia.com" },
  }), runtime(), executionContext());
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(await response.text()), { ok: true });
});

test("API responses receive defensive browser headers", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/auth/logout", { method: "POST" }), runtime(), executionContext());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("HTML and robots responses are protected from indexing and framing", async () => {
  const worker = await loadWorker();
  const html = await worker.fetch(new Request("http://localhost/", { headers: { Accept: "text/html" } }), runtime(), executionContext());
  assert.equal(html.status, 200);
  assert.equal(html.headers.get("x-frame-options"), "DENY");
  assert.equal(html.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
});
