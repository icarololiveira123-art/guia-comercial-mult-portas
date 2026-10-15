import { randomUUID } from 'node:crypto';
import { createSharedApiFetch, SHARED_SESSION_KEY } from '../app/lib/shared-api-client.mjs';
import { marketingCounters, marketingDateKey, normalizeMarketingCount, normalizeMarketingDaily, getMarketingDay, setMarketingCount, buildMarketingReport } from '../app/lib/marketing-daily.mjs';

export const API_BASE = 'https://duywnshiwiqkvicrdxdt.supabase.co/functions/v1/mult-portas-api';
export const SITE_ORIGIN = 'https://icarololiveira123-art.github.io';
const fields = new Set(marketingCounters.map(c => c.id));
const clone = value => structuredClone(value);
const validProfile = p => p && Number.isSafeInteger(p.id) && p.id > 0 && typeof p.displayName === 'string' && typeof p.username === 'string';

export function planMarketingUpdate(remote, pending) {
  let marketing = normalizeMarketingDaily(remote);
  const conflicts = [];
  for (const edit of pending) {
    const current = getMarketingDay(marketing, edit.date, edit.seller)[edit.field];
    if (current !== edit.base && current !== edit.value) conflicts.push({ ...edit, remote: current });
    else marketing = setMarketingCount(marketing, edit.date, edit.seller, edit.field, edit.value);
  }
  return { marketing, conflicts };
}

