const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (name, payload) => {
  const result = await ipcRenderer.invoke(name, payload);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('marketing', {
  view: () => invoke('marketing:view'),
  login: value => invoke('marketing:login', value),
  edit: value => invoke('marketing:edit', value),
  reset: date => invoke('marketing:reset', { date }),
  sync: () => invoke('marketing:sync'),
  resolve: choice => invoke('marketing:resolve', choice),
  logout: () => invoke('marketing:logout'),
  copy: date => invoke('marketing:copy', date),
  export: date => invoke('marketing:export', date),
  openSite: () => invoke('marketing:site'),
  onChange: callback => { const listener = (_event, view) => callback(view); ipcRenderer.on('marketing:change', listener); return () => ipcRenderer.removeListener('marketing:change', listener); },
  onError: callback => { const listener = (_event, message) => callback(message); ipcRenderer.on('marketing:error', listener); return () => ipcRenderer.removeListener('marketing:error', listener); },
});
