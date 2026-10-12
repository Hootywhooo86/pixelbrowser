// Preload for the Settings window (local UI only).
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pixelSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  setSearch: (engine, customUrl) => ipcRenderer.invoke('settings:set-search', { engine, customUrl }),
  setAI: (on) => ipcRenderer.invoke('settings:set-ai', on),
  clearData: (opts) => ipcRenderer.invoke('settings:clear-data', opts),
  openUrl: (url) => ipcRenderer.send('settings:open-url', url),
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
