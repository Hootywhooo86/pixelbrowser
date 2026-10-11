// Pixelbrowser desktop — main process.
//
// One BrowserWindow per browser window. The window's own webContents is the
// pixel shell (src/ui); every tab is a WebContentsView laid out underneath it.
// Chrome extensions come from electron-chrome-extensions + the Chrome Web
// Store; ads and trackers are blocked by the Ghostery engine (same filter
// lists Brave-style blockers use). The AI sidebar (ai-host.js) and encrypted
// sync (sync-host.js) plug in here too.

const path = require('node:path')
const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu } = require('electron')
const { ElectronChromeExtensions } = require('electron-chrome-extensions')
const { installChromeWebStore, updateExtensions } = require('electron-chrome-web-store')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')
const { looksLikeQuestion, isAllowedUrl } = require('@pixelbrowser/ai-core')
const store = require('./store')
const syncHost = require('./sync-host')
const { AISession, publicState, saveSettings, applyRemoteSettings, syncedSettingsChanged } = require('./ai-host')

const SHELL_HEIGHT = 96 // px: tab strip + toolbar
const HOME_URL = 'https://duckduckgo.com'
const PROFILE_PARTITION = 'persist:pixel'
const SIDEBAR_WIDTH = 400
const SIDEBAR_HEADER = 44 // px of the sidebar UI kept above an AI web app

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
    this.sidebar = { open: false, view: null, ready: null, appView: null, app: null }
    this.agentActive = false
    this.ai = new AISession(this)

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
      this.ai.stop()
      for (const tab of this.tabs) this.destroyTab(tab)
      for (const v of [this.sidebar.view, this.sidebar.appView]) if (v && !v.webContents.isDestroyed()) v.webContents.close()
      windows.delete(this.win.id)
      publishTabs()
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
      sidebarOpen: this.sidebar.open,
      agentActive: this.agentActive,
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
    wc.on('did-stop-loading', () => {
      update()
      if (!this.isPrivate) {
        store.history.add(wc.getURL(), wc.getTitle())
        publishTabs()
      }
    })
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
      if (params.selectionText && !this.isPrivate) {
        const quote = params.selectionText.trim().slice(0, 80)
        items.unshift(
          { label: `Ask Pixel AI about "${quote}${params.selectionText.length > 80 ? '…' : ''}"`, click: () => this.askAI({ input: `Explain this: "${params.selectionText.trim()}"` }) },
          { type: 'separator' }
        )
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
    publishTabs()
    if (this.tabs.length === 0) return this.win.close()
    if (this.activeId === id) this.selectTab(this.tabs[Math.min(idx, this.tabs.length - 1)].id)
    else this.pushState()
  }

  layout() {
    const { width, height } = this.win.getContentBounds()
    const bodyH = Math.max(0, height - SHELL_HEIGHT)
    const sideW = this.sidebar.open ? Math.min(SIDEBAR_WIDTH, Math.floor(width * 0.6)) : 0
    this.activeTab()?.view.setBounds({ x: 0, y: SHELL_HEIGHT, width: width - sideW, height: bodyH })
    const { view, appView, app: openApp } = this.sidebar
    if (view) view.setBounds({ x: width - sideW, y: SHELL_HEIGHT, width: sideW, height: openApp ? SIDEBAR_HEADER : bodyH })
    if (appView) appView.setBounds({ x: width - sideW, y: SHELL_HEIGHT + SIDEBAR_HEADER, width: sideW, height: Math.max(0, bodyH - SIDEBAR_HEADER) })
  }

  // ---------- AI sidebar ----------

  ensureSidebar() {
    if (this.sidebar.view) return this.sidebar.ready
    const view = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, 'sidebar-preload.js'), sandbox: true, contextIsolation: true },
    })
    view.setBackgroundColor('#0b0b16')
    this.sidebar.view = view
    this.sidebar.ready = new Promise((resolve) => view.webContents.once('did-finish-load', resolve))
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedUrl(url)) this.createTab(url)
      return { action: 'deny' }
    })
    view.webContents.loadFile(path.join(__dirname, 'ui', 'sidebar.html'), { query: { private: this.isPrivate ? '1' : '0' } })
    return this.sidebar.ready
  }

  async toggleSidebar(open = !this.sidebar.open) {
    if (open) {
      const ready = this.ensureSidebar()
      this.win.contentView.addChildView(this.sidebar.view)
      if (this.sidebar.appView) this.win.contentView.addChildView(this.sidebar.appView)
      this.sidebar.open = true
      this.layout()
      await ready
      this.sidebar.view.webContents.focus()
    } else if (this.sidebar.view) {
      this.win.contentView.removeChildView(this.sidebar.view)
      if (this.sidebar.appView) this.win.contentView.removeChildView(this.sidebar.appView)
      this.sidebar.open = false
      this.layout()
      this.activeTab()?.view.webContents.focus()
    }
    this.pushState()
  }

  sendSidebar(channel, payload) {
    const wc = this.sidebar.view?.webContents
    if (wc && !wc.isDestroyed()) wc.send(channel, payload)
  }

  setAgentActive(active) {
    this.agentActive = active
    this.pushState()
  }

  async askAI(request) {
    await this.toggleSidebar(true)
    if (this.sidebar.app) this.closeApp()
    this.ai.ask(request)
  }

  /** Open an AI web app (ChatGPT, Claude, Gemini…) inside the sidebar. */
  openApp(appId, url) {
    if (!isAllowedUrl(url)) return
    let view = this.sidebar.appView
    if (!view) {
      view = new WebContentsView({ webPreferences: { session: this.ses, sandbox: true, contextIsolation: true } })
      view.webContents.setWindowOpenHandler(({ url: target }) => {
        this.selectTab(this.createTab(target).id)
        return { action: 'deny' }
      })
      this.sidebar.appView = view
      if (this.sidebar.open) this.win.contentView.addChildView(view)
    }
    this.sidebar.app = appId
    view.webContents.loadURL(url)
    this.layout()
  }

  closeApp() {
    const view = this.sidebar.appView
    if (view) {
      this.win.contentView.removeChildView(view)
      view.webContents.close()
    }
    this.sidebar.appView = null
    this.sidebar.app = null
    this.layout()
  }
}

