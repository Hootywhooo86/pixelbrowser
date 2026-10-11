// Preload for the AI sidebar (local UI). Exposes a small, explicit API.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pixelAI', {
  getState: () => ipcRenderer.invoke('sidebar:get-state'),
  tabs: () => ipcRenderer.invoke('sidebar:tabs'),
  saveSettings: (values) => ipcRenderer.invoke('ai:save-settings', values),
  ask: (request) => ipcRenderer.send('ai:ask', request),
  stop: () => ipcRenderer.send('ai:stop'),
  newChat: () => ipcRenderer.send('ai:new-chat'),
  confirm: (id, ok) => ipcRenderer.send('ai:confirm', { id, ok }),
  close: () => ipcRenderer.send('sidebar:close'),
  openUrl: (url) => ipcRenderer.send('sidebar:open-url', url),
  openApp: (id, url) => ipcRenderer.send('sidebar:open-app', { id, url }),
  closeApp: () => ipcRenderer.send('sidebar:close-app'),
  sharePage: () => ipcRenderer.send('sidebar:share-page'),
  memory: {
    setEnabled: (on) => ipcRenderer.invoke('memory:set-enabled', on),
    add: (text) => ipcRenderer.invoke('memory:add', text),
    remove: (text) => ipcRenderer.invoke('memory:remove', text),
  },
  sync: {
    create: (server) => ipcRenderer.invoke('sync:create', server),
    join: (server, code) => ipcRenderer.invoke('sync:join', { server, code }),
    showCode: () => ipcRenderer.invoke('sync:show-code'),
    now: () => ipcRenderer.invoke('sync:now'),
    leave: (opts) => ipcRenderer.invoke('sync:leave', opts),
    setOptions: (opts) => ipcRenderer.invoke('sync:set-options', opts),
  },
  onEvent: (fn) => ipcRenderer.on('ai:event', (_e, ev) => fn(ev)),
  onState: (fn) => ipcRenderer.on('sidebar:state', (_e, st) => fn(st)),
})
