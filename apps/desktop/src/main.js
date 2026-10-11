// Pixelbrowser desktop — main process.
//
// One BrowserWindow per browser window. The window's own webContents is the
// pixel shell (src/ui); every tab is a WebContentsView laid out underneath it.
// Chrome extensions come from electron-chrome-extensions + the Chrome Web
// Store; ads and trackers are blocked by the Ghostery engine (same filter
// lists Brave-style blockers use).

const path = require('node:path')
const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu } = require('electron')
const { ElectronChromeExtensions } = require('electron-chrome-extensions')
const { installChromeWebStore, updateExtensions } = require('electron-chrome-web-store')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const SHELL_HEIGHT = 96 // px: tab strip + toolbar
const HOME_URL = 'https://duckduckgo.com'
const PROFILE_PARTITION = 'persist:pixel'

// Privacy defaults, applied before any window opens.
app.commandLine.appendSwitch('disable-features', 'InterestFeedContentSuggestions,PrivacySandboxAdsAPIs')
app.commandLine.appendSwitch('enable-features', 'ReduceUserAgent')

const windows = new Map() // BrowserWindow.id -> PixelWindow
let blocker = null

function normalizeInput(input) {
  const text = String(input || '').trim()
  if (!text) return HOME_URL
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || text.startsWith('about:')) return text
  if (/^[^\s]+\.[^\s]{2,}$/.test(text) || text.startsWith('localhost')) return `https://${text}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`
}

class PixelWindow {
  constructor({ ses, extensions, isPrivate }) {
    this.ses = ses
    this.extensions = extensions
    this.isPrivate = isPrivate
    this.tabs = [] // { id, view }
    this.activeId = null
    this.blockedCount = 0

    this.win = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 480,
      minHeight: 360,
      title: isPrivate ? 'Pixelbrowser — Private' : 'Pixelbrowser',
      backgroundColor: '#0b0b16',
      webPreferences: {
        session: ses,
        preload: path.join(__dirname, 'preload.js'),
        // The shell is local, trusted UI; it needs node in preload to inject
        // the <browser-action-list> element. Tabs stay fully sandboxed.
        sandbox: false,
        contextIsolation: true,
      },
    })
    windows.set(this.win.id, this)

    this.win.loadFile(path.join(__dirname, 'ui', 'index.html'), {
      query: { private: isPrivate ? '1' : '0' },
    })
    this.win.on('resize', () => this.layout())
    this.win.on('closed', () => {
      for (const tab of this.tabs) this.destroyTab(tab)
      windows.delete(this.win.id)
    })
  }

  send(channel, payload) {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload)
  }

  tabState(tab) {
    const wc = tab.view.webContents
    return {
      id: tab.id,
      url: wc.getURL(),
      title: wc.getTitle() || 'New tab',
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    }
  }

  pushState() {
    this.send('tabs:state', {
      activeId: this.activeId,
      tabs: this.tabs.map((t) => this.tabState(t)),
      blockedCount: this.blockedCount,
      isPrivate: this.isPrivate,
    })
  }

  createTab(url = HOME_URL) {
    const view = new WebContentsView({
      webPreferences: { session: this.ses, sandbox: true, contextIsolation: true },
    })
    const wc = view.webContents
    const tab = { id: wc.id, view }
    this.tabs.push(tab)
    this.extensions.addTab(wc, this.win)

    const update = () => this.pushState()
    wc.on('did-start-loading', update)
    wc.on('did-stop-loading', update)
    wc.on('did-navigate', update)
    wc.on('did-navigate-in-page', update)
    wc.on('page-title-updated', update)
    wc.setWindowOpenHandler(({ url: target }) => {
      this.selectTab(this.createTab(target).id)
      return { action: 'deny' }
    })
    wc.on('context-menu', (_e, params) => {
      const items = this.extensions.getContextMenuItems(wc, params)
      if (params.linkURL) {
        items.unshift({ label: 'Open link in new tab', click: () => this.createTab(params.linkURL) })
      }
      if (items.length) Menu.buildFromTemplate(items).popup({ window: this.win })
    })

    wc.loadURL(normalizeInput(url))
    this.selectTab(tab.id)
    return tab
  }

  getTab(id) {
    return this.tabs.find((t) => t.id === id)
  }

  activeTab() {
    return this.getTab(this.activeId)
  }

  selectTab(id) {
    const tab = this.getTab(id)
    if (!tab) return
    const prev = this.activeTab()
    if (prev && prev !== tab) this.win.contentView.removeChildView(prev.view)
    this.win.contentView.addChildView(tab.view)
    this.activeId = id
    this.layout()
    this.extensions.selectTab(tab.view.webContents)
    tab.view.webContents.focus()
    this.pushState()
  }

  destroyTab(tab) {
    const wc = tab.view.webContents
    if (wc.isDestroyed()) return
    this.extensions.removeTab(wc)
    wc.close()
  }

  closeTab(id) {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    const [tab] = this.tabs.splice(idx, 1)
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(tab.view)
    this.destroyTab(tab)
    if (this.tabs.length === 0) return this.win.close()
    if (this.activeId === id) this.selectTab(this.tabs[Math.min(idx, this.tabs.length - 1)].id)
    else this.pushState()
  }

  layout() {
    const tab = this.activeTab()
    if (!tab) return
    const { width, height } = this.win.getContentBounds()
    tab.view.setBounds({ x: 0, y: SHELL_HEIGHT, width, height: Math.max(0, height - SHELL_HEIGHT) })
  }
}