// Open tabs are shared (encrypted) with your other devices.
let tabsTimer = null
function publishTabs() {
  clearTimeout(tabsTimer)
  tabsTimer = setTimeout(() => {
    const tabs = []
    for (const pw of windows.values()) {
      if (pw.isPrivate) continue
      for (const t of pw.tabs) {
        const wc = t.view.webContents
        if (!wc.isDestroyed() && /^https?:/.test(wc.getURL())) tabs.push({ title: wc.getTitle(), url: wc.getURL() })
      }
    }
    store.putRecord('tabs', store.settings.data.deviceId, { deviceName: store.settings.data.deviceName, tabs: tabs.slice(0, 100) })
  }, 3000)
}

function askFromAddressBar(pw, text) {
  const question = text.replace(/^\?\s*/, '').trim()
  if (!question) return
  // Comet-style: regular results in the tab, an AI answer in the sidebar.
  const results = `https://duckduckgo.com/?q=${encodeURIComponent(question)}`
  const tab = pw.activeTab()
  if (tab) tab.view.webContents.loadURL(results)
  else pw.createTab(results)
  if (pw.isPrivate) return
  pw.askAI({ input: question, search: true, includePage: false })
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
ipcMain.on('nav:go', (e, input) => {
  const pw = fromSender(e)
  if (!pw) return
  const text = String(input || '').trim()
  if (!pw.isPrivate && (text.startsWith('?') || looksLikeQuestion(text))) return askFromAddressBar(pw, text)
  pw.activeTab()?.view.webContents.loadURL(normalizeInput(text))
})
ipcMain.on('nav:ask', (e, input) => {
  const pw = fromSender(e)
  if (pw) askFromAddressBar(pw, String(input || ''))
})
ipcMain.on('sidebar:toggle', (e) => fromSender(e)?.toggleSidebar())
ipcMain.on('nav:back', (e) => fromSender(e)?.activeTab()?.view.webContents.navigationHistory.goBack())
ipcMain.on('nav:forward', (e) => fromSender(e)?.activeTab()?.view.webContents.navigationHistory.goForward())
ipcMain.on('nav:reload', (e) => fromSender(e)?.activeTab()?.view.webContents.reload())
ipcMain.on('nav:stop', (e) => fromSender(e)?.activeTab()?.view.webContents.stop())
ipcMain.on('window:private', () => openWindow({ isPrivate: true }))
ipcMain.on('extensions:store', (e) => fromSender(e)?.createTab('https://chromewebstore.google.com/'))

// ---------- IPC from the AI sidebar ----------

function fromSidebar(event) {
  for (const pw of windows.values()) if (pw.sidebar.view?.webContents === event.sender) return pw
  return null
}

function sidebarTabs(pw) {
  return pw.tabs.map((t) => ({ id: t.id, title: t.view.webContents.getTitle() || 'New tab', url: t.view.webContents.getURL(), active: t.id === pw.activeId }))
}

ipcMain.handle('sidebar:get-state', (e) => {
  const pw = fromSidebar(e)
  return { ...publicState(), isPrivate: !!pw?.isPrivate, tabs: pw ? sidebarTabs(pw) : [], sync: syncHost.status(), remoteTabs: syncHost.remoteTabs(), app: pw?.sidebar.app || null }
})
ipcMain.handle('sidebar:tabs', (e) => {
  const pw = fromSidebar(e)
  return pw ? sidebarTabs(pw) : []
})
ipcMain.handle('ai:save-settings', (_e, values) => saveSettings(values))
ipcMain.on('ai:ask', (e, request) => fromSidebar(e)?.ai.ask(request))
ipcMain.on('ai:stop', (e) => fromSidebar(e)?.ai.stop())
ipcMain.on('ai:new-chat', (e) => fromSidebar(e)?.ai.newChat())
ipcMain.on('ai:confirm', (e, { id, ok }) => fromSidebar(e)?.ai.answerConfirm(id, ok))
ipcMain.on('sidebar:close', (e) => fromSidebar(e)?.toggleSidebar(false))
ipcMain.on('sidebar:open-url', (e, url) => {
  const pw = fromSidebar(e)
  if (pw && isAllowedUrl(url)) pw.selectTab(pw.createTab(url).id)
})
ipcMain.on('sidebar:open-app', (e, { id, url }) => fromSidebar(e)?.openApp(id, url))
ipcMain.on('sidebar:close-app', (e) => fromSidebar(e)?.closeApp())
ipcMain.on('sidebar:share-page', (e) => {
  const pw = fromSidebar(e)
  if (pw) pw.ai.sharePageWithApp(pw.sidebar.appView?.webContents)
})
ipcMain.handle('memory:set-enabled', (_e, on) => {
  store.settings.data.memoryEnabled = !!on
  store.settings.save()
  return publicState()
})
ipcMain.handle('memory:add', (_e, text) => {
  store.memory.add(text)
  return publicState()
})
ipcMain.handle('memory:remove', (_e, text) => {
  store.memory.remove(text)
  return publicState()
})
ipcMain.handle('sync:create', (_e, server) => syncHost.create(server))
ipcMain.handle('sync:join', (_e, { server, code }) => syncHost.join(server, code))
ipcMain.handle('sync:show-code', () => syncHost.showCode())
ipcMain.handle('sync:now', () => syncHost.syncNow())
ipcMain.handle('sync:leave', (_e, opts) => syncHost.leave(opts))
ipcMain.handle('sync:set-options', (_e, { syncKeys, deviceName }) => {
  if (syncKeys !== undefined) store.settings.data.sync.syncKeys = !!syncKeys
  if (deviceName) store.settings.data.deviceName = String(deviceName).slice(0, 40)
  store.settings.save()
  syncedSettingsChanged()
  publishTabs()
  return syncHost.status()
})

syncHost.onChange(({ status, changed }) => {
  if (changed.includes('settings')) applyRemoteSettings()
  for (const pw of windows.values()) {
    pw.sendSidebar('sidebar:state', { ...publicState(), sync: status, remoteTabs: syncHost.remoteTabs() })
  }
})

// Local data changes (memory the AI saved, history, tabs) go out on the next sync.
store.onLocalChange(() => syncHost.schedule())

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
          { label: 'Pixel AI Sidebar', accelerator: 'CmdOrCtrl+J', click: (_i, w) => w && windows.get(w.id)?.toggleSidebar() },
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
  syncHost.start()
  updateExtensions().catch(() => {})
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (windows.size === 0) openWindow()
})
