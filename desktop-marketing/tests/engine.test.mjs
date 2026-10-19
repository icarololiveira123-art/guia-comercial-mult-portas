import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketingEngine, planMarketingUpdate, SITE_ORIGIN } from '../desktop/engine.mjs';
import { createMockApi } from './mock-api.mjs';
import { getMarketingDay, marketingDateKey, setMarketingCount, buildMarketingReport } from '../app/lib/marketing-daily.mjs';

const date = '2026-10-15';
const credentials = { username: 'teste', password: 'senha-temporaria-de-teste', remember: true };
const memoryVault = () => { let data = null; return { read: () => data ? structuredClone(data) : null, write: value => { data = structuredClone(value); } }; };
async function setup(extra = {}) {
  const vault = extra.vault ?? memoryVault();
  const api = extra.api ?? createMockApi();
  const engine = new MarketingEngine({ vault, fetchImpl: api, now: () => new Date(`${date}T14:00:00Z`), ...extra.options });
  await engine.login(credentials);
  return { engine, api, vault };
}
const count = (engine, field) => getMarketingDay(engine.currentMarketing(), date, 'Equipe Mult Portas')[field];

test('all six counters persist to the same API while preserving quotes, progress, and other workspace fields', async () => {
  const { engine, api } = await setup();
  for (const [index, field] of ['newContacts', 'interacting', 'notInteracting', 'phone', 'inPerson', 'inPersonExisting'].entries()) engine.edit({ date, field, value: index + 1 });
  await engine.sync();
  const state = api.readState();
  assert.equal(state.followups[0].amountCents, 125050);
  assert.equal(state.metrics.leads, 7);
  assert.deepEqual(Object.values(state.marketingDaily.days[0]).slice(2), [1, 2, 3, 4, 5, 6]);
  assert.equal(engine.pendingCount(), 0);
  assert.equal(engine.status, 'synced');
});
test('a competing website edit to another field is preserved with a fresh full workspace read', async () => {
  const { engine, api } = await setup();
  engine.edit({ date, field: 'phone', value: 3 });
  const remote = api.readState(); remote.metrics.leads = 99; remote.marketingDaily = setMarketingCount(remote.marketingDaily, date, 'Equipe Mult Portas', 'newContacts', 8); api.replaceState(remote);
  await engine.sync();
  assert.equal(api.readState().metrics.leads, 99);
  assert.equal(count(engine, 'newContacts'), 8);
  assert.equal(count(engine, 'phone'), 3);
});
test('same-counter conflicts ask for a decision instead of overwriting the website', async () => {
  const { engine, api } = await setup();
  engine.edit({ date, field: 'phone', value: 3 });
  const remote = api.readState(); remote.marketingDaily = setMarketingCount(remote.marketingDaily, date, 'Equipe Mult Portas', 'phone', 9); api.replaceState(remote);
  await engine.sync(); assert.equal(engine.status, 'conflict'); assert.equal(api.readState().marketingDaily.days[0].phone, 9);
  await engine.resolveConflict('local'); assert.equal(api.readState().marketingDaily.days[0].phone, 3); assert.equal(engine.pendingCount(), 0);
});
test('using website numbers drops only conflicting pending edits, preserving other local counters', async () => {
  const { engine, api } = await setup();
  engine.edit({ date, field: 'phone', value: 3 }); engine.edit({ date, field: 'interacting', value: 4 });
  const remote = api.readState(); remote.marketingDaily = setMarketingCount(remote.marketingDaily, date, 'Equipe Mult Portas', 'phone', 9); api.replaceState(remote);
  await engine.sync(); await engine.resolveConflict('server');
  assert.equal(count(engine, 'phone'), 9); assert.equal(count(engine, 'interacting'), 4); assert.equal(engine.pendingCount(), 0);
});
test('offline counters survive a process restart without ever storing a password', async () => {
  const vault = memoryVault(); const api = createMockApi(); let offline = false;
  const fetch = (...args) => offline ? Promise.reject(new Error('offline')) : api(...args);
  const first = await setup({ vault, api: fetch });
  first.engine.edit({ date, field: 'phone', value: 12 }); offline = true; await first.engine.sync();
  const restarted = new MarketingEngine({ vault, fetchImpl: fetch, now: () => new Date(`${date}T14:00:00Z`) });
  await restarted.restore(); assert.equal(restarted.status, 'offline'); assert.equal(count(restarted, 'phone'), 12);
  assert.ok(!JSON.stringify(vault.read()).includes(credentials.password));
  offline = false; await restarted.sync(); assert.equal(api.readState().marketingDaily.days[0].phone, 12);
});
test('a lost successful save response never applies the same edit twice', async () => {
  const api = createMockApi(); let loseResponse = false;
  const fetch = async (...args) => { const response = await api(...args); if (loseResponse && args[1].method === 'PUT') { loseResponse = false; throw new Error('response lost'); } return response; };
  const { engine } = await setup({ api: fetch });
  engine.edit({ date, field: 'newContacts', delta: 1 }); loseResponse = true; await engine.sync(); assert.equal(engine.pendingCount(), 1);
  await engine.sync(); assert.equal(count(engine, 'newContacts'), 1); assert.equal(engine.pendingCount(), 0); assert.equal(api.readState().marketingDaily.days[0].newContacts, 1);
});
test('new clicks during an in-flight save are retained and synced exactly once', async () => {
  const api = createMockApi(); let release; let started;
  const entered = new Promise(resolve => { started = resolve; }); let delay = true;
  const fetch = async (...args) => { if (delay && args[1].method === 'PUT') { delay = false; started(); await new Promise(resolve => { release = resolve; }); } return api(...args); };
  const { engine } = await setup({ api: fetch });
  engine.edit({ date, field: 'phone', delta: 1 }); const saving = engine.sync(); await entered;
  engine.edit({ date, field: 'phone', delta: 1 }); engine.edit({ date, field: 'phone', delta: 1 }); release(); await saving;
  assert.equal(count(engine, 'phone'), 3); assert.equal(api.readState().marketingDaily.days[0].phone, 3); assert.equal(engine.pendingCount(), 0);
});
test('a revision conflict is retried against the new workspace without losing unrelated state', async () => {
  const api = createMockApi(); let first = true;
  const fetch = async (...args) => { if (first && args[1].method === 'PUT') { first = false; const state = api.readState(); state.metrics.leads = 51; api.replaceState(state); } return api(...args); };
  const { engine } = await setup({ api: fetch }); engine.edit({ date, field: 'phone', value: 2 }); await engine.sync();
  assert.equal(api.readState().metrics.leads, 51); assert.equal(api.readState().marketingDaily.days[0].phone, 2);
});
test('revoked sessions cannot sync and pending counts remain available for the correct account', async () => {
  const { engine, api, vault } = await setup(); engine.edit({ date, field: 'phone', value: 5 }); api.revoke(); await engine.sync();
  assert.equal(engine.user, null); assert.equal(engine.status, 'signed-out'); assert.equal(vault.read().accounts['9001'].pending[0].value, 5);
  await engine.login(credentials); assert.equal(count(engine, 'phone'), 5); assert.equal(engine.pendingCount(), 0);
});
test('remember unchecked keeps the session only in memory, while counts remain protected on disk', async () => {
  const { engine, vault } = await setup(); await engine.logout(); await engine.login({ ...credentials, remember: false });
  engine.edit({ date, field: 'phone', value: 2 }); assert.equal(vault.read().authRaw, null); assert.equal(vault.read().accounts['9001'].pending[0].value, 2);
});
test('midnight rollover, reset, date-free report and count bounds match the site', async () => {
  let now = new Date('2026-10-16T02:59:59Z');
  const { engine } = await setup({ options: { now: () => now } }); engine.edit({ date, field: 'phone', value: 5 });
  engine.edit({ date, field: 'phone', delta: -1 }); assert.equal(count(engine, 'phone'), 4);
  assert.ok(!engine.report(date).includes('15/10')); assert.ok(engine.report(date).includes('Contatos via fone: 4'));
  now = new Date('2026-10-16T03:00:00Z'); assert.equal(marketingDateKey(now), '2026-10-16');
  assert.throws(() => engine.reset(date), /dia mudou/); assert.throws(() => engine.edit({ date, field: 'phone', value: 0 }), /dia mudou/);
  assert.equal(getMarketingDay(engine.currentMarketing(), '2026-10-16', 'Equipe Mult Portas').phone, 0);
  assert.equal(getMarketingDay(engine.currentMarketing(), date, 'Equipe Mult Portas').phone, 4);
  engine.edit({ date: '2026-10-16', field: 'phone', value: 8 }); engine.reset('2026-10-16');
  assert.equal(getMarketingDay(engine.currentMarketing(), date, 'Equipe Mult Portas').phone, 4);
  assert.equal(getMarketingDay(engine.currentMarketing(), '2026-10-16', 'Equipe Mult Portas').phone, 0);
});
test('session tokens are stripped from renderer payloads and requests carry the approved app Origin', async () => {
  const api = createMockApi(); const calls = []; const values = [];
  const { engine } = await setup({ api: (url, init) => { calls.push(init); return api(url, init); }, options: { onChange: view => values.push(view) } });
  assert.ok(calls.every(init => new Headers(init.headers).get('Origin') === SITE_ORIGIN));
  assert.ok(!JSON.stringify(values).includes('"token"')); assert.ok(!JSON.stringify(engine.view()).includes('authRaw'));
});
test('a blocked or failed disk write leaves the previous pending edit intact', async () => {
  const original = memoryVault(); let blocked = false;
  const vault = { read: original.read, write: value => { if (blocked) throw new Error('disk full'); original.write(value); } };
  const { engine } = await setup({ vault }); engine.edit({ date, field: 'phone', value: 4 }); blocked = true;
  assert.throws(() => engine.edit({ date, field: 'phone', value: 9 }), /disk full/); assert.equal(count(engine, 'phone'), 4);
});
test('pending changes cannot be reassigned to another account', async () => {
  const { engine, vault } = await setup(); engine.edit({ date, field: 'phone', value: 11 });
  engine.activate({ id: 9002, username: 'outro', displayName: 'Outra pessoa', branch: 'São Carlos' });
  assert.equal(count(engine, 'phone'), 0); assert.equal(engine.pendingCount(), 0); assert.equal(vault.read().accounts['9001'].pending[0].value, 11);
});

