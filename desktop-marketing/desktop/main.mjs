import { app, BrowserWindow, ipcMain, safeStorage, clipboard, dialog, shell, Menu, session, net } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MarketingEngine } from './engine.mjs';
import { createVault } from './vault.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const entryUrl = pathToFileURL(path.join(directory, 'index.html')).href;
const SITE = 'https://icarololiveira123-art.github.io/guia-comercial-mult-portas/';
const testing = !app.isPackaged && process.env.MP_DESKTOP_E2E === '1';
if (testing && process.env.MP_DESKTOP_TEST_DATA) app.setPath('userData', process.env.MP_DESKTOP_TEST_DATA);
app.setName('Mult Portas Marketing');
app.setAppUserModelId('br.com.multportas.marketing');
let window;
let engine;
let timer;
let syncTimer;
const gotLock = testing ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { void engine.sync().catch(showError); }, 450);
}
function showError(error) {
  if (window && !window.isDestroyed()) window.webContents.send('marketing:error', error?.message ?? 'Não foi possível concluir. Tente novamente.');
}
function authenticateSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== entryUrl) throw new Error('Solicitação não autorizada.');
}
function handler(name, action) {
  ipcMain.handle(name, async (event, payload) => {
    try { authenticateSender(event); return { ok: true, value: await action(payload) }; }
    catch (error) { return { ok: false, error: error?.message ?? 'Não foi possível concluir. Tente novamente.' }; }
  });
}
async function start() {
  Menu.setApplicationMenu(null);
  const vault = testing ? createTestVault() : createVault(path.join(app.getPath('userData'), 'workspace.secure'), safeStorage);
  const network = testing && process.env.MP_DESKTOP_TEST_API ? (await import('../tests/mock-api.mjs')).createMockApi() : (url, init) => net.fetch(url, init);
  engine = new MarketingEngine({ vault, fetchImpl: network, onChange: view => {
    if (window && !window.isDestroyed()) window.webContents.send('marketing:change', view);
  } });
  handler('marketing:view', () => engine.view());
  handler('marketing:login', payload => engine.login(payload));
  handler('marketing:edit', payload => { const view = engine.edit(payload); scheduleSync(); return view; });
  handler('marketing:reset', async payload => {
    if (typeof payload?.date !== 'string') throw new Error('Dia inválido.');
    const { response } = await dialog.showMessageBox(window, { type: 'question', title: 'Zerar o dia', message: 'Zerar os seis contadores de hoje?', detail: 'Os registros dos outros dias continuam no histórico.', buttons: ['Cancelar', 'Zerar hoje'], defaultId: 0, cancelId: 0, noLink: true });
    if (response !== 1) return engine.view();
    const view = engine.reset(payload.date); scheduleSync(); return view;
  });
  handler('marketing:sync', () => engine.sync());
  handler('marketing:resolve', choice => engine.resolveConflict(choice));
  handler('marketing:logout', () => engine.logout());
  handler('marketing:copy', date => { clipboard.writeText(engine.report(date)); return true; });
  handler('marketing:export', async date => {
    const report = engine.report(date);
    const result = await dialog.showSaveDialog(window, { title: 'Salvar relatório', defaultPath: `Marketing-${date}.txt`, filters: [{ name: 'Arquivo de texto', extensions: ['txt'] }] });
    if (!result.canceled && result.filePath) { fs.writeFileSync(result.filePath, report, { encoding: 'utf8' }); return true; }
    return false;
  });
  handler('marketing:site', async () => { await shell.openExternal(SITE); return true; });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ title: 'Marketing Diário | Mult Portas', width: 1200, height: 850, minWidth: 820, minHeight: 650,
    backgroundColor: '#f5f6f8', autoHideMenuBar: true, show: false, icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: testing } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  let closing = false;
  window.on('close', async event => {
    if (closing || !engine.pendingCount()) return;
    event.preventDefault();
    const result = await dialog.showMessageBox(window, { type: 'info', title: 'Registros salvos neste computador',
      message: 'Ainda há alterações aguardando sincronização.', detail: 'Elas já estão salvas neste computador. Ao abrir novamente com a mesma conta, o aplicativo tenta enviá-las ao site.',
      buttons: ['Continuar no aplicativo', 'Fechar aplicativo'], defaultId: 0, cancelId: 0, noLink: true });
    if (result.response === 1) { closing = true; window.close(); }
  });
  await window.loadFile(path.join(directory, 'index.html'));
  void engine.restore().catch(showError);
  timer = setInterval(() => { void engine.sync().catch(showError); }, 20_000);
  window.on('focus', () => { if (engine.user && engine.status !== 'connecting') scheduleSync(); });
}
function createTestVault() {
  const file = path.join(app.getPath('userData'), 'test-workspace.json');
  return { read: () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null,
    write: value => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); } };
}
if (gotLock) app.whenReady().then(start).catch(error => {
  dialog.showErrorBox('Não foi possível abrir o Marketing diário', error.message); app.quit();
});
app.on('window-all-closed', () => { clearInterval(timer); clearTimeout(syncTimer); app.quit(); });
