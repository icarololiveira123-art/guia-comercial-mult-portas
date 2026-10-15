import { buildMarketingReport, formatMarketingDate, getMarketingDay, marketingCounters, marketingDateKey, MAX_MARKETING_COUNT } from '../app/lib/marketing-daily.mjs';

const $ = id => document.getElementById(id);
let view = null;
let selectedDate = '';
let busy = false;
let loginBusy = false;
let toastTimer;
const rows = new Map();
function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200);
}
function fail(error) { toast(error?.message || 'Não foi possível concluir. Tente novamente.'); }
function makeCounters() {
  for (const [index, counter] of marketingCounters.entries()) {
    const row = document.createElement('div'); row.className = 'counter-row';
    const indexLabel = document.createElement('span'); indexLabel.className = 'counter-index'; indexLabel.textContent = `0${index + 1}`;
    const copy = document.createElement('div'); copy.className = 'counter-copy';
    const label = document.createElement('label'); label.htmlFor = `count-${counter.id}`; label.textContent = counter.label;
    const desc = document.createElement('p'); desc.textContent = counter.description; copy.append(label, desc);
    const stepper = document.createElement('div'); stepper.className = 'stepper';
    const minus = document.createElement('button'); minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', `Diminuir ${counter.label}`);
    const input = document.createElement('input'); input.id = `count-${counter.id}`; input.type = 'number'; input.min = '0'; input.max = String(MAX_MARKETING_COUNT); input.step = '1'; input.setAttribute('aria-label', counter.label);
    const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '+'; plus.className = 'plus'; plus.setAttribute('aria-label', `Aumentar ${counter.label}`);
    const edit = async payload => {
      if (busy || !view?.user || selectedDate && selectedDate !== marketingDateKey()) return;
      try { accept(await window.marketing.edit({ field: counter.id, date: marketingDateKey(), ...payload })); }
      catch (error) { fail(error); render(); }
    };
    minus.addEventListener('click', () => { void edit({ delta: -1 }); });
    plus.addEventListener('click', () => { void edit({ delta: 1 }); });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('change', () => { const value = Number(input.value); if (!Number.isFinite(value)) { render(); return; } void edit({ value }); });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') input.blur(); });
    stepper.append(minus, input, plus); row.append(indexLabel, copy, stepper); $('counters').append(row);
    rows.set(counter.id, { input, minus, plus });
  }
}
function accept(next) {
  const previousId = view?.user?.id;
  view = next;
  if (previousId !== next.user?.id) selectedDate = '';
  render();
}
function render() {
  if (!view) return;
  const signedIn = Boolean(view.user);
  $('login-screen').hidden = signedIn; $('workspace').hidden = !signedIn;
  if (!signedIn) { if (!loginBusy) $('login-error').textContent = view.message || ''; return; }
  const today = marketingDateKey();
  if (selectedDate === today) selectedDate = '';
  const date = selectedDate || today;
  const isToday = date === today;
  const day = getMarketingDay(view.marketing, date, view.user.displayName);
  const editable = isToday && view.hasLoaded && !busy;
  $('profile-name').textContent = view.user.displayName;
  $('profile-branch').textContent = view.user.branch;
  $('avatar').textContent = view.user.displayName.trim().charAt(0).toLocaleUpperCase('pt-BR');
  $('seller-tag').textContent = day.seller;
  $('day-kind').textContent = isToday ? 'HOJE' : 'HISTÓRICO';
  $('day-date').textContent = formatMarketingDate(date);
  $('history-notice').hidden = isToday;
  $('report').value = buildMarketingReport(day);
  for (const { id } of marketingCounters) {
    const row = rows.get(id);
    if (document.activeElement !== row.input) row.input.value = String(day[id]);
    row.input.disabled = !editable;
    row.minus.disabled = !editable || day[id] === 0;
    row.plus.disabled = !editable || day[id] >= MAX_MARKETING_COUNT;
  }
  $('reset').hidden = !isToday;
  $('reset').disabled = !editable || !marketingCounters.some(c => day[c.id] > 0);
  $('logout').disabled = busy;
  $('sync').disabled = busy || view.status === 'syncing';
  $('copy').disabled = !view.hasLoaded || busy;
  $('export').disabled = !view.hasLoaded || busy;
  $('sync-label').textContent = ({ synced: 'Sincronizado', syncing: 'Sincronizando', offline: 'Sem conexão', conflict: 'Revisar números', pending: 'Salvo no computador' })[view.status] || 'Carregando';
  $('sync-dot').className = `status-dot ${view.status}`;
  $('connection-notice').hidden = !['offline', 'pending'].includes(view.status);
  $('connection-notice').textContent = view.message;
  $('save-status').textContent = view.status === 'synced' && view.syncedAt
    ? `Salvo às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(view.syncedAt))}`
    : view.pending ? `${view.pending} ${view.pending === 1 ? 'contador aguardando' : 'contadores aguardando'} sincronização` : view.message;
  $('conflict').hidden = !view.conflicts.length;
  $('conflict-details').replaceChildren(...view.conflicts.map(conflict => {
    const p = document.createElement('p'); p.className = 'conflict-line';
    p.textContent = `${formatMarketingDate(conflict.date)} · ${marketingCounters.find(c => c.id === conflict.field)?.label}: aplicativo ${conflict.local} / site ${conflict.remote}`; return p;
  }));
  const history = view.marketing.days.filter(d => d.date !== today);
  $('history-count').textContent = `${history.length} ${history.length === 1 ? 'dia registrado' : 'dias registrados'}`;
  const activeHistoryButton = document.activeElement?.dataset?.date;
  $('history-list').replaceChildren();
  if (!history.length) {
    const p = document.createElement('p'); p.className = 'history-empty'; p.textContent = 'O histórico aparece aqui a partir do próximo dia com registros. A lista de hoje já fica salva na sua conta.'; $('history-list').append(p);
  }
  for (const item of history) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'history-row'; button.dataset.date = item.date;
    button.setAttribute('aria-pressed', String(selectedDate === item.date));
    for (const text of [formatMarketingDate(item.date), item.seller, `${item.newContacts} contatos novos`, '→']) { const span = document.createElement('span'); span.textContent = text; button.append(span); }
    button.addEventListener('click', () => { selectedDate = item.date; render(); $('day-date').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    $('history-list').append(button);
    if (activeHistoryButton === item.date) button.focus({ preventScroll: true });
  }
}
async function locked(action) {
  if (busy) return;
  document.activeElement?.blur();
  busy = true; render();
  try { const result = await action(); if (result?.status) accept(result); }
  catch (error) { fail(error); }
  finally { busy = false; render(); }
}
makeCounters();
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); if (loginBusy) return;
  loginBusy = true; $('login-error').textContent = ''; $('login-button').disabled = true; $('login-button').textContent = 'Entrando…';
  try { accept(await window.marketing.login({ username: $('username').value, password: $('password').value, remember: $('remember').checked })); $('password').value = ''; }
  catch (error) { $('login-error').textContent = error.message; }
  finally { loginBusy = false; $('login-button').disabled = false; $('login-button').textContent = 'Entrar no Marketing diário →'; }
});
$('show-password').addEventListener('click', () => { const show = $('password').type === 'password'; $('password').type = show ? 'text' : 'password'; $('show-password').textContent = show ? 'Ocultar' : 'Mostrar'; $('show-password').setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha'); });
$('sync').addEventListener('click', () => { void locked(() => window.marketing.sync()); });
$('logout').addEventListener('click', () => { void locked(() => window.marketing.logout()); });
$('reset').addEventListener('click', () => { void locked(() => window.marketing.reset(marketingDateKey())); });
$('copy').addEventListener('click', async () => { document.activeElement?.blur(); try { await window.marketing.copy(selectedDate || marketingDateKey()); toast('Resumo copiado. É só colar no WhatsApp.'); } catch (error) { fail(error); } });
$('export').addEventListener('click', () => { void locked(async () => { if (await window.marketing.export(selectedDate || marketingDateKey())) toast('Relatório salvo.'); }); });
$('resolve-server').addEventListener('click', () => { void locked(() => window.marketing.resolve('server')); });
$('resolve-local').addEventListener('click', () => { void locked(() => window.marketing.resolve('local')); });
$('back-today').addEventListener('click', () => { selectedDate = ''; render(); });
$('today-nav').addEventListener('click', () => { selectedDate = ''; render(); $('day-date').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
$('history-nav').addEventListener('click', () => $('history-section').scrollIntoView({ behavior: 'smooth', block: 'start' }));
for (const button of document.querySelectorAll('.site-link')) button.addEventListener('click', () => { void window.marketing.openSite().catch(fail); });
window.marketing.onChange(accept);
window.marketing.onError(toast);
void window.marketing.view().then(accept).catch(fail);
setInterval(render, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
