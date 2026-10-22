import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedApi, digestText, makePasswordProof } from '../supabase/functions/mult-portas-api/shared-api.mjs';

// This is deliberately an in-memory boundary test: it performs no network
// requests, authenticates only synthetic sessions and has no production data.
const ORIGIN = 'https://icarololiveira123-art.github.io';
const BASE = 'https://example-project.supabase.co/functions/v1/mult-portas-api';
const EMPLOYEE_TOKEN = 'e'.repeat(43);
const PANEL_TOKEN = 'p'.repeat(43);
const QUOTE_ID = '12345678-abcd-4123-8123-123456789abc';
const ITEM_ID = '87654321-abcd-4123-8123-123456789abc';

async function fixture({ getTrustedClientIp = null } = {}) {
  const calls = [];
  const errors = [];
  const rates = new Map();
  let instant = Date.parse('2026-10-19T03:00:00Z');
  let nextUserId = 8;
  const hashes = new Map([[await digestText(EMPLOYEE_TOKEN), 'user'], [await digestText(PANEL_TOKEN), 'admin']]);
  const user = { id: 7, username: 'synthetic-user', usernameNormalized: 'synthetic-user', displayName: 'Synthetic User', branch: 'Araraquara',
    password: { hash: 'synthetic-private-hash' }, sessionVersion: 'synthetic-private-version' };
  const store = {
    failure: null,
    async execute(action, payload = {}, auth = null) {
      calls.push({ action, payload: structuredClone(payload), auth: structuredClone(auth) });
      if (this.failure === action) throw new Error('synthetic-private-database-connection-secret');
      if (action === 'rate_limit') {
        const previous = rates.get(payload.bucket);
        const current = !previous || previous.start + payload.seconds * 1000 <= instant ? { start: instant, count: 0 } : previous;
        current.count += 1;
        rates.set(payload.bucket, current);
        return { allowed: current.count <= payload.max, retryAfter: Math.max(1, Math.ceil((current.start + payload.seconds * 1000 - instant) / 1000)) };
      }
      if (action === 'get_access_proof') return { proof: null };
      if (action === 'get_user_by_username') return { user: payload.usernameNormalized === user.usernameNormalized ? structuredClone(user) : null };
      if (action === 'create_session') { hashes.set(payload.tokenHash, payload.role); return { ok: true }; }
      if (action === 'create_user') return { user: { ...structuredClone(payload), id: nextUserId++, sessionVersion: 'synthetic-new-version' } };
      if (action === 'resolve_session') {
        const role = hashes.get(auth?.tokenHash);
        return role ? { session: { role, userId: role === 'user' ? user.id : null }, user: role === 'user' ? structuredClone(user) : null } : { status: 'unauthorized' };
      }
      if (action === 'get_state') return { state: { metrics: { leads: 2 } }, revision: 'revision-one', clientState: { schemaVersion: 1 } };
      if (action === 'save_state') return { ok: true, revision: payload.revision };
      if (action === 'quote_create') return { request: { ...payload.data, id: payload.id, revision: 1 } };
      if (action === 'quote_list') return { requests: [], counts: { total: 0, pending: 0, sent: 0, archived: 0 } };
      if (action === 'activity_list') return { events: [] };
      if (action === 'daily_quotes') return { quotes: [] };
      if (action === 'revoke_session') return { ok: true };
      throw new Error(`Unexpected fixture action: ${action}`);
    },
  };
  const handler = createSharedApi({ store, getTrustedClientIp, now: () => new Date(instant), onError: error => errors.push(error) });
  async function call(path, { method = 'GET', token = EMPLOYEE_TOKEN, origin = ORIGIN, body, headers = {}, signal } = {}) {
    const requestHeaders = new Headers(headers);
    if (origin !== null) requestHeaders.set('Origin', origin);
    if (token !== null) requestHeaders.set('Authorization', `Bearer ${token}`);
    if (body !== undefined && !requestHeaders.has('content-type')) requestHeaders.set('Content-Type', 'application/json');
    const data = body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array || body instanceof ReadableStream ? body : JSON.stringify(body);
    const response = await handler(new Request(new URL(path, BASE), { method, headers: requestHeaders,
      ...(data === undefined ? {} : { body: data, ...(data instanceof ReadableStream ? { duplex: 'half' } : {}) }), ...(signal ? { signal } : {}) }));
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  }
  return { calls, errors, store, handler, call, advance: milliseconds => { instant += milliseconds; },
    setLoginPassword: async password => { user.password = await makePasswordProof(password); } };
}

