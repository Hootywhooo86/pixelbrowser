// Preload for the pixel shell only (never for web tabs).
const { contextBridge, ipcRenderer } = require('electron')
const { injectBrowserAction } = require('electron-chrome-extensions/browser-action')

// Adds the <browser-action-list> element: extension icons + popups.
injectBrowserAction()

contextBridge.exposeInMainWorld('pixel', {
  newTab: (url) => ipcRenderer.send('tab:new', url),
  selectTab: (id) => ipcRenderer.send('tab:select', id),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  tabMenu: (id) => ipcRenderer.send('tab:menu', id),
  pinTab: (id, pinned) => ipcRenderer.send('tab:pin', id, pinned),
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
  // Downloads: { id, name, path, state: progressing|completed|cancelled|interrupted, received, total, mime }
  onDownload: (fn) => ipcRenderer.on('download', (_e, d) => fn(d)),
  openDownload: (id) => ipcRenderer.send('download:open', id),
  showDownload: (id) => ipcRenderer.send('download:show', id),
  // 0.4: shell height, bookmarks, find, info bars, reader, menu
  shellHeight: (h) => ipcRenderer.send('shell:height', h),
  toggleBookmark: () => ipcRenderer.send('bookmark:toggle'),
  bookmarkMenu: (id) => ipcRenderer.send('bookmark:menu', id),
  folderMenu: (name) => ipcRenderer.send('bookmark:folder-menu', name),
  find: (text, opts) => ipcRenderer.send('find:query', text, opts),
  stopFind: (keepOpen) => ipcRenderer.send('find:stop', keepOpen),
  onFind: (fn) => ipcRenderer.on('find', (_e, cmd) => fn(cmd)),
  answerPrompt: (id, action) => ipcRenderer.send('prompt:answer', id, action),
  toggleReader: () => ipcRenderer.send('reader:toggle'),
  appMenu: () => ipcRenderer.send('app:menu'),
  onToast: (fn) => ipcRenderer.on('toast', (_e, text) => fn(text)),
})
