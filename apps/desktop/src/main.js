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
// Smooth like silk: animated scrolling (GPU acceleration stays on).
app.commandLine.appendSwitch('enable-smooth-scrolling')
// Autoplay (Settings → Media). Chromium reads this once, so changes need a restart.
const AUTOPLAY = { off: 'user-gesture-required', muted: 'document-user-activation-required', on: 'no-user-gesture-required' }
const runningAutoplay = AUTOPLAY[store.settings.data.autoplay] ? store.settings.data.autoplay : 'muted'
app.commandLine.appendSwitch('autoplay-policy', AUTOPLAY[runningAutoplay])

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
    this.tabs = [] // { id, view, space, lastActive }
    this.activeId = null
    this.space = defaultSpace()
    this.spaceActive = {} // space id -> last active tab id
    this.locked = false
    this.blurredAt = 0
    this.sidebar = { open: false, view: null, ready: null, appView: null, app: null }
    this.agentActive = false
    this.ai = new AISession(this)
    this.ai.setSpace?.(this.space)

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
    // Coalesce resize bursts into one layout per frame.
    this.win.on('resize', () => {
      if (this.layoutTimer) return
      this.layoutTimer = setTimeout(() => {
        this.layoutTimer = null
        this.layout()
      }, 16)
    })
    this.win.webContents.on('did-finish-load', () => applyTheme(this.win.webContents))
    // Private window lock: after being away a while, a PIN reveals the window again.
    if (isPrivate) {
      this.win.on('blur', () => (this.blurredAt = Date.now()))
      this.win.on('focus', () => {
        const lock = store.settings.data.privateLock
        if (lock.enabled && lock.pin && this.blurredAt && Date.now() - this.blurredAt > (lock.minutes || 5) * 60000) this.setLocked(true)
      })
    }
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

  /** Send the shell its state, at most once per 50 ms (loading ticks come fast). */
  pushState() {
    if (this.stateTimer) return
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null
      this.pushStateNow()
    }, 50)
  }

  pushStateNow() {
    clearTimeout(this.stateTimer)
    this.stateTimer = null
    const active = this.activeTab()
    const url = active && !active.view.webContents.isDestroyed() ? active.view.webContents.getURL() : ''
    const site = /^https?:/.test(url) ? shields.hostOf(url) : ''
    this.send('tabs:state', {
      activeId: this.activeId,
      tabs: this.tabsInSpace().map((t) => this.tabState(t)),
      blockedCount: active ? shields.pageCount(active.id) : 0,
      site,
      shieldsDown: !store.settings.data.shields.enabled || shields.siteDown(site),
      isPrivate: this.isPrivate,
      sidebarOpen: this.sidebar.open,
      aiEnabled: store.settings.data.aiEnabled,
      update: updater.status(),
      agentActive: this.agentActive,
      spaces: spaceList(),
      space: this.space,
      skin: store.settings.data.theme.skin,
      sounds: !!store.settings.data.sounds,
      tracker: store.settings.data.familyLinks.tracker ? trackerTitle(url, active?.view.webContents.getTitle()) : null,
      locked: this.locked,
    })
  }

  tabsInSpace(space = this.space) {
    return this.tabs.filter((t) => t.space === space)
  }

  createTab(url = '', { space = this.space, select = true } = {}) {
    const view = new WebContentsView({
      webPreferences: { session: this.ses, sandbox: true, contextIsolation: true },
    })
    const wc = view.webContents
    const tab = { id: wc.id, view, space, lastActive: Date.now() }
    this.tabs.push(tab)
    this.extensions.addTab(wc, this.win)
    this.sound('tab')

    const update = () => this.pushState()
    wc.on('did-start-loading', update)
    wc.on('did-stop-loading', () => {
      update()
      if (!this.isPrivate) {
        store.history.add(wc.getURL(), wc.getTitle())
        publishTabs()
        if (/^https?:/.test(wc.getURL())) xp.touchDay()
      }
    })
    // The warning page's buttons: go back, or continue to the site once.
    wc.on('will-navigate', (e, target) => {
      if (!target.startsWith(WARNING_ACTION)) return
      e.preventDefault()
      const u = new URL(target)
      if (u.pathname === '/continue') {
        const dest = u.searchParams.get('url') || ''
        if (!/^https?:/.test(dest)) return
        shields.allowOnce(shields.hostOf(dest))
        wc.loadURL(dest)
      } else leaveWarning(wc)
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
      if (/^tel:/i.test(target)) {
        callWithBitCaller(target.slice(4))
        return { action: 'deny' }
      }
      this.selectTab(this.createTab(target).id)
      return { action: 'deny' }
    })
    wc.on('context-menu', (_e, params) => {
      const items = this.extensions.getContextMenuItems(wc, params)
      if (params.linkURL && !/^tel:/i.test(params.linkURL)) {
        items.unshift({ label: 'Open link in new tab', click: () => this.createTab(params.linkURL) })
      }
      const phone = /^tel:/i.test(params.linkURL) ? decodeURIComponent(params.linkURL.slice(4)) : looksLikePhone(params.selectionText) ? params.selectionText.trim() : ''
      if (phone && store.settings.data.familyLinks.bitcaller) {
        items.unshift({ label: `Call ${phone.slice(0, 30)} with BitCaller`, click: () => callWithBitCaller(phone) }, { type: 'separator' })
      }
      if (params.selectionText && !this.isPrivate && store.settings.data.aiEnabled) {
        const text = params.selectionText.trim()
        const quote = text.slice(0, 80)
        items.unshift(
          { label: 'Explain this with Bitter', click: () => this.askAI({ input: `Explain this simply: "${text}"` }) },
          { label: `Ask Bitter about "${quote}${text.length > 80 ? '…' : ''}"`, click: () => this.askAI({ input: `Tell me more about this: "${text}"` }) },
          { type: 'separator' }
        )
      }
      if (items.length) Menu.buildFromTemplate(items).popup({ window: this.win })
    })

    wc.loadURL(normalizeInput(url))
    if (select) this.selectTab(tab.id)
    return tab
  }

  sound(kind) {
    if (store.settings.data.sounds) this.send('sound', kind)
  }

  // ---------- Spaces ----------

  /** Show another Space's tabs (Work, Personal, 128bit…). */
  switchSpace(id) {
    if (!spaceList().some((s) => s.id === id) || id === this.space) return
    this.spaceActive[this.space] = this.activeId
    this.space = id
    this.ai.setSpace?.(id)
    const tabs = this.tabsInSpace()
    if (!tabs.length) return this.createTab()
    const last = this.spaceActive[id]
    this.selectTab(tabs.some((t) => t.id === last) ? last : tabs[tabs.length - 1].id)
  }

  /** A Space was deleted: its tabs move to the first Space. */
  dropSpace(id) {
    const to = defaultSpace()
    for (const t of this.tabs) if (t.space === id) t.space = to
    if (this.space === id) {
      this.space = to
      this.ai.setSpace?.(to)
    }
    this.pushState()
  }

  // ---------- private window lock ----------

  setLocked(locked) {
    this.locked = locked
    const views = [this.activeTab()?.view, this.sidebar.open && this.sidebar.view, this.sidebar.open && this.sidebar.appView].filter(Boolean)
    for (const v of views) {
      if (locked) this.win.contentView.removeChildView(v)
      else this.win.contentView.addChildView(v)
    }
    if (!locked) this.layout()
    this.pushStateNow()
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
    if (tab.space !== this.space) {
      this.spaceActive[this.space] = this.activeId
      this.space = tab.space
      this.ai.setSpace?.(tab.space)
    }
    tab.lastActive = Date.now()
    const prev = this.activeTab()
    if (prev && prev !== tab) {
      prev.lastActive = Date.now()
      this.win.contentView.removeChildView(prev.view)
    }
    if (!this.locked) this.win.contentView.addChildView(tab.view)
    this.activeId = id
    this.layout()
    this.extensions.selectTab(tab.view.webContents)
    tab.view.webContents.focus()
    this.pushState()
  }

  destroyTab(tab) {
    const wc = tab.view.webContents
    if (wc.isDestroyed()) return
    shields.forget(wc.id)
    this.extensions.removeTab(wc)
    wc.close()
  }

  closeTab(id) {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    const [tab] = this.tabs.splice(idx, 1)
    // Closing a tab nobody looked at for days counts as tidying up (XP).
    if (id !== this.activeId && Date.now() - tab.lastActive > STALE_TAB_MS) xp.add('tabsCleaned')
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(tab.view)
    this.destroyTab(tab)
    publishTabs()
    if (this.tabs.length === 0) return this.win.close()
    if (this.activeId === id) {
      const left = this.tabsInSpace()
      if (!left.length) return this.createTab()
      const before = this.tabs.slice(0, idx).filter((t) => t.space === this.space)
      this.selectTab((before[before.length - 1] || left[0]).id)
    } else this.pushState()
  }

  layout() {
    if (this.win.isDestroyed() || this.locked) return
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
    view.webContents.on('did-finish-load', () => applyTheme(view.webContents))
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
        if (!wc.isDestroyed() && /^https?:/.test(wc.getURL())) tabs.push({ title: wc.getTitle(), url: wc.getURL(), space: t.space })
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

  // Bit Shields: ads, trackers and phishing warnings in every profile.
  shields.attach(ses)

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

function windowForTab(wcId) {
  for (const pw of windows.values()) if (pw.getTab(wcId)) return pw
  return null
}

// Blocked counts reach the toolbar at most every 250 ms.
const countTimers = new Map()
shields.onBlocked((wcId) => {
  if (countTimers.has(wcId)) return
  countTimers.set(
    wcId,
    setTimeout(() => {
      countTimers.delete(wcId)
      const pw = windowForTab(wcId)
      if (pw && pw.activeId === wcId) pw.pushState()
    }, 250)
  )
  xp.add('blocked')
  const pw = windowForTab(wcId)
  if (pw && Date.now() - (pw.lastBlockSound || 0) > 3000) {
    pw.lastBlockSound = Date.now()
    pw.sound('block')
  }
})
shields.onPage((wcId) => windowForTab(wcId)?.pushState())

// A phishing/malware site: show the warning page in that tab instead.
shields.onWarn((wcId, url) => {
  const pw = windowForTab(wcId)
  const wc = pw?.getTab(wcId)?.view.webContents
  if (!wc) return
  setImmediate(() => wc.loadFile(WARNING_PAGE, { query: { url, host: shields.hostOf(url) } }))
})

/** "Go back" from the warning page: the last page that isn't the warning or the blocked site. */
function leaveWarning(wc) {
  const h = wc.navigationHistory
  const entries = h.getAllEntries ? h.getAllEntries() : []
  const current = h.getActiveIndex ? h.getActiveIndex() : entries.length - 1
  for (let i = current - 1; i >= 0; i--) {
    const u = entries[i]?.url || ''
    if (/^https?:/.test(u) && !phishing.isDangerous(u)) return h.goToIndex(i)
  }
  wc.loadURL(homeUrl())
}

// ---------- 128bit family links ----------

function looksLikePhone(text) {
  const t = String(text || '').trim()
  return t.length <= 30 && /^\+?[\d\s().-]+$/.test(t) && t.replace(/\D/g, '').length >= 7
}

/** Open a number in BitCaller (bitcaller://call?number=…), or the phone app. */
function callWithBitCaller(number) {
  const clean = String(number || '').replace(/[^\d+]/g, '')
  if (!clean) return
  const hasBitCaller = !!app.getApplicationNameForProtocol('bitcaller://')
  shell.openExternal(hasBitCaller ? `bitcaller://call?number=${encodeURIComponent(clean)}` : `tel:${clean}`).catch(() => {})
}

/** On an IMDb or TMDB title page, the show/movie name for "Add to 128bittracker". */
function trackerTitle(url, title) {
  if (!/^https:\/\/(www\.|m\.)?(imdb\.com\/title\/tt\d+|themoviedb\.org\/(movie|tv)\/\d+)/i.test(url || '')) return null
  return String(title || '').replace(/\s*[-|—]\s*(IMDb|The Movie Database.*)$/i, '').replace(/\s*\(TMDB\)$/, '').trim() || null
}

function addToTracker(pw) {
  const wc = pw.activeTab()?.view.webContents
  if (!wc) return
  const title = trackerTitle(wc.getURL(), wc.getTitle())
  if (!title) return
  const link = `128bittracker://add?title=${encodeURIComponent(title)}&url=${encodeURIComponent(wc.getURL())}&source=bitbrowser`
  if (app.getApplicationNameForProtocol('128bittracker://')) return shell.openExternal(link).catch(() => {})
  dialog.showMessageBox(pw.win, { type: 'info', message: '128bittracker isn\'t installed on this computer yet.', detail: `When it is, this button adds "${title}" to your list.` })
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

// ---------- themes ----------

const themeKeys = new WeakMap() // webContents -> inserted CSS key

/** Apply the chosen pixel theme to a local UI page (shell, sidebar, settings). */
async function applyTheme(wc) {
  if (!wc || wc.isDestroyed()) return
  const old = themeKeys.get(wc)
  if (old) await wc.removeInsertedCSS(old).catch(() => {})
  const key = await wc.insertCSS(themeCss(store.settings.data.theme)).catch(() => null)
  if (key) themeKeys.set(wc, key)
}

function applyThemeEverywhere() {
  for (const pw of windows.values()) {
    applyTheme(pw.win.webContents)
    applyTheme(pw.sidebar.view?.webContents)
    pw.pushState()
  }
  if (settingsWin && !settingsWin.isDestroyed()) applyTheme(settingsWin.webContents)
}

function setTheme({ id, custom, skin } = {}) {
  const t = store.settings.data.theme
  if (id && (THEMES[id] || id === 'custom')) t.id = id
  if (custom) t.custom = { accent: custom.accent, bg: custom.bg, panel: custom.panel, ink: custom.ink }
  if (skin && ['classic', 'chunky'].includes(skin)) t.skin = skin
  t.updatedAt = Date.now()
  store.settings.save()
  store.putRecord('settings', 'theme', { id: t.id, custom: t.custom, skin: t.skin })
  applyThemeEverywhere()
}

function applyRemoteTheme() {
  const rec = store.records.data.settings.theme
  const t = store.settings.data.theme
  if (!rec || rec.deleted || rec.deviceId === store.settings.data.deviceId || rec.updatedAt <= (t.updatedAt || 0)) return
  Object.assign(t, { id: rec.data.id || t.id, custom: rec.data.custom || t.custom, skin: rec.data.skin || t.skin, updatedAt: rec.updatedAt })
  store.settings.save()
  applyThemeEverywhere()
}

// ---------- Spaces ----------

function saveSpaces() {
  store.settings.data.spaces.updatedAt = Date.now()
  store.settings.save()
  store.putRecord('settings', 'spaces', { list: spaceList() })
  for (const pw of windows.values()) pw.pushState()
}

function addSpace(name) {
  const clean = String(name || '').trim().slice(0, 24)
  if (!clean) return
  spaceList().push({ id: crypto.randomUUID().slice(0, 8), name: clean })
  saveSpaces()
}

function renameSpace(id, name) {
  const sp = spaceList().find((x) => x.id === id)
  const clean = String(name || '').trim().slice(0, 24)
  if (!sp || !clean) return
  sp.name = clean
  saveSpaces()
}

function deleteSpace(id) {
  if (spaceList().length <= 1) return
  store.settings.data.spaces.list = spaceList().filter((x) => x.id !== id)
  for (const pw of windows.values()) pw.dropSpace(id)
  saveSpaces()
}

function applyRemoteSpaces() {
  const rec = store.records.data.settings.spaces
  const sp = store.settings.data.spaces
  if (!rec || rec.deleted || rec.deviceId === store.settings.data.deviceId || rec.updatedAt <= (sp.updatedAt || 0)) return
  if (!Array.isArray(rec.data?.list) || !rec.data.list.length) return
  const gone = sp.list.filter((x) => !rec.data.list.some((y) => y.id === x.id)).map((x) => x.id)
  sp.list = rec.data.list.map((x) => ({ id: String(x.id), name: String(x.name).slice(0, 24) }))
  sp.updatedAt = rec.updatedAt
  store.settings.save()
  for (const id of gone) for (const pw of windows.values()) pw.dropSpace(id)
  for (const pw of windows.values()) pw.pushState()
}

function spaceMenu(pw) {
  Menu.buildFromTemplate([
    ...spaceList().map((sp) => ({ label: sp.name, type: 'radio', checked: sp.id === pw.space, click: () => pw.switchSpace(sp.id) })),
    { type: 'separator' },
    { label: 'Manage Spaces…', click: () => openSettings('spaces') },
  ]).popup({ window: pw.win })
}

// ---------- Shields menu (the toolbar shield) ----------

function shieldsMenu(pw) {
  const active = pw.activeTab()
  const url = active?.view.webContents.getURL() || ''
  const site = /^https?:/.test(url) ? shields.hostOf(url).replace(/^www\./, '') : ''
  const down = shields.siteDown(site)
  const count = active ? shields.pageCount(active.id) : 0
  const items = [{ label: `${count} ads and trackers blocked on this page`, enabled: false }]
  if (site) {
    items.push({
      label: down ? `Shields are DOWN for ${site}: turn them back up` : `Shields are UP for ${site}: turn them down`,
      click: () => {
        shields.setSiteDown(site, !down)
        active.view.webContents.reload()
        pw.pushState()
      },
    })
  }
  items.push({ type: 'separator' }, { label: 'Shields settings…', click: () => openSettings('shields') })
  Menu.buildFromTemplate(items).popup({ window: pw.win })
}

// ---------- panic button ----------

const PANIC_RANGES = { '15m': 15 * 60000, '1h': 60 * 60000, today: null }

/** Close every private window and wipe recent history, cache and tab history. */
async function runPanic(range = store.settings.data.privacy.panicRange) {
  const since = range === 'today' ? new Date(new Date().setHours(0, 0, 0, 0)).getTime() : Date.now() - (PANIC_RANGES[range] || PANIC_RANGES['1h'])
  for (const pw of [...windows.values()]) if (pw.isPrivate) pw.win.destroy()
  let wiped = 0
  for (const r of store.liveRecords('history')) {
    if ((r.data?.visitedAt || r.updatedAt) >= since) {
      store.putRecord('history', r.id, null, { deleted: true })
      wiped += 1
    }
  }
  for (const pw of windows.values()) for (const t of pw.tabs) t.view.webContents.navigationHistory.clear()
  const ses = session.fromPartition(PROFILE_PARTITION)
  await ses.clearCache().catch(() => {})
  await ses.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }).catch(() => {})
  return { wiped }
}