function quote(overrides = {}) {
  return { id: QUOTE_ID, mutationId: crypto.randomUUID(), clientName: 'Cliente sintético', requestedOn: '2026-10-18', sent: false,
    pricingMode: 'items', amountCents: null, items: [{ id: ITEM_ID, description: 'Porta', quantity: 1, unitAmountCents: null }], ...overrides };
}
const mutationActions = new Set(['create_user', 'save_state', 'workspace_save', 'quote_create', 'quote_update', 'quote_action', 'admin_create_user', 'admin_update_user', 'delete_user', 'import_local']);
const writes = f => f.calls.filter(call => mutationActions.has(call.action));

test('security boundary: foreign and malformed origins cannot reach authentication, throttles or data', async () => {
  const f = await fixture();
  for (const origin of [null, '', 'null', 'https://icarololiveira123-art.github.io/', 'https://icarololiveira123-art.github.io:443',
    'https://icarololiveira123-art.github.io.evil.invalid', 'https://evil.invalid/icarololiveira123-art.github.io',
    'https://icarololiveira123-art.github.io@evil.invalid', 'http://icarololiveira123-art.github.io',
    'https://icarololiveira123-art.github.io https://evil.invalid', 'https://ICAROLOLIVEIRA123-art.github.io']) {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await f.call('/api/data', { origin, method, ...(method === 'OPTIONS' ? { headers: { 'Access-Control-Request-Method': 'PUT' } } : {}) });
      assert.equal(response.status, 403, `${method} ${origin}`);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    }
  }
  assert.deepEqual(f.calls, []);
});