test('an open offline app locks expired sessions before exposing data or accepting operations', async t => {
  const operations = [
    ['view', engine => { const view = engine.view(); assert.equal(view.user, null); assert.deepEqual(view.marketing, { days: [] }); }],
    ['account', engine => assert.equal(engine.account(), null)],
    ['marketing', engine => assert.deepEqual(engine.currentMarketing(), { days: [] })],
    ['edit', engine => assert.throws(() => engine.edit({ date, field: 'phone', value: 99 }), /Aguarde|sessão/)],
    ['reset', engine => assert.throws(() => engine.reset(date), /Aguarde|sessão/)],
    ['report', engine => assert.throws(() => engine.report(date), /Entre na sua conta/)],
    ['sync', engine => engine.sync()],
    ['resolve', engine => engine.resolveConflict('local')],
  ];
  for (const [name, operation] of operations) await t.test(name, async () => {
    let now = new Date(`${date}T14:00:00Z`); let offline = false; let requests = 0;
    const api = createMockApi(); const changes = [];
    const fetch = async (...args) => {
      requests++;
      if (offline) throw new Error('simulated offline');
      const response = await api(...args);
      if (new URL(args[0]).pathname.endsWith('/api/auth/login') && response.ok) {
        return Response.json({ ...await response.json(), expiresAt: `${date}T14:01:00Z` });
      }
      return response;
    };
    const { engine, vault } = await setup({ api: fetch, options: { now: () => now, onChange: view => changes.push(view) } });
    engine.edit({ date, field: 'phone', value: 12 });
    offline = true; await engine.sync(); assert.equal(engine.status, 'offline');
    const accounts = vault.read().accounts; const remote = api.readState(); const sent = requests;
    now = new Date(`${date}T14:01:00Z`);
    await operation(engine);
    assert.equal(engine.user, null);
    assert.equal(engine.status, 'signed-out');
    assert.equal(engine.authRaw, null);
    assert.equal(vault.read().authRaw, null);
    assert.deepEqual(vault.read().accounts, accounts);
    assert.deepEqual(api.readState(), remote);
    assert.equal(requests, sent, 'no request is sent with an expired local session');
    assert.equal(changes.at(-1).user, null, 'the visible workspace is locked immediately');
    assert.deepEqual(changes.at(-1).marketing, { days: [] });
  });
});