async function panic(win) {
  const ranges = ['15m', '1h', 'today']
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    message: 'Panic: close all private windows and wipe recent activity?',
    detail: 'Clears history, cache and back/forward history from the time you pick. Open regular tabs stay open.',
    buttons: ['Last 15 minutes', 'Last hour', 'Today', 'Cancel'],
    defaultId: 1,
    cancelId: 3,
  })
  if (response > 2) return
  store.settings.data.privacy.panicRange = ranges[response]
  store.settings.save()
  await runPanic(ranges[response])
}

// ---------- private window lock ----------

function hashPin(pin, salt = crypto.randomBytes(8).toString('hex')) {
  return `${salt}:${crypto.pbkdf2Sync(String(pin), salt, 50000, 32, 'sha256').toString('hex')}`
}

function checkPin(pin) {
  const saved = store.settings.data.privateLock.pin
  if (!saved) return true
  const [salt] = saved.split(':')
  const a = Buffer.from(hashPin(pin, salt))
  const b = Buffer.from(saved)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ---------- secure DNS (DNS over HTTPS) ----------

const DOH = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
  nextdns: 'https://dns.nextdns.io/dns-query',
}

function applyDns() {
  const p = store.settings.data.privacy
  const server = p.doh === 'custom' ? p.dohCustom : DOH[p.doh]
  try {
    if (server && /^https:\/\//.test(server)) app.configureHostResolver({ secureDnsMode: 'secure', secureDnsServers: [server] })
    else app.configureHostResolver({ secureDnsMode: 'automatic', secureDnsServers: [] })
  } catch (err) {
    console.error('[dns]', err.message)
  }
}

// ---------- data dashboard ----------

async function dataReport() {
  const ses = session.fromPartition(PROFILE_PARTITION)
  const count = (c) => store.liveRecords(c).length
  let extensions = 0
  try {
    extensions = (ses.extensions?.getAllExtensions?.() || ses.getAllExtensions?.() || []).length
  } catch {}
  const cookies = await ses.cookies.get({}).then((c) => c.length).catch(() => 0)
  const cache = await ses.getCacheSize().catch(() => 0)
  const sync = !!store.secrets.has('syncCode')
  const s = store.settings.data
  return {
    syncOn: sync,
    rows: [
      { id: 'history', label: 'History', value: `${count('history')} pages`, synced: true },
      { id: 'memory', label: 'Bitter memory', value: `${count('memory')} facts`, synced: true },
      { id: 'tabs', label: 'Open tabs list', value: `${windows.size} windows`, synced: true },
      { id: 'settings', label: 'Settings (search engine, AI choice, theme, Spaces, Shields sites)', value: 'saved', synced: true },
      { id: 'keys', label: 'AI keys', value: 'encrypted with your OS keychain', synced: !!s.sync.syncKeys },
      { id: 'cookies', label: 'Cookies and site data', value: `${cookies} cookies`, synced: false },
      { id: 'cache', label: 'Cache', value: `${(cache / 1048576).toFixed(1)} MB`, synced: false },
      { id: 'extensions', label: 'Extensions', value: `${extensions} installed`, synced: false },
      { id: 'shields', label: 'Shields stats', value: `${s.shields.totals.ads + s.shields.totals.trackers} blocked`, synced: false },
      { id: 'xp', label: '128bit XP', value: `${xp.summary().xp} XP`, synced: true },
      { id: 'downloads', label: 'Downloads', value: 'saved in your Downloads folder', synced: false },
    ],
  }
}

async function deleteData(id) {
  const ses = session.fromPartition(PROFILE_PARTITION)
  if (id === 'history') {
    for (const r of store.liveRecords('history')) store.putRecord('history', r.id, null, { deleted: true })
  } else if (id === 'memory') {
    for (const r of store.liveRecords('memory')) store.putRecord('memory', r.id, null, { deleted: true })
  } else if (id === 'cookies') {
    await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql', 'filesystem'] })
  } else if (id === 'cache') {
    await ses.clearCache()
  } else if (id === 'shields') {
    shields.resetTotals()
  } else if (id === 'xp') {
    xp.reset()
  }
  return dataReport()
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
ipcMain.on('shields:menu', (e) => {
  const pw = fromSender(e)
  if (pw) shieldsMenu(pw)
})
ipcMain.on('space:menu', (e) => {
  const pw = fromSender(e)
  if (pw) spaceMenu(pw)
})
ipcMain.on('panic', (e) => panic(BrowserWindow.fromWebContents(e.sender)))
ipcMain.on('tracker:add', (e) => {
  const pw = fromSender(e)
  if (pw) addToTracker(pw)
})
ipcMain.handle('lock:unlock', (e, pin) => {
  const pw = fromSender(e)
  if (!pw || !checkPin(pin)) return false
  pw.setLocked(false)
  return true
})
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

function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (section) settingsWin.webContents.send('settings:goto', section)
    return settingsWin.focus()
  }
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
  settingsWin.webContents.on('did-finish-load', () => applyTheme(settingsWin.webContents))
  settingsWin.loadFile(path.join(__dirname, 'ui', 'settings.html'), section ? { hash: section } : undefined)
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
    shields: shields.publicState(),
    autoplay: s.autoplay,
    autoplayRunning: runningAutoplay,
    theme: s.theme,
    themes: Object.fromEntries(Object.entries(THEMES).map(([id, t]) => [id, t])),
    sounds: !!s.sounds,
    privacy: { doh: s.privacy.doh, dohCustom: s.privacy.dohCustom, panicRange: s.privacy.panicRange },
    privateLock: { enabled: s.privateLock.enabled, hasPin: !!s.privateLock.pin, minutes: s.privateLock.minutes },
    phishing: { enabled: s.phishing.enabled, lastUpdate: s.phishing.lastUpdate, hosts: phishing.count() },
    spaces: spaceList(),
    xp: xp.summary(),
    familyLinks: s.familyLinks,
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

ipcMain.on('settings:open', (_e, section) => openSettings(section))
ipcMain.handle('settings:update', async (_e, patch = {}) => {
  const s = store.settings.data
  if (patch.shields) shields.setOptions(patch.shields)
  if (patch.updateLists) await shields.update()
  if (patch.autoplay && AUTOPLAY[patch.autoplay]) s.autoplay = patch.autoplay
  if (patch.theme) setTheme(patch.theme)
  if (typeof patch.sounds === 'boolean') s.sounds = patch.sounds
  if (patch.privacy) {
    if (['automatic', 'cloudflare', 'quad9', 'nextdns', 'custom'].includes(patch.privacy.doh)) s.privacy.doh = patch.privacy.doh
    if (typeof patch.privacy.dohCustom === 'string') s.privacy.dohCustom = patch.privacy.dohCustom.trim().slice(0, 300)
    applyDns()
  }
  if (patch.privateLock) {
    const l = s.privateLock
    if (typeof patch.privateLock.pin === 'string') l.pin = patch.privateLock.pin ? hashPin(patch.privateLock.pin) : ''
    if (typeof patch.privateLock.enabled === 'boolean') l.enabled = patch.privateLock.enabled && !!l.pin
    if (patch.privateLock.minutes) l.minutes = Math.max(1, Math.min(120, Number(patch.privateLock.minutes) || 5))
  }
  if (patch.phishing && typeof patch.phishing.enabled === 'boolean') {
    s.phishing.enabled = patch.phishing.enabled
    if (patch.phishing.enabled && !phishing.count()) phishing.refresh().catch(() => {})
  }
  if (patch.space) {
    const { op, id, name } = patch.space
    if (op === 'add') addSpace(name)
    if (op === 'rename') renameSpace(id, name)
    if (op === 'delete') deleteSpace(id)
  }
  if (patch.familyLinks) for (const k of ['bitcaller', 'tracker']) if (typeof patch.familyLinks[k] === 'boolean') s.familyLinks[k] = patch.familyLinks[k]
  store.settings.save()
  for (const pw of windows.values()) pw.pushState()
  return settingsState()
})
ipcMain.handle('settings:panic', async (_e, range) => {
  await runPanic(range)
  return settingsState()
})
ipcMain.handle('settings:data', () => dataReport())
ipcMain.handle('settings:delete-data', (_e, id) => deleteData(id))
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
  return pw.tabsInSpace().map((t) => ({ id: t.id, title: t.view.webContents.getTitle() || 'New tab', url: t.view.webContents.getURL(), active: t.id === pw.activeId }))
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
ipcMain.on('sidebar:select-tab', (e, id) => fromSidebar(e)?.selectTab(Number(id)))
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
    shields.applyRemote()
    applyRemoteTheme()
    applyRemoteSpaces()
    xp.applyRemote()
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

// XP changes reach the shell (level-up sound) and Settings.
xp.onChange((_summary, leveledUp) => {
  if (leveledUp) for (const pw of windows.values()) pw.sound('levelup')
  broadcastSettingsSoon()
})

let settingsTimer = null
function broadcastSettingsSoon() {
  clearTimeout(settingsTimer)
  settingsTimer = setTimeout(broadcastSettings, 500)
}

// Hooks for the end-to-end test only.
if (process.env.PIXEL_E2E) {
  globalThis.__bitTest = { runPanic, shields, xp, setTheme, windows, history: store.history, records: store.records }
}

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
          { label: 'Panic: Close Private Windows and Wipe Recent Activity', accelerator: 'CmdOrCtrl+Shift+X', click: (_i, w) => panic(w) },
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

  applyDns()
  await shields.start()
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