test('security boundary: preflight refuses extra capabilities and never contacts the store', async () => {
  const f = await fixture();
  for (const method of ['CONNECT', 'TRACE', 'HEAD', 'PUT,DELETE', 'put', '']) {
    assert.equal((await f.call('/api/data', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': method } })).status, 403);
  }
  for (const requested of ['authorization,x-user-id', 'content-type,cookie', 'authorization,x-http-method-override', 'authorization,x-forwarded-for']) {
    assert.equal((await f.call('/api/data', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': requested } })).status, 403);
  }
  const accepted = await f.call('/api/data', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'Authorization, Content-Type' } });
  assert.equal(accepted.status, 204);
  assert.equal(accepted.headers.get('Access-Control-Allow-Credentials'), null);
  assert.deepEqual(f.calls, []);
});

test('security boundary: text, primitive JSON, broken UTF-8 and malformed JSON never become quote writes', async () => {
  const f = await fixture();
  for (const contentType of ['text/plain', 'text/json', 'application/jsonp', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
    assert.equal((await f.call('/api/quote-requests', { method: 'POST', body: quote(), headers: { 'Content-Type': contentType } })).status, 415, contentType);
  }
  for (const body of ['null', '[]', 'true', '1', '"object"', '', '{"clientName":', '{"a":1} trailing', new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d])]) {
    assert.equal((await f.call('/api/quote-requests', { method: 'POST', body })).status, 400);
  }
  assert.equal(writes(f).length, 0);
});

test('security boundary: actual stream byte count defeats false content-length and UTF-8 character undercounts', async () => {
  const f = await fixture();
  let cancelled = false;
  let chunks = 0;
  const stream = new ReadableStream({
    pull(controller) { chunks += 1; controller.enqueue(new Uint8Array(64_000)); },
    cancel() { cancelled = true; },
  });
  const overflow = await f.call('/api/quote-requests', { method: 'POST', body: stream, headers: { 'Content-Length': '1' } });
  assert.equal(overflow.status, 413);
  assert.equal(cancelled, true);
  assert.ok(chunks <= 5, 'the stream is stopped near the boundary');
  const multibyte = JSON.stringify({ clientName: 'é'.repeat(91_000) });
  assert.ok(multibyte.length < 180_000);
  assert.ok(new TextEncoder().encode(multibyte).byteLength > 180_000);
  assert.equal((await f.call('/api/quote-requests', { method: 'POST', body: multibyte, headers: { 'Content-Length': '2' } })).status, 413);
  for (const length of ['-1', 'NaN', 'Infinity', '1e5', '180001']) {
    assert.equal((await f.call('/api/quote-requests', { method: 'POST', body: '{}', headers: { 'Content-Length': length } })).status, 413, length);
  }
  assert.equal(writes(f).length, 0);
});

test('security boundary: encoded identifiers, mutation method confusion and identity injection cannot change another profile', async () => {
  const f = await fixture();
  for (const path of ['/api/admin/users/8/workspace', '/api/admin/users/8/quote-requests', '/api/admin/users/8/access',
    '/api/admin/users/8/activity', '/api/admin/users/8/daily', '/api/admin/users/8', '/api/admin/daily?day=2026-10-18']) {
    assert.equal((await f.call(path)).status, 403, path);
  }
  for (const suffix of ['%2e%2e', '%2f', `${QUOTE_ID}%2fhistory`, `${QUOTE_ID}%00`, `${QUOTE_ID}/history/extra`]) {
    assert.ok([400, 404].includes((await f.call(`/api/quote-requests/${suffix}`)).status), suffix);
  }
  for (const [path, method] of [['/api/quote-requests', 'PUT'], ['/api/quote-requests', 'DELETE'], [`/api/quote-requests/${QUOTE_ID}`, 'POST'],
    [`/api/quote-requests/${QUOTE_ID}`, 'DELETE'], [`/api/quote-requests/${QUOTE_ID}/history`, 'PATCH']]) {
    assert.equal((await f.call(path, { method, body: quote({ userId: 8, action: 'sent', baseRevision: 1 }), headers: { 'X-HTTP-Method-Override': 'PUT' } })).status, 405, `${method} ${path}`);
  }
  const injected = Object.assign(JSON.parse('{"__proto__":{"polluted":true}}'), quote({ userId: 8, role: 'admin', actorUserId: 8,
    createdAt: '1900-01-01', archivedAt: '1900-01-01', revision: 999 }));
  const created = await f.call('/api/quote-requests?userId=8&role=admin', { method: 'POST', body: injected, headers: { 'X-User-Id': '8' } });
  assert.equal(created.status, 201);
  const write = writes(f).at(-1);
  assert.equal(write.payload.userId, 7);
  for (const key of ['userId', 'role', 'actorUserId', 'createdAt', 'archivedAt', 'revision', 'polluted']) assert.equal(Object.hasOwn(write.payload.data, key), false, key);
  assert.equal({}.polluted, undefined);
});

test('security boundary: money and quantity abuses are rejected while optional zero and absent prices remain valid', async () => {
  const f = await fixture();
  for (const price of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, '1', {}, [], true]) {
    const body = quote(); body.items[0].unitAmountCents = price;
    assert.equal((await f.call('/api/quote-requests', { method: 'POST', body })).status, 400, String(price));
  }
  for (const quantity of [0, -1, 0.5, 10_001, Number.MAX_SAFE_INTEGER, '1', {}, null]) {
    const body = quote(); body.items[0].quantity = quantity;
    assert.equal((await f.call('/api/quote-requests', { method: 'POST', body })).status, 400, String(quantity));
  }
  assert.equal(writes(f).length, 0);
  const unpaid = await f.call('/api/quote-requests', { method: 'POST', body: quote() });
  assert.equal(unpaid.status, 201);
  assert.equal(unpaid.body.request.amountCents, null);
  const zero = quote({ amountCents: 999 }); zero.items[0].unitAmountCents = 0;
  const free = await f.call('/api/quote-requests', { method: 'POST', body: zero });
  assert.equal(free.status, 201);
  assert.equal(free.body.request.amountCents, 0, 'client supplied aggregate does not override item totals');
});

test('security boundary: authentication and internal failures never reveal raw proofs, versions, tokens or database errors', async () => {
  const f = await fixture();
  const me = await f.call('/api/auth/me');
  assert.equal(me.status, 200);
  assert.deepEqual(Object.keys(me.body.user).sort(), ['branch', 'displayName', 'id', 'username']);
  const output = JSON.stringify(me.body);
  for (const secret of ['synthetic-private-hash', 'synthetic-private-version', EMPLOYEE_TOKEN]) assert.equal(output.includes(secret), false);
  for (const token of ['', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '=', 'unknown-token', 'a'.repeat(43)]) {
    assert.equal((await f.call('/api/data', { token })).status, 401);
  }
  f.store.failure = 'get_state';
  const failed = await f.call('/api/data');
  assert.equal(failed.status, 503);
  assert.equal(JSON.stringify(failed.body).includes('synthetic-private-database-connection-secret'), false);
  assert.deepEqual(f.errors, [{ code: 'shared_api_failed', name: 'Error' }]);
});

test('security boundary: canceled writes and prototype fields in synchronized progress never reach persistence', async () => {
  const f = await fixture();
  const controller = new AbortController(); controller.abort();
  assert.equal((await f.call('/api/quote-requests', { method: 'POST', body: quote(), signal: controller.signal })).status, 499);
  for (const clientState of [JSON.parse('{"schemaVersion":1,"__proto__":{"admin":true}}'),
    JSON.parse('{"schemaVersion":1,"brands":{"constructor":{"view":"pdfs"}}}'),
    JSON.parse('{"schemaVersion":1,"resume":{"section":"quotes","token":"synthetic-token"}}')]) {
    assert.equal((await f.call('/api/data', { method: 'PUT', body: { state: {}, baseRevision: null, clientState } })).status, 400);
  }
  assert.equal(writes(f).length, 0);
  assert.equal({}.admin, undefined);
});

test('security regression: malformed logins cannot consume account quotas or lock out another profile', async () => {
  for (const trusted of [false, true]) {
    const f = await fixture(trusted ? { getTrustedClientIp: () => 'trusted-fixture-gateway' } : {});
    const password = crypto.randomUUID();
    await f.setLoginPassword(password);
    for (let attempt = 0; attempt < 65; attempt += 1) {
      const body = attempt % 2 ? '{broken-json' : { username: 'invalid name', password: 'synthetic-password' };
      const response = await f.call('/api/auth/login', { method: 'POST', token: null, body,
        headers: { 'X-Forwarded-For': `198.51.100.${attempt}` } });
      assert.equal(response.status, 400);
    }
    assert.equal(f.calls.filter(call => call.action === 'rate_limit' && call.payload.max !== 1200).length, 0);
    const signedIn = await f.call('/api/auth/login', { method: 'POST', token: null, body: { username: 'synthetic-user', password } });
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.body.user.id, 7);
    assert.equal(f.calls.filter(call => call.action === 'rate_limit' && call.payload.max === 60).length, trusted ? 1 : 0);
  }
});

test('security regression: shared ingress has no low global login bucket while normalized account throttling remains', async () => {
  const f = await fixture();
  for (let attempt = 0; attempt < 65; attempt += 1) {
    assert.equal((await f.call('/api/auth/login', { method: 'POST', token: null,
      body: { username: `missing-${attempt}`, password: 'synthetic-password' }, headers: { 'X-Forwarded-For': `198.51.100.${attempt}` } })).status, 401);
  }
  assert.equal(f.calls.some(call => call.action === 'rate_limit' && call.payload.max === 60), false);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await f.call('/api/auth/login', { method: 'POST', token: null,
      body: { username: attempt % 2 ? 'Shared-Target' : 'SHARED-TARGET', password: 'synthetic-password' } })).status, 401);
  }
  const blocked = await f.call('/api/auth/login', { method: 'POST', token: null, body: { username: 'shared-target', password: 'synthetic-password' } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
  assert.equal((await f.call('/api/auth/login', { method: 'POST', token: null, body: { username: 'another-target', password: 'synthetic-password' } })).status, 401);
  f.advance(901_000);
  assert.equal((await f.call('/api/auth/login', { method: 'POST', token: null, body: { username: 'shared-target', password: 'synthetic-password' } })).status, 401);
});

