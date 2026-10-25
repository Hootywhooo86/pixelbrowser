// Preload for the pixel shell only (never for web tabs).
const { contextBridge, ipcRenderer } = require('electron')
const { injectBrowserAction } = require('electron-chrome-extensions/browser-action')

// Adds the <browser-action-list> element: extension icons + popups.
injectBrowserAction()

contextBridge.exposeInMainWorld('pixel', {
  newTab: (url) => ipcRenderer.send('tab:new', url),
  selectTab: (id) => ipcRenderer.send('tab:select', id),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  go: (input) => ipcRenderer.send('nav:go', input),
  ask: (input) => ipcRenderer.send('nav:ask', input),
  toggleSidebar: () => ipcRenderer.send('sidebar:toggle'),
  setAIEnabled: (on) => ipcRenderer.send('ai:set-enabled', on),
  openSettings: (section) => ipcRenderer.send('settings:open', section),
  installUpdate: () => ipcRenderer.send('update:install'),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  stop: () => ipcRenderer.send('nav:stop'),
  newPrivateWindow: () => ipcRenderer.send('window:private'),
  openExtensionStore: () => ipcRenderer.send('extensions:store'),
  shieldsMenu: () => ipcRenderer.send('shields:menu'),
  spaceMenu: () => ipcRenderer.send('space:menu'),
  panic: () => ipcRenderer.send('panic'),
  addToTracker: () => ipcRenderer.send('tracker:add'),
  unlock: (pin) => ipcRenderer.invoke('lock:unlock', pin),
  onState: (fn) => ipcRenderer.on('tabs:state', (_e, state) => fn(state)),
  onSound: (fn) => ipcRenderer.on('sound', (_e, kind) => fn(kind)),
})
