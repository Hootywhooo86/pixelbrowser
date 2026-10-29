// Preload for the Library window (bookmarks manager + history). Local UI only.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pixelLibrary', {
  bookmarks: () => ipcRenderer.invoke('library:bookmarks'),
  updateBookmark: (id, patch) => ipcRenderer.invoke('library:bookmark-update', id, patch),
  removeBookmark: (id) => ipcRenderer.invoke('library:bookmark-remove', id),
  addFolder: (name) => ipcRenderer.invoke('library:folder-add', name),
  renameFolder: (from, to) => ipcRenderer.invoke('library:folder-rename', from, to),
  removeFolder: (name) => ipcRenderer.invoke('library:folder-remove', name),
  history: (query) => ipcRenderer.invoke('library:history', query),
  removeHistory: (id) => ipcRenderer.invoke('library:history-remove', id),
  clearHistory: (range, siteData) => ipcRenderer.invoke('library:history-clear', range, siteData),
  open: (url, newTab) => ipcRenderer.send('library:open', url, newTab),
  onGoto: (fn) => ipcRenderer.on('library:goto', (_e, section) => fn(section)),
  onChanged: (fn) => ipcRenderer.on('library:changed', () => fn()),
})