test('security regression: a trusted gateway retains its 60-login quota without trusting forwarded headers', async () => {
  let gateway = 'trusted-fixture-gateway-a';
  const f = await fixture({ getTrustedClientIp: () => gateway });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    assert.equal((await f.call('/api/auth/login', { method: 'POST', token: null,
      body: { username: `trusted-${attempt}`, password: 'synthetic-password' }, headers: { 'X-Forwarded-For': `198.51.100.${attempt}` } })).status, 401);
  }
  assert.equal((await f.call('/api/auth/login', { method: 'POST', token: null,
    body: { username: 'trusted-more', password: 'synthetic-password' }, headers: { 'X-Forwarded-For': '203.0.113.1' } })).status, 429);
  gateway = 'trusted-fixture-gateway-b';
  assert.equal((await f.call('/api/auth/login', { method: 'POST', token: null, body: { username: 'trusted-more', password: 'synthetic-password' } })).status, 401);
});

test('security regression: invalid registrations cannot consume the retained aggregate quota for valid signups', async () => {
  const f = await fixture();
  for (let attempt = 0; attempt < 65; attempt += 1) {
    const body = attempt % 2 ? '{broken-json' : { username: `new-${attempt}`, displayName: '', branch: 'Araraquara', password: 'synthetic-password' };
    assert.equal((await f.call('/api/auth/register', { method: 'POST', token: null, body })).status, 400);
  }
  assert.equal(f.calls.filter(call => call.action === 'rate_limit' && call.payload.max === 12).length, 0);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    assert.equal((await f.call('/api/auth/register', { method: 'POST', token: null, body: {
      username: `valid-new-${attempt}`, displayName: 'Synthetic New User', branch: 'Araraquara', password: 'synthetic-password' } })).status, 201);
  }
  const blocked = await f.call('/api/auth/register', { method: 'POST', token: null, body: {
    username: 'valid-new-blocked', displayName: 'Synthetic New User', branch: 'Araraquara', password: 'synthetic-password' } });
  assert.equal(blocked.status, 429);
  assert.equal(writes(f).filter(call => call.action === 'create_user').length, 12);
});

