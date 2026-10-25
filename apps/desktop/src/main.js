// Bit Browser desktop — main process.
//
// One BrowserWindow per browser window. The window's own webContents is the
// pixel shell (src/ui); every tab is a WebContentsView laid out underneath it.
// Chrome extensions come from electron-chrome-extensions + the Chrome Web
// Store; ads and trackers are blocked by the Ghostery engine (same filter
// lists Brave-style blockers use). The AI sidebar (ai-host.js) and encrypted
// sync (sync-host.js) plug in here too.

const path = require('node:path')
const crypto = require('node:crypto')
const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, shell, dialog } = require('electron')

// The app was called Pixelbrowser before it became Bit Browser. Keep the
// old profile folder so settings, keys, extensions and sync survive the rename.
// Must run before ./store (and anything else) reads the userData path.
app.setPath('userData', path.join(app.getPath('appData'), 'Pixelbrowser'))

const { ElectronChromeExtensions } = require('electron-chrome-extensions')
const { installChromeWebStore, updateExtensions } = require('electron-chrome-web-store')
const { looksLikeQuestion, isAllowedUrl, SEARCH_ENGINES, searchUrlFor, searchHome } = require('@pixelbrowser/ai-core')
const store = require('./store')
const syncHost = require('./sync-host')
const updater = require('./updater')
const { AISession, publicState, saveSettings, applyRemoteSettings, syncedSettingsChanged } = require('./ai-host')
const shields = require('./shields')
const phishing = require('./phishing')
const xp = require('./xp')
const { THEMES, themeCss } = require('./ui/themes')

const SHELL_HEIGHT = 96 // px: tab strip + toolbar
const PROFILE_PARTITION = 'persist:pixel'
const SIDEBAR_WIDTH = 400
const SIDEBAR_HEADER = 44 // px of the sidebar UI kept above an AI web app

// Privacy defaults, applied before any window opens.
app.commandLine.appendSwitch('disable-features', 'InterestFeedContentSuggestions,PrivacySandboxAdsAPIs')
app.commandLine.appendSwitch('enable-features', 'ReduceUserAgent')
// Autoplay (Settings → Media). Chromium reads this once, so changes need a restart.
const AUTOPLAY = { off: 'user-gesture-required', muted: 'document-user-activation-required', on: 'no-user-gesture-required' }
app.commandLine.appendSwitch('autoplay-policy', AUTOPLAY[store.settings.data.autoplay] || AUTOPLAY.muted)

const WARNING_PAGE = path.join(__dirname, 'ui', 'warning.html')
// Links on the warning page go to this made-up host; main handles them.
const WARNING_ACTION = 'https://warning.bitbrowser.invalid/'
const STALE_TAB_MS = 3 * 24 * 60 * 60 * 1000

const windows = new Map() // BrowserWindow.id -> PixelWindow

const spaceList = () => store.settings.data.spaces.list
const defaultSpace = () => spaceList()[0]?.id || 'personal'

function homeUrl() {
  return searchHome(store.settings.data.searchEngine, store.settings.data.customSearchUrl)
}

/** Search with the engine chosen in Settings (its no-AI version when the AI slider is off). */
function searchFor(query, aiEnabled = store.settings.data.aiEnabled) {
  return searchUrlFor(store.settings.data.searchEngine, query, { aiEnabled, customUrl: store.settings.data.customSearchUrl })
}

