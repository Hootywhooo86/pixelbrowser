// Preload for the Settings window (local UI only).
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pixelSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  setSearch: (engine, customUrl) => ipcRenderer.invoke('settings:set-search', { engine, customUrl }),
  setAI: (on) => ipcRenderer.invoke('settings:set-ai', on),
  clearData: (opts) => ipcRenderer.invoke('settings:clear-data', opts),
  openUrl: (url) => ipcRenderer.send('settings:open-url', url),
  defaultBrowser: () => ipcRenderer.invoke('settings:default-browser'),
  makeDefault: () => ipcRenderer.invoke('settings:make-default'),
  set: (patch) => ipcRenderer.invoke('settings:update', patch),
  panic: (range) => ipcRenderer.invoke('settings:panic', range),
  dataReport: () => ipcRenderer.invoke('settings:data'),
  deleteData: (id) => ipcRenderer.invoke('settings:delete-data', id),
  onGoto: (fn) => ipcRenderer.on('settings:goto', (_e, section) => fn(section)),
  vaultReveal: (kind, id, pin) => ipcRenderer.invoke('vault:reveal', kind, id, pin),
  vaultSave: (kind, data) => ipcRenderer.invoke('vault:save', kind, data),
  vaultDelete: (kind, id) => ipcRenderer.invoke('vault:delete', kind, id),
  pickDownloadFolder: () => ipcRenderer.invoke('settings:pick-download-folder'),
  crashLog: () => ipcRenderer.invoke('settings:crash-log'),
  crashCopy: () => ipcRenderer.invoke('settings:crash-copy'),
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    setAuto: (on) => ipcRenderer.invoke('update:set-auto', on),
    install: () => ipcRenderer.send('update:install'),
  },
  sync: {
    create: (server) => ipcRenderer.invoke('sync:create', server),
    join: (server, code) => ipcRenderer.invoke('sync:join', { server, code }),
    showCode: () => ipcRenderer.invoke('sync:show-code'),
    now: () => ipcRenderer.invoke('sync:now'),
    leave: (opts) => ipcRenderer.invoke('sync:leave', opts),
    setOptions: (opts) => ipcRenderer.invoke('sync:set-options', opts),
  },
  onState: (fn) => ipcRenderer.on('settings:state', (_e, st) => fn(st)),
})