test('signing in again after local expiration recovers and syncs the same protected pending edits', async () => {
  let now = new Date(`${date}T14:00:00Z`); const api = createMockApi();
  const fetch = async (...args) => {
    const response = await api(...args);
    if (new URL(args[0]).pathname.endsWith('/api/auth/login') && response.ok) {
      return Response.json({ ...await response.json(), expiresAt: new Date(now.getTime() + 60_000).toISOString() });
    }
    return response;
  };
  const { engine, vault } = await setup({ api: fetch, options: { now: () => now } });
  engine.edit({ date, field: 'phone', value: 12 });
  now = new Date(`${date}T14:01:00Z`);
  assert.equal(engine.view().user, null);
  assert.equal(vault.read().accounts['9001'].pending[0].value, 12);
  await engine.login(credentials);
  assert.equal(engine.status, 'synced');
  assert.equal(count(engine, 'phone'), 12);
  assert.equal(api.readState().marketingDaily.days[0].phone, 12);
  assert.equal(engine.pendingCount(), 0);
});

test('expiration during an in-flight read cannot send queued edits or consume their local copy', async () => {
  let now = new Date(`${date}T14:00:00Z`); let delayRead = false; let release; let started; let writes = 0;
  const entered = new Promise(resolve => { started = resolve; }); const api = createMockApi();
  const fetch = async (...args) => {
    const route = new URL(args[0]).pathname;
    if (delayRead && route.endsWith('/api/data') && args[1].method === 'GET') {
      delayRead = false; started(); await new Promise(resolve => { release = resolve; });
    }
    if (args[1].method === 'PUT') writes++;
    const response = await api(...args);
    if (route.endsWith('/api/auth/login') && response.ok) return Response.json({ ...await response.json(), expiresAt: `${date}T14:01:00Z` });
    return response;
  };
  const { engine, vault } = await setup({ api: fetch, options: { now: () => now } });
  engine.edit({ date, field: 'phone', value: 7 }); const accounts = vault.read().accounts;
  delayRead = true; const syncing = engine.sync(); await entered;
  now = new Date(`${date}T14:01:00Z`); release(); await syncing;
  assert.equal(engine.user, null);
  assert.equal(engine.status, 'signed-out');
  assert.equal(writes, 0);
  assert.deepEqual(vault.read().accounts, accounts);
  assert.deepEqual(engine.view().marketing, { days: [] });
});