export class MarketingEngine {
  constructor({ vault, fetchImpl = globalThis.fetch, onChange = () => {}, now = () => new Date(), baseUrl = API_BASE }) {
    this.vault = vault;
    this.data = vault.read() ?? { version: 1, accounts: {} };
    this.data.accounts ??= {};
    this.authRaw = this.data.authRaw ?? null;
    this.remember = this.data.remember !== false;
    this.user = null;
    this.status = 'starting';
    this.message = '';
    this.conflicts = [];
    this.epoch = 0;
    this.now = now;
    this.onChange = onChange;
    this.syncPromise = null;
    this.api = createSharedApiFetch({ baseUrl, allowLocalhost: baseUrl !== API_BASE, storage: {
      getItem: key => key === SHARED_SESSION_KEY ? this.authRaw : null,
      setItem: (key, value) => { if (key === SHARED_SESSION_KEY) { this.authRaw = value; this.persist(); } },
      removeItem: key => { if (key === SHARED_SESSION_KEY) { this.authRaw = null; this.persist(); } },
    }, fetchImpl: (url, init) => {
      const headers = new Headers(init.headers);
      headers.set('Origin', SITE_ORIGIN);
      return fetchImpl(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(12_000) });
    } });
  }
  persist() {
    this.vault.write({ ...this.data, authRaw: this.remember ? this.authRaw : null, remember: this.remember });
  }
  account() {
    if (!this.user) return null;
    return this.data.accounts[String(this.user.id)] ?? null;
  }
  pendingCount() { return this.account()?.pending?.length ?? 0; }
  currentMarketing() {
    const account = this.account();
    let marketing = normalizeMarketingDaily(account?.marketing);
    for (const edit of account?.pending ?? []) marketing = setMarketingCount(marketing, edit.date, edit.seller, edit.field, edit.value);
    return marketing;
  }
  view() {
    return { user: this.user ? clone(this.user) : null, marketing: this.currentMarketing(), today: marketingDateKey(this.now()),
      status: this.status, message: this.message, pending: this.pendingCount(), hasLoaded: this.account()?.hasLoaded === true,
      syncedAt: this.account()?.syncedAt ?? null, conflicts: this.conflicts.map(c => ({ date: c.date, field: c.field, local: c.value, remote: c.remote })),
      remember: this.remember };
  }
  emit() { const view = this.view(); this.onChange(view); return view; }
  async request(path, { method = 'GET', body } = {}) {
    const response = await this.api(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.error || 'Não foi possível concluir. Tente novamente.'); error.status = response.status; throw error; }
    return result;
  }
  async restore() {
    if (!this.authRaw) { this.status = 'signed-out'; return this.emit(); }
    try {
      const result = await this.request('/api/auth/me');
      if (!validProfile(result.user) || result.admin) { this.authRaw = null; this.status = 'signed-out'; this.persist(); return this.emit(); }
      this.activate(result.user);
      await this.sync();
    } catch (error) {
      let session;
      try { session = JSON.parse(this.authRaw); } catch { /* A damaged session is never trusted. */ }
      const cached = this.data.profile;
      if (error.status === 503 && validProfile(cached) && session?.userId === cached.id && session.admin === false
        && (!session.expiresAt || Date.parse(session.expiresAt) > this.now().getTime()) && this.data.accounts[String(cached.id)]?.hasLoaded) {
        this.activate(cached); this.status = 'offline'; this.message = 'Sem conexão. Os registros ficam salvos neste computador até sincronizar.';
      } else { this.user = null; this.status = 'signed-out'; this.message = error.message; }
    }
    return this.emit();
  }
  activate(user) {
    this.epoch++;
    this.user = clone(user);
    this.data.profile = clone(user);
    this.data.accounts[String(user.id)] ??= { marketing: { days: [] }, pending: [], hasLoaded: false, syncedAt: null };
    this.conflicts = [];
    this.persist();
  }
  async login(input) {
    if (this.user) throw new Error('Saia da conta atual antes de trocar de usuário.');
    if (!input || typeof input.username !== 'string' || typeof input.password !== 'string'
      || input.username.length > 80 || !input.username.trim() || !input.password || input.password.length > 200) throw new Error('Preencha usuário e senha.');
    this.remember = input.remember === true;
    this.status = 'connecting'; this.message = ''; this.emit();
    try {
      const result = await this.request('/api/auth/login', { method: 'POST', body: { username: input.username.trim(), password: input.password } });
      if (!validProfile(result.user) || result.admin) {
        await this.request('/api/auth/logout', { method: 'POST' }).catch(() => {});
        this.authRaw = null; this.persist(); throw new Error('Entre com a sua conta de usuário cadastrada no site.');
      }
      this.activate(result.user);
      await this.sync();
      return this.emit();
    } catch (error) { this.status = 'signed-out'; this.message = error.message; this.emit(); throw error; }
  }
  edit({ field, value, delta, date }) {
    const account = this.account();
    if (!account?.hasLoaded) throw new Error('Aguarde os dados da sua conta carregarem.');
    const today = marketingDateKey(this.now());
    if (date !== today) throw new Error('O dia mudou. A lista anterior foi preservada; confira a lista de hoje.');
    if (!fields.has(field) || (delta !== undefined && ![1, -1].includes(delta)) || (delta === undefined && (typeof value !== 'number' || !Number.isFinite(value)))) throw new Error('Valor inválido.');
    const seller = this.user.displayName;
    const current = getMarketingDay(this.currentMarketing(), today, seller)[field];
    const desired = normalizeMarketingCount(delta === undefined ? value : current + delta);
    const previous = clone(account.pending);
    const existing = account.pending.find(e => e.date === today && e.field === field);
    if (existing) { existing.value = desired; existing.id = randomUUID(); }
    else if (current !== desired) account.pending.push({ id: randomUUID(), date: today, field, base: current, value: desired, seller });
    try { this.persist(); } catch (error) { account.pending = previous; throw error; }
    this.status = this.conflicts.length ? 'conflict' : 'pending';
    this.message = this.conflicts.length ? 'Este dia também foi editado no site. Escolha quais números manter.' : 'Salvo neste computador. Sincronizando com a sua conta…';
    return this.emit();
  }
  reset(date) {
    if (date !== marketingDateKey(this.now())) throw new Error('O dia mudou. Nenhum registro anterior foi zerado.');
    if (!this.account()?.hasLoaded) throw new Error('Aguarde os dados carregarem.');
    const previous = clone(this.account().pending);
    try {
      for (const { id } of marketingCounters) this.edit({ field: id, value: 0, date });
    } catch (error) { this.account().pending = previous; this.persist(); this.emit(); throw error; }
    return this.view();
  }
  async sync() {
    if (this.syncPromise) return this.syncPromise;
    if (!this.user || !this.authRaw) return this.view();
    const epoch = this.epoch;
    this.syncPromise = this.syncInternal(epoch).finally(() => { this.syncPromise = null; });
    return this.syncPromise;
  }
  async syncInternal(epoch) {
    const account = this.account();
    this.status = 'syncing'; this.message = 'Sincronizando…'; this.emit();
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await this.request('/api/data');
        if (epoch !== this.epoch) return this.view();
        if (remote.state !== null && (typeof remote.state !== 'object' || Array.isArray(remote.state))) throw new Error('O servidor enviou dados inválidos.');
        if (remote.revision !== null && typeof remote.revision !== 'string') throw new Error('O servidor enviou uma versão inválida.');
        account.marketing = normalizeMarketingDaily(remote.state?.marketingDaily);
        account.hasLoaded = true;
        const batch = clone(account.pending);
        const plan = planMarketingUpdate(account.marketing, batch);
        this.conflicts = plan.conflicts;
        if (this.conflicts.length) { this.status = 'conflict'; this.message = 'Este dia também foi editado no site. Escolha quais números manter.'; this.persist(); return this.emit(); }
        const dirty = JSON.stringify(plan.marketing) !== JSON.stringify(account.marketing);
        if (dirty) {
          try {
            // Always copy the latest full workspace. Only marketingDaily is changed;
            // progress is omitted so the server retains its independently merged state.
            await this.request('/api/data', { method: 'PUT', body: { state: { ...(remote.state ?? {}), marketingDaily: plan.marketing }, baseRevision: remote.revision } });
          } catch (error) { if (error.status === 409 && attempt < 3) continue; throw error; }
          if (epoch !== this.epoch) return this.view();
          account.marketing = plan.marketing;
        }
        for (const sent of batch) {
          const index = account.pending.findIndex(e => e.date === sent.date && e.field === sent.field);
          if (index < 0) continue;
          if (account.pending[index].id === sent.id) account.pending.splice(index, 1);
          else account.pending[index].base = sent.value;
        }
        account.syncedAt = this.now().toISOString();
        this.persist();
        if (account.pending.length && attempt < 3) continue;
        this.status = account.pending.length ? 'pending' : 'synced';
        this.message = account.pending.length ? 'Alterações salvas neste computador. Aguardando sincronização.' : 'Tudo salvo e sincronizado.';
        return this.emit();
      }
      this.status = 'pending'; this.message = 'O site está sendo atualizado. Tentarei sincronizar novamente em instantes.';
    } catch (error) {
      if (epoch !== this.epoch) return this.view();
      if (error.status === 401 || !this.authRaw) { this.user = null; this.epoch++; this.status = 'signed-out'; this.message = 'Sua sessão expirou. Entre novamente para sincronizar os registros salvos.'; }
      else { this.status = 'offline'; this.message = account.hasLoaded ? 'Sem conexão. Seus registros estão salvos neste computador e serão sincronizados ao reconectar.' : 'Não foi possível carregar os dados. Confira a conexão e clique em Sincronizar.'; }
      this.persist();
    }
    return this.emit();
  }
  async resolveConflict(choice) {
    if (!['local', 'server'].includes(choice)) throw new Error('Escolha inválida.');
    if (this.syncPromise) await this.syncPromise;
    if (!this.user || !this.conflicts.length) return this.view();
    const remote = await this.request('/api/data');
    const account = this.account();
    const plan = planMarketingUpdate(remote.state?.marketingDaily, account.pending);
    for (const conflict of plan.conflicts) {
      const index = account.pending.findIndex(e => e.id === conflict.id);
      if (index < 0) continue;
      if (choice === 'server') account.pending.splice(index, 1);
      else account.pending[index] = { ...account.pending[index], base: conflict.remote, id: randomUUID() };
    }
    account.marketing = normalizeMarketingDaily(remote.state?.marketingDaily);
    this.conflicts = [];
    this.persist();
    return this.sync();
  }
  async logout() {
    await this.sync();
    if (this.pendingCount()) throw new Error('Ainda há registros para sincronizar. Conecte-se à internet e sincronize antes de sair.');
    if (this.authRaw) await this.request('/api/auth/logout', { method: 'POST' });
    this.authRaw = null; this.user = null; this.epoch++; this.conflicts = [];
    this.status = 'signed-out'; this.message = ''; this.persist(); return this.emit();
  }
  report(date) {
    if (!this.user) throw new Error('Entre na sua conta primeiro.');
    if (date !== marketingDateKey(this.now()) && !this.currentMarketing().days.some(d => d.date === date)) throw new Error('Dia não encontrado.');
    return buildMarketingReport(getMarketingDay(this.currentMarketing(), date, this.user.displayName));
  }
}
