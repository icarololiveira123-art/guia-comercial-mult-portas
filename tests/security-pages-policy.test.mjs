import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../github-app/index.html", import.meta.url), "utf8");
const policyTags = [...html.matchAll(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi)];
const content = policyTags[0]?.[0].match(/\bcontent="([^"]+)"/i)?.[1] ?? "";
const entries = content.split(";").map(value => value.trim().split(/\s+/)).filter(([name]) => name);
const policy = new Map(entries.map(([name, ...sources]) => [name.toLowerCase(), sources]));

// This verifies the static Pages contract. It does not claim that meta CSP can
// enforce frame-ancestors, or replace a real browser's CSP implementation.
test("Pages activates one CSP before loading any resource", () => {
  assert.equal(policyTags.length, 1);
  assert.ok(content);
  assert.equal(entries.length, policy.size, "Duplicate directives can silently discard intended restrictions");
  const firstResource = html.search(/<(?:link|script|style|iframe|object|embed|img)\b/i);
  assert.ok(firstResource > policyTags[0].index, "The CSP must precede resource loading");
  assert.deepEqual(policy.get("default-src"), ["'none'"]);
  for (const unsupported of ["frame-ancestors", "sandbox", "report-uri"]) {
    assert.equal(policy.has(unsupported), false, `${unsupported} must not be advertised through meta CSP`);
  }
});

test("Pages rejects inline scripts, string evaluation and unused embedding capabilities", () => {
  assert.deepEqual(policy.get("script-src"), ["'self'"]);
  assert.deepEqual(policy.get("script-src-attr"), ["'none'"]);
  for (const name of ["object-src", "frame-src", "worker-src", "base-uri", "form-action"]) {
    assert.deepEqual(policy.get(name), ["'none'"], name);
  }
  assert.doesNotMatch(content, /'unsafe-eval'|'wasm-unsafe-eval'|'unsafe-hashes'/);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0);
  for (const [, attributes, body] of scripts) {
    assert.match(attributes, /\btype="module"/);
    const source = attributes.match(/\bsrc="([^"]+)"/)?.[1];
    assert.ok(source && new URL(source, "https://pages.example.test/guia/").origin === "https://pages.example.test");
    assert.equal(body.trim(), "", "Production modules must not require inline JavaScript");
  }
  assert.doesNotMatch(html, /\son[a-z]+\s*=|\b(?:href|src)\s*=\s*["']\s*javascript:/i);
});

test("Pages restricts shared API connections to its configured function path", async () => {
  const config = await readFile(new URL("../app/lib/shared-api-config.mjs", import.meta.url), "utf8");
  const configured = config.match(/\?\?\s*"(https:\/\/[^"]+)"/)?.[1];
  assert.ok(configured, "The default shared API must remain explicit");
  const endpoint = new URL(configured);
  assert.equal(endpoint.protocol, "https:");
  const sources = policy.get("connect-src");
  assert.deepEqual(sources, ["'self'", `${endpoint.href.replace(/\/$/, "")}/`]);
  // The trailing slash permits API child routes, without allowing every
  // Supabase project, a wildcard origin, websockets or arbitrary HTTPS hosts.
  assert.equal(sources.some(source => source === "*" || /^(?:https:|wss:|data:|blob:)$/.test(source) || source.includes("*")), false);
});

test("Pages preserves React styles, local fonts and recorded audio without opening script sources", async () => {
  assert.deepEqual(policy.get("style-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(policy.get("font-src"), ["'self'"]);
  assert.deepEqual(policy.get("img-src"), ["'self'", "data:", "blob:"]);
  assert.deepEqual(policy.get("media-src"), ["'self'", "blob:"]);
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /URL\.createObjectURL\(blob\)/);
  assert.match(page, /<audio\b[^>]*src=\{voicePreviewUrl\}/);
  const catalog = await readFile(new URL("../app/catalog-workspace.tsx", import.meta.url), "utf8");
  assert.match(catalog, /<a\b[^>]*href=\{assetHref\(document\.href\)\}[^>]*target="_blank"/);
  assert.doesNotMatch(catalog, /<(?:iframe|object|embed)\b/i);
  // Catalogs open through ordinary navigation; JSON/XLSX downloads also use
  // blob navigation. Neither requires relaxing object-src or connect-src.
});

test("Pages omits referrers on outgoing requests and navigation", () => {
  const referrers = [...html.matchAll(/<meta\b[^>]*name="referrer"[^>]*>/gi)];
  assert.equal(referrers.length, 1);
  assert.match(referrers[0][0], /\bcontent="no-referrer"/);
});