// ---------- sessions ----------

const sessionSetup = new Map() // Session -> ElectronChromeExtensions

async function prepareSession(ses, { isPrivate }) {
  if (sessionSetup.has(ses)) return sessionSetup.get(ses)

  const extensions = new ElectronChromeExtensions({
    license: 'GPL-3.0',
    session: ses,
    createTab: async (details) => {
      const pw = windowForExtensionCall(details.windowId, ses)
      const tab = pw.createTab(details.url)
      if (details.active === false && pw.tabs.length > 1) pw.selectTab(pw.tabs[pw.tabs.length - 2].id)
      return [tab.view.webContents, pw.win]
    },
    selectTab: (wc, win) => {
      const pw = windows.get(win.id)
      pw?.selectTab(wc.id)
    },
    removeTab: (wc, win) => {
      windows.get(win.id)?.closeTab(wc.id)
    },
    createWindow: async (details) => {
      const pw = new PixelWindow({ ses, extensions, isPrivate })
      pw.createTab(Array.isArray(details.url) ? details.url[0] : details.url)
      return pw.win
    },
    removeWindow: (win) => win.close(),
  })
  ElectronChromeExtensions.handleCRXProtocol(ses)
  sessionSetup.set(ses, extensions)

  // Private by default: block third-party ad/tracker requests everywhere.
  if (blocker) attachBlocker(ses)

  // No silent permission grants. Geolocation, camera etc. are denied until
  // we ship a pixel permission prompt.
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['fullscreen', 'clipboard-sanitized-write'].includes(permission))
  })

  // Do Not Track + Global Privacy Control on every request.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders.DNT = '1'
    details.requestHeaders['Sec-GPC'] = '1'
    callback({ requestHeaders: details.requestHeaders })
  })

  if (!isPrivate) {
    // Extensions only live in the persistent profile; private windows run clean.
    await installChromeWebStore({ session: ses, autoUpdate: true })
  }
  return extensions
}

function windowForExtensionCall(windowId, ses) {
  const pw = windowId != null ? windows.get(windowId) : null
  if (pw) return pw
  const focused = BrowserWindow.getFocusedWindow()
  const fpw = focused && windows.get(focused.id)
  if (fpw && fpw.ses === ses) return fpw
  return [...windows.values()].find((w) => w.ses === ses)
}

function attachBlocker(ses) {
  blocker.enableBlockingInSession(ses)
}

async function loadBlocker() {
  try {
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
    blocker.on('request-blocked', (request) => {
      const wcId = request.tabId
      for (const pw of windows.values()) {
        if (pw.getTab(wcId)) {
          pw.blockedCount += 1
          pw.pushState()
        }
      }
    })
    for (const ses of sessionSetup.keys()) attachBlocker(ses)
  } catch (err) {
    console.error('[privacy] could not load block lists, browsing continues unblocked:', err.message)
  }
}

async function openWindow({ isPrivate = false, url } = {}) {
  // Private windows get an in-memory partition: nothing touches disk.
  const ses = isPrivate
    ? session.fromPartition(`private-${Date.now()}`)
    : session.fromPartition(PROFILE_PARTITION)
  const extensions = await prepareSession(ses, { isPrivate })
  const pw = new PixelWindow({ ses, extensions, isPrivate })
  pw.win.webContents.once('did-finish-load', () => pw.createTab(url))
  return pw
}

// ---------- IPC from the pixel shell ----------

function fromSender(event) {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win && windows.get(win.id)
}

ipcMain.on('tab:new', (e, url) => fromSender(e)?.createTab(url))
ipcMain.on('tab:select', (e, id) => fromSender(e)?.selectTab(id))
ipcMain.on('tab:close', (e, id) => fromSender(e)?.closeTab(id))
ipcMain.on('nav:go', (e, input) => fromSender(e)?.activeTab()?.view.webContents.loadURL(normalizeInput(input)))
ipcMain.on('nav:back', (e) => fromSender(e)?.activeTab()?.view.webContents.navigationHistory.goBack())
ipcMain.on('nav:forward', (e) => fromSender(e)?.activeTab()?.view.webContents.navigationHistory.goForward())
ipcMain.on('nav:reload', (e) => fromSender(e)?.activeTab()?.view.webContents.reload())
ipcMain.on('nav:stop', (e) => fromSender(e)?.activeTab()?.view.webContents.stop())
ipcMain.on('window:private', () => openWindow({ isPrivate: true }))
ipcMain.on('extensions:store', (e) => fromSender(e)?.createTab('https://chromewebstore.google.com/'))

// ---------- app lifecycle ----------

app.whenReady().then(async () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      {
        label: 'File',
        submenu: [
          { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: (_i, w) => w && windows.get(w.id)?.createTab() },
          { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => openWindow() },
          { label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => openWindow({ isPrivate: true }) },
          { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: (_i, w) => { const pw = w && windows.get(w.id); pw?.closeTab(pw.activeId) } },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: (_i, w) => w && windows.get(w.id)?.activeTab()?.view.webContents.reload() },
          { label: 'Developer Tools', accelerator: 'F12', click: (_i, w) => w && windows.get(w.id)?.activeTab()?.view.webContents.toggleDevTools() },
          { role: 'togglefullscreen' },
        ],
      },
    ])
  )

  await loadBlocker()
  await openWindow({ url: process.env.PIXEL_START_URL })
  updateExtensions().catch(() => {})
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (windows.size === 0) openWindow()
})