test('security regression: activity and daily cursors reject impossible dates and preserve original microseconds', async () => {
  const f = await fixture();
  const invalid = ['2026-02-30T12:00:00Z', '2026-04-31T12:00:00Z', '2025-02-29T12:00:00Z', '2026-10-19T24:00:00Z',
    '2026-10-19T12:60:00Z', '2026-10-19T12:00:60Z', '2026-10-19T12:00:00.1234567Z',
    '0000-01-01T12:00:00Z', '2026-10-19T12:00:00+15:00', '2026-10-19T12:00Z'];
  for (const timestamp of invalid) {
    for (const path of [`/api/admin/users/7/activity?cursor=${encodeURIComponent(timestamp + '|' + QUOTE_ID)}`,
      `/api/admin/users/7/daily/2026-10-18/quotes?capturedAt=${encodeURIComponent(timestamp)}`,
      `/api/quote-requests?cursor=${encodeURIComponent(timestamp + '|' + QUOTE_ID)}`]) {
      const token = path.startsWith('/api/admin/') ? PANEL_TOKEN : EMPLOYEE_TOKEN;
      assert.equal((await f.call(path, { token })).status, 400, path);
    }
  }
  assert.equal(f.calls.filter(call => ['activity_list', 'daily_quotes', 'quote_list'].includes(call.action)).length, 0);
  for (const timestamp of ['2024-02-29T23:59:59.123456Z', '2026-10-19T00:00:00.987654+00:00', '2026-10-18T21:00:00.123456-03:00']) {
    assert.equal((await f.call(`/api/admin/users/7/activity?cursor=${encodeURIComponent(timestamp + '|' + QUOTE_ID)}`, { token: PANEL_TOKEN })).status, 200);
    assert.equal(f.calls.findLast(call => call.action === 'activity_list').payload.cursorAt, timestamp);
    assert.equal((await f.call(`/api/admin/users/7/daily/2026-10-18/quotes?capturedAt=${encodeURIComponent(timestamp)}`, { token: PANEL_TOKEN })).status, 200);
    assert.equal(f.calls.findLast(call => call.action === 'daily_quotes').payload.capturedAt, timestamp);
    assert.equal((await f.call(`/api/quote-requests?cursor=${encodeURIComponent(timestamp + '|' + QUOTE_ID)}`)).status, 200);
    assert.equal(f.calls.findLast(call => call.action === 'quote_list').payload.cursorAt, timestamp);
  }
});