function normalizeInput(input) {
  const text = String(input || '').trim()
  if (!text) return homeUrl()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || text.startsWith('about:')) return text
  if (/^[^\s]+\.[^\s]{2,}$/.test(text) || text.startsWith('localhost')) return `https://${text}`
  return searchFor(text)
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
      title: isPrivate ? 'Bit Browser — Private' : 'Bit Browser',
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
      aiEnabled: store.settings.data.aiEnabled,
      update: updater.status(),
      agentActive: this.agentActive,
    })
  }

  createTab(url = '') {
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
    // Full-screen video: the page fills the whole window (no tabs, toolbar or
    // sidebar) and the window goes full screen; everything comes back on exit.
    wc.on('enter-html-full-screen', () => {
      this.htmlFullscreen = true
      this.wasFullScreen = this.win.isFullScreen()
      if (!this.wasFullScreen) this.win.setFullScreen(true)
      this.layout()
    })
    wc.on('leave-html-full-screen', () => {
      this.htmlFullscreen = false
      if (!this.wasFullScreen && !this.win.isDestroyed()) this.win.setFullScreen(false)
      this.layout()
    })
    wc.setWindowOpenHandler(({ url: target }) => {
      this.selectTab(this.createTab(target).id)
      return { action: 'deny' }
    })
    wc.on('context-menu', (_e, params) => {
      const items = this.extensions.getContextMenuItems(wc, params)
      if (params.linkURL) {
        items.unshift({ label: 'Open link in new tab', click: () => this.createTab(params.linkURL) })
      }
      if (params.selectionText && !this.isPrivate && store.settings.data.aiEnabled) {
        const quote = params.selectionText.trim().slice(0, 80)
        items.unshift(
          { label: `Ask Bitter about "${quote}${params.selectionText.length > 80 ? '…' : ''}"`, click: () => this.askAI({ input: `Explain this: "${params.selectionText.trim()}"` }) },
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
    if (this.htmlFullscreen) {
      this.activeTab()?.view.setBounds({ x: 0, y: 0, width, height })
      for (const v of [this.sidebar.view, this.sidebar.appView]) if (v) v.setBounds({ x: width, y: 0, width: 0, height: 0 })
      return
    }
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
    if (!isAllowedUrl(url) || !store.settings.data.aiEnabled) return
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
  const results = searchFor(question, true)
  const tab = pw.activeTab()
  if (tab) tab.view.webContents.loadURL(results)
  else pw.createTab(results)
  if (pw.isPrivate || !store.settings.data.aiEnabled) return
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
  if (!pw.isPrivate && store.settings.data.aiEnabled && (text.startsWith('?') || looksLikeQuestion(text))) return askFromAddressBar(pw, text)
  pw.activeTab()?.view.webContents.loadURL(normalizeInput(text))
})
ipcMain.on('nav:ask', (e, input) => {
  const pw = fromSender(e)
  if (pw) askFromAddressBar(pw, String(input || ''))
})
ipcMain.on('sidebar:toggle', (e) => fromSender(e)?.toggleSidebar())
ipcMain.on('ai:set-enabled', (_e, on) => setAIEnabled(on))

/** The AI slider. Off stops any running agent, closes AI apps, and blocks every AI call. */
function setAIEnabled(on) {
  store.settings.data.aiEnabled = !!on
  store.settings.save()
  for (const pw of windows.values()) {
    if (!on) {
      pw.ai.stop()
      if (pw.sidebar.app) pw.closeApp()
    }
    pw.pushState()
    pw.sendSidebar('sidebar:state', { ...publicState(), app: pw.sidebar.app })
  }
  broadcastSettings()
}

// ---------- Settings window (search engine, AI slider, sync, clear data) ----------

let settingsWin = null

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.focus()
  settingsWin = new BrowserWindow({
    width: 580,
    height: 780,
    title: 'Bit Browser Settings',
    backgroundColor: '#0b0b16',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), sandbox: true, contextIsolation: true },
  })
  settingsWin.setMenuBarVisibility(false)
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    openUrlInBrowser(url)
    return { action: 'deny' }
  })
  settingsWin.loadFile(path.join(__dirname, 'ui', 'settings.html'))
}

function openUrlInBrowser(url) {
  if (!isAllowedUrl(url)) return
  const pw = [...windows.values()].find((w) => !w.isPrivate)
  if (pw) {
    pw.selectTab(pw.createTab(url).id)
    pw.win.focus()
  } else openWindow({ url })
}

function settingsState() {
  const s = store.settings.data
  return {
    searchEngine: s.searchEngine,
    customSearchUrl: s.customSearchUrl,
    engines: SEARCH_ENGINES,
    aiEnabled: s.aiEnabled,
    update: updater.status(),
    sync: syncHost.status(),
    remoteTabs: syncHost.remoteTabs(),
  }
}

function broadcastSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:state', settingsState())
}

function setSearchEngine(engine, customUrl = '') {
  if (!SEARCH_ENGINES[engine]) return
  store.settings.data.searchEngine = engine
  store.settings.data.customSearchUrl = String(customUrl || '').trim().slice(0, 500)
  store.settings.data.updatedAt.search = Date.now()
  store.settings.save()
}

/** Apply a search engine chosen on another device. */
function applyRemoteSearch() {
  const rec = store.records.data.settings.search
  const s = store.settings.data
  if (rec && !rec.deleted && rec.deviceId !== s.deviceId && rec.updatedAt > (s.updatedAt.search || 0)) {
    setSearchEngine(rec.data.engine, rec.data.customUrl)
    s.updatedAt.search = rec.updatedAt
  }
}

ipcMain.on('update:install', () => updater.installNow())
ipcMain.handle('update:check', () => {
  updater.check()
  return settingsState()
})
ipcMain.handle('update:set-auto', (_e, on) => {
  updater.setAuto(on)
  return settingsState()
})
updater.onChange(() => {
  for (const pw of windows.values()) pw.pushState()
  broadcastSettings()
})

// Default browser: registers Bit Browser for http/https links. Windows 10/11
// still asks the user to confirm in Settings > Default apps.
function defaultBrowserState() {
  return { isDefault: app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https'), platform: process.platform }
}
ipcMain.handle('settings:default-browser', () => defaultBrowserState())
ipcMain.handle('settings:make-default', async () => {
  app.setAsDefaultProtocolClient('http')
  app.setAsDefaultProtocolClient('https')
  if (process.platform === 'win32') await shell.openExternal('ms-settings:defaultapps').catch(() => {})
  return defaultBrowserState()
})

ipcMain.on('settings:open', () => openSettings())
ipcMain.on('settings:open-url', (_e, url) => openUrlInBrowser(url))
ipcMain.handle('settings:get', () => settingsState())
ipcMain.handle('settings:set-search', (_e, { engine, customUrl }) => {
  setSearchEngine(engine, customUrl)
  store.putRecord('settings', 'search', { engine: store.settings.data.searchEngine, customUrl: store.settings.data.customSearchUrl })
  return settingsState()
})
ipcMain.handle('settings:set-ai', (_e, on) => {
  setAIEnabled(on)
  return settingsState()
})
ipcMain.handle('settings:clear-data', async (_e, { history, siteData }) => {
  if (history) {
    store.records.data.history = {}
    store.records.save()
  }
  if (siteData) {
    const ses = session.fromPartition(PROFILE_PARTITION)
    // chrome.storage for extensions lives elsewhere, so extension settings survive.
    await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql', 'filesystem'] })
    await ses.clearCache()
  }
  return true
})
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
ipcMain.handle('ai:set-enabled', (_e, on) => {
  setAIEnabled(on)
  return publicState()
})
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
ipcMain.handle('sync:set-options', (_e, { syncKeys, deviceName } = {}) => {
  if (syncKeys !== undefined) store.settings.data.sync.syncKeys = !!syncKeys
  if (deviceName) store.settings.data.deviceName = String(deviceName).slice(0, 40)
  store.settings.save()
  syncedSettingsChanged()
  publishTabs()
  return syncHost.status()
})

syncHost.onChange(({ status, changed }) => {
  if (changed.includes('settings')) {
    applyRemoteSettings()
    applyRemoteSearch()
  }
  broadcastSettings()
  for (const pw of windows.values()) {
    pw.sendSidebar('sidebar:state', { ...publicState(), sync: status, remoteTabs: syncHost.remoteTabs() })
  }
})

// Local data changes (memory the AI saved, history, tabs) go out on the next sync.
store.onLocalChange(() => syncHost.schedule())

// ---------- app lifecycle ----------

// One Bit Browser at a time: links opened from other apps (when it's the
// default browser) land as new tabs in the running window.
function urlsFromArgv(argv) {
  return argv.filter((a) => /^https?:\/\//i.test(a))
}

const gotInstanceLock = app.requestSingleInstanceLock()
if (!gotInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const urls = urlsFromArgv(argv)
    if (urls.length) urls.forEach(openUrlInBrowser)
    else {
      const pw = [...windows.values()].find((w) => !w.isPrivate)
      if (pw) {
        if (pw.win.isMinimized()) pw.win.restore()
        pw.win.focus()
      } else openWindow()
    }
  })
}

// macOS delivers links through open-url (also before the app is ready).
const pendingUrls = []
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (app.isReady() && windows.size) openUrlInBrowser(url)
  else pendingUrls.push(url)
})

app.whenReady().then(async () => {
  if (!gotInstanceLock) return
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
          { label: 'Bitter Sidebar', accelerator: 'CmdOrCtrl+J', click: (_i, w) => w && windows.get(w.id)?.toggleSidebar() },
          { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
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
  const startUrls = [...urlsFromArgv(process.argv.slice(1)), ...pendingUrls]
  await openWindow({ url: startUrls[0] || process.env.PIXEL_START_URL })
  startUrls.slice(1).forEach(openUrlInBrowser)
  syncHost.start()
  updater.start()
  updateExtensions().catch(() => {})
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (windows.size === 0) openWindow()
})
