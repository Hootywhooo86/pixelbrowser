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
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, shell, dialog, clipboard } = require('electron')

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
const bookmarks = require('./bookmarks')
const vault = require('./vault')
const quests = require('./quests')
const crashlog = require('./crashlog')
const { READERABLE_JS, EXTRACT_ARTICLE_JS, readerPage, fillBusinessJS, pipJS } = require('./page-tools')
const { THEMES, themeCss, paletteFor } = require('./ui/themes')

// Opt-in crash log (Settings → Crash reports); nothing is sent anywhere.
crashlog.install()

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
// The pixel new tab page. Its search box and EDIT link, and the reader page's
// EXIT button, go to made-up addresses that will-navigate catches.
const NTP_URL = pathToFileURL(path.join(__dirname, 'ui', 'newtab.html')).href
const NTP_ACTION = 'https://newtab.bitbrowser.invalid/'
const READER_ACTION = 'https://reader.bitbrowser.invalid/'
const isNtp = (url) => String(url || '').split(/[?#]/)[0] === NTP_URL
const DEFAULT_SHORTCUTS = [
  { title: 'DuckDuckGo', url: 'https://duckduckgo.com/' },
  { title: 'YouTube', url: 'https://www.youtube.com/' },
  { title: 'Wikipedia', url: 'https://en.wikipedia.org/' },
  { title: 'GitHub', url: 'https://github.com/' },
  { title: 'Reddit', url: 'https://www.reddit.com/' },
  { title: 'Shippo', url: 'https://apps.goshippo.com/' },
]
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

/** What a new tab opens: the pixel new tab page, or the search engine's home page. */
function newTabTarget() {
  return store.settings.data.newTabPage === 'search' ? homeUrl() : NTP_URL
}

function normalizeInput(input) {
  const text = String(input || '').trim()
  if (!text || text === 'bit://newtab') return newTabTarget()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || text.startsWith('about:')) return text
  if (/^[^\s]+\.[^\s]{2,}$/.test(text) || text.startsWith('localhost')) return `https://${text}`
  return searchFor(text)
}

class PixelWindow {
  constructor({ ses, extensions, isPrivate }) {
    this.ses = ses
    this.extensions = extensions
    this.isPrivate = isPrivate
    this.tabs = [] // { id, view, space, lastActive, pinned, pendingUrl, pendingTitle } — pinned tabs first
    this.activeId = null
    this.space = defaultSpace()
    this.spaceActive = {} // space id -> last active tab id
    this.locked = false
    this.blurredAt = 0
    this.sidebar = { open: false, view: null, ready: null, appView: null, app: null }
    this.agentActive = false
    this.shellH = SHELL_HEIGHT // grows with the bookmarks bar and info bars
    this.prompts = [] // info bars: { id, tabId, kind, label, text, buttons, key, resolve }
    this.closed = [] // recently closed tabs, newest last: { url, title, space }
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
    // Closing the last normal window keeps its tabs for next time; closing
    // one of several drops that window from the saved session.
    this.win.on('close', () => {
      if (isPrivate) return
      const others = [...windows.values()].some((w) => w !== this && !w.isPrivate && !w.win.isDestroyed())
      if (!others) {
        saveSessionNow()
        sessionFrozen = true
      }
    })
    this.win.on('closed', () => {
      this.ai.stop()
      for (const tab of this.tabs) this.destroyTab(tab)
      for (const v of [this.sidebar.view, this.sidebar.appView]) if (v && !v.webContents.isDestroyed()) v.webContents.close()
      windows.delete(this.win.id)
      publishTabs()
      saveSession()
    })
  }

  send(channel, payload) {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload)
  }

  tabState(tab) {
    const wc = tab.view.webContents
    const url = realUrl(tab)
    return {
      id: tab.id,
      url: isNtp(url) ? '' : url,
      title: (tab.reader ? tab.reader.title : tab.pendingUrl ? tab.pendingTitle : isNtp(url) ? 'New tab' : wc.getTitle()) || 'New tab',
      pinned: !!tab.pinned,
      loading: !tab.pendingUrl && wc.isLoading(),
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
    const url = active && !active.view.webContents.isDestroyed() ? realUrl(active) : ''
    const site = /^https?:/.test(url) ? shields.hostOf(url) : ''
    saveSession()
    const prompts = this.prompts.filter((p) => !p.tabId || p.tabId === this.activeId).map(({ id, kind, label, text, buttons }) => ({ id, kind, label, text, buttons }))
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
      bookmarksBar: !!store.settings.data.bookmarksBar,
      bar: bookmarks.bar(),
      canBookmark: /^https?:/.test(url),
      bookmarked: /^https?:/.test(url) && !!bookmarks.find(url),
      readerable: !!active?.readerable && !active?.reader,
      inReader: !!active?.reader,
      prompts,
    })
  }

  // ---------- info bars (permission prompts, passwords, quests) ----------

  /**
   * Show a bar under the toolbar with a few buttons; resolves with the button's
   * id, or null if it was dismissed (tab closed, page changed, replaced).
   * tabId: only shown while that tab is active. key: replaces an older bar with the same key.
   */
  prompt({ tabId = null, kind = 'info', label, text, buttons, key = null, timeout = 0 }) {
    return new Promise((resolve) => {
      if (key) this.dismissPrompts((p) => p.key === key)
      const id = crypto.randomUUID()
      const p = { id, tabId, kind, label, text, buttons, key, resolve }
      this.prompts.push(p)
      if (this.prompts.length > 6) this.dismissPrompts((x) => x === this.prompts[0])
      if (timeout) setTimeout(() => this.answerPrompt(id, null), timeout)
      this.pushStateNow()
    })
  }

  answerPrompt(id, action) {
    const p = this.prompts.find((x) => x.id === id)
    if (!p) return
    this.prompts = this.prompts.filter((x) => x !== p)
    p.resolve(action)
    this.pushStateNow()
  }

  dismissPrompts(match) {
    const gone = this.prompts.filter(match)
    if (!gone.length) return
    this.prompts = this.prompts.filter((p) => !gone.includes(p))
    for (const p of gone) p.resolve(null)
    this.pushState()
  }

  toast(text) {
    this.send('toast', text)
  }

  // ---------- find in page ----------

  openFind() {
    const wc = this.activeTab()?.view.webContents
    if (!wc) return
    this.send('find', { open: true })
    this.win.webContents.focus()
  }

  find(text, { findNext = false, forward = true } = {}) {
    const wc = this.activeTab()?.view.webContents
    if (!wc || !text) return
    this.findingTab = this.activeId
    wc.findInPage(String(text).slice(0, 500), { findNext: !!findNext, forward: forward !== false })
  }

  stopFind() {
    const tab = this.getTab(this.findingTab)
    if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.stopFindInPage('clearSelection')
    this.findingTab = null
  }

  // ---------- recently closed tabs ----------

  reopenClosed() {
    if (!this.closed.length) return
    let i = -1
    for (let k = this.closed.length - 1; k >= 0; k--) if (this.closed[k].space === this.space) {
      i = k
      break
    }
    if (i === -1) i = this.closed.length - 1
    const [t] = this.closed.splice(i, 1)
    this.selectTab(this.createTab(t.url, { space: spaceList().some((x) => x.id === t.space) ? t.space : this.space }).id)
  }

  tabsInSpace(space = this.space) {
    return this.tabs.filter((t) => t.space === space)
  }

  /**
   * Open a tab. lazy: remember the address but don't load it until the tab is
   * first selected (restored tabs), so startup stays fast.
   */
  createTab(url = '', { space = this.space, select = true, pinned = false, lazy = false, title = '' } = {}) {
    const view = new WebContentsView({
      // plugins: Chromium's built-in PDF viewer, so PDFs open in the tab.
      // backgroundThrottling off: videos and music keep playing when the window is minimized.
      webPreferences: { session: this.ses, sandbox: true, contextIsolation: true, plugins: true, backgroundThrottling: false },
    })
    const wc = view.webContents
    const tab = { id: wc.id, view, space, lastActive: Date.now(), pinned: !!pinned }
    // Pinned tabs stay together at the front.
    if (pinned) this.tabs.splice(this.tabs.filter((t) => t.pinned).length, 0, tab)
    else this.tabs.push(tab)
    this.extensions.addTab(wc, this.win)
    this.sound('tab')

    const update = () => this.pushState()
    wc.on('did-start-loading', update)
    wc.on('did-stop-loading', () => {
      update()
      if (!this.isPrivate) {
        store.history.add(wc.getURL(), wc.getTitle())
        publishTabs()
        if (/^https?:/.test(wc.getURL())) {
          xp.touchDay()
          quests.progress('streakDay')
        }
      }
    })
    wc.on('did-finish-load', () => this.pageLoaded(tab))
    wc.on('dom-ready', () => {
      // Password capture (main frame, normal windows, real sites only).
      if (!this.isPrivate && vaultable(wc.getURL())) wc.executeJavaScript(vault.CAPTURE_LOGIN_JS).catch(() => {})
    })
    wc.on('console-message', (e, _level, message) => {
      const text = typeof e?.message === 'string' ? e.message : message
      if (typeof text !== 'string' || !text.startsWith('__bit')) return
      if (text.startsWith('__bitLogin:')) {
        try {
          const { username, password } = JSON.parse(text.slice(11))
          this.offerToSave(tab, wc.getURL(), String(username || ''), String(password || ''))
        } catch {}
      } else if (text === '__bitNeedFill') this.offerFill(tab)
    })
    wc.on('found-in-page', (_e, result) => {
      if (tab.id === this.activeId && result.matches !== undefined) this.send('find', { result: { matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal } })
    })
    wc.on('did-navigate', (_e, target) => {
      if (tab.reader && !String(target).startsWith('data:')) tab.reader = null
      tab.readerable = false
      tab.filled = false
      this.dismissPrompts((p) => p.tabId === tab.id && (p.kind === 'password' || p.kind === 'permission'))
    })
    // Buttons on our own pages go to made-up addresses: the warning page
    // (go back / continue), the new tab page (search, edit), reader (exit).
    wc.on('will-navigate', (e, target) => {
      if (target.startsWith(NTP_ACTION) && isNtp(wc.getURL())) {
        e.preventDefault()
        const u = new URL(target)
        if (u.pathname === '/edit') return openSettings('newtab')
        const q = (u.searchParams.get('q') || '').trim()
        if (!q) return
        if (!this.isPrivate && store.settings.data.aiEnabled && (q.startsWith('?') || looksLikeQuestion(q))) return askFromAddressBar(this, q)
        return this.load(wc, q)
      }
      if (target.startsWith(READER_ACTION) && tab.reader) {
        e.preventDefault()
        return this.exitReader(tab)
      }
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
      if (params.mediaType === 'video') {
        items.unshift({ label: 'Picture in picture', click: () => wc.executeJavaScript(pipJS(params.x, params.y), true).catch(() => {}) }, { type: 'separator' })
      }
      if (params.isEditable && !params.selectionText) {
        items.push({ type: 'separator' }, { label: store.settings.data.business ? 'Fill business details' : 'Fill business details… (set them up)', click: () => this.fillBusiness() })
      }
      if (!params.linkURL && !params.isEditable && /^https?:/.test(realUrl(tab))) {
        items.push(
          { type: 'separator' },
          { label: 'Translate this page', submenu: this.translateItems() },
          { label: 'Save page as PDF', click: () => this.savePdf() },
          { label: 'Print…', click: () => wc.print({}) }
        )
      }
      if (items.length) Menu.buildFromTemplate(items).popup({ window: this.win })
    })

    if (lazy) {
      tab.pendingUrl = normalizeInput(url)
      tab.pendingTitle = title || tab.pendingUrl
    } else this.load(wc, url)
    if (select) this.selectTab(tab.id)
    return tab
  }

  /** Load what someone typed (or a saved address) into a tab. */
  load(wc, input) {
    if (!wc || wc.isDestroyed()) return
    wc.loadURL(normalizeInput(input)).catch(() => {})
  }

  /** After each page load: new tab page data, reader check, saved-login offer. */
  pageLoaded(tab) {
    const wc = tab.view.webContents
    if (wc.isDestroyed()) return
    const url = wc.getURL()
    if (isNtp(url)) {
      applyTheme(wc)
      wc.executeJavaScript(`window.__ntp && window.__ntp(${JSON.stringify(ntpData(this))})`).catch(() => {})
      return
    }
    if (tab.reader) return
    if (/^https?:/.test(url)) {
      wc.executeJavaScript(READERABLE_JS)
        .then((ok) => {
          if (wc.isDestroyed() || wc.getURL() !== url) return
          tab.readerable = !!ok
          if (tab.id === this.activeId) this.pushState()
        })
        .catch(() => {})
      this.offerFill(tab)
    }
  }

  // ---------- passwords ----------

  async offerToSave(tab, url, username, password) {
    if (this.isPrivate || !password || !vaultable(url)) return
    if (!store.settings.data.vault.offerToSave || vault.isNever(url) || vault.hasLogin({ url, username, password })) return
    const host = shields.hostOf(url)
    const update = vault.findLogins(url).some((l) => l.username === username)
    const answer = await this.prompt({
      tabId: tab.id,
      kind: 'password',
      label: 'PASSWORDS',
      text: update ? `Update the saved password for ${username || 'this account'} on ${host}?` : `Save the password for ${username || 'this account'} on ${host}? It's encrypted on this computer.`,
      buttons: [
        { id: 'save', label: update ? 'UPDATE' : 'SAVE', hot: true },
        { id: 'never', label: 'NEVER FOR THIS SITE' },
        { id: 'no', label: 'NOT NOW' },
      ],
      key: `save:${tab.id}`,
    })
    if (answer === 'save') {
      vault.saveLogin({ url, username, password })
      this.toast(`Password saved for ${host}`)
      broadcastSettingsSoon()
    } else if (answer === 'never') vault.neverFor(url)
  }

  async offerFill(tab) {
    const wc = tab.view.webContents
    if (this.isPrivate || tab.filled || wc.isDestroyed()) return
    const url = wc.getURL()
    if (!vaultable(url)) return
    const logins = vault.findLogins(url)
    if (!logins.length) return
    const host = shields.hostOf(url)
    const answer = await this.prompt({
      tabId: tab.id,
      kind: 'password',
      label: 'PASSWORDS',
      text: logins.length === 1 ? `Fill your saved login for ${logins[0].username || host}?` : `Fill a saved login for ${host}:`,
      buttons: [...logins.slice(0, 3).map((l, i) => ({ id: `fill:${i}`, label: logins.length === 1 ? 'FILL' : (l.username || 'login').slice(0, 24).toUpperCase(), hot: i === 0 })), { id: 'no', label: 'NOT NOW' }],
      key: `fill:${tab.id}`,
    })
    if (!answer?.startsWith('fill:') || wc.isDestroyed() || wc.getURL() !== url) return
    const l = logins[Number(answer.slice(5))]
    tab.filled = true
    await wc.executeJavaScript(vault.autofillJS(l.username, l.password)).catch(() => false)
  }

  async fillBusiness() {
    const p = store.settings.data.business
    if (!p || !Object.values(p).some(Boolean)) return openSettings('business')
    const wc = this.activeTab()?.view.webContents
    if (!wc) return
    const n = await wc.executeJavaScript(fillBusinessJS(p), true).catch(() => 0)
    this.toast(n ? `Filled ${n} field${n === 1 ? '' : 's'} with your business details` : 'No matching form fields found on this page')
  }

  // ---------- reader mode ----------

  async toggleReader() {
    const tab = this.activeTab()
    if (!tab) return
    if (tab.reader) return this.exitReader(tab)
    const wc = tab.view.webContents
    const url = wc.getURL()
    if (!/^https?:/.test(url)) return
    const article = await wc.executeJavaScript(EXTRACT_ARTICLE_JS).catch(() => null)
    if (!article || (article.words || 0) < 80) return this.toast('No article found on this page')
    const html = readerPage(article, { url, theme: paletteFor(store.settings.data.theme) })
    tab.reader = { url, title: article.title || wc.getTitle() }
    await wc.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`).catch(() => {})
    quests.progress('articleRead')
    this.pushState()
  }

  exitReader(tab) {
    const back = tab.reader?.url
    tab.reader = null
    if (back) tab.view.webContents.loadURL(back).catch(() => {})
    this.pushState()
  }

  // ---------- translate, PDF, print ----------

  translateItems() {
    const lang = app.getLocale().split('-')[0] || 'en'
    const langName = new Intl.DisplayNames([app.getLocale() || 'en'], { type: 'language' }).of(lang) || 'English'
    const items = []
    if (!this.isPrivate && store.settings.data.aiEnabled) {
      items.push({ label: `Translate to ${langName} with Bitter`, click: () => this.askAI({ input: `Translate this page into ${langName}. Keep its headings and structure, translate all of the main text, and don't add commentary.`, includePage: true }) })
    }
    items.push({
      label: 'Open in Google Translate (sends the page address to Google)',
      click: () => {
        const url = realUrl(this.activeTab())
        if (/^https?:/.test(url)) this.selectTab(this.createTab(`https://translate.google.com/translate?sl=auto&tl=${encodeURIComponent(lang)}&u=${encodeURIComponent(url)}`).id)
      },
    })
    return items
  }

  async savePdf() {
    const tab = this.activeTab()
    const wc = tab?.view.webContents
    if (!wc) return
    try {
      const data = await wc.printToPDF({ printBackground: true })
      const title = (tab.reader?.title || wc.getTitle() || 'page').replace(/\s+/g, ' ').trim().slice(0, 80)
      const savePath = uniqueDownloadPath(`${title}.pdf`)
      fs.writeFileSync(savePath, data)
      const d = { id: nextDownloadId++, name: path.basename(savePath), path: savePath, state: 'completed', received: data.length, total: data.length, mime: 'application/pdf' }
      downloads.set(d.id, d)
      this.send('download', { ...d })
    } catch (err) {
      this.toast(`Couldn't save as PDF: ${err.message}`)
    }
  }

  /** Pin or unpin a tab. Pinned tabs sit at the front and can't be closed until unpinned. */
  pinTab(id, pinned) {
    const tab = this.getTab(id)
    if (!tab || this.isPrivate || !!tab.pinned === !!pinned) return
    this.tabs.splice(this.tabs.indexOf(tab), 1)
    tab.pinned = !!pinned
    const at = this.tabs.filter((t) => t.pinned).length
    this.tabs.splice(at, 0, tab)
    if (pinned) quests.progress('pinned')
    publishTabs()
    this.pushStateNow()
  }

  /** Right-click menu for a tab in the tab strip. */
  tabMenu(id) {
    const tab = this.getTab(id)
    if (!tab) return
    const others = this.tabsInSpace().filter((t) => t.id !== id && !t.pinned)
    Menu.buildFromTemplate([
      ...(this.isPrivate ? [] : [{ label: tab.pinned ? 'Unpin tab' : 'Pin tab', click: () => this.pinTab(id, !tab.pinned) }, { type: 'separator' }]),
      { label: 'Close tab', enabled: !tab.pinned, click: () => this.closeTab(id) },
      { label: 'Close other tabs', enabled: others.length > 0, click: () => others.forEach((t) => this.closeTab(t.id)) },
      { type: 'separator' },
      { label: 'Reopen closed tab', accelerator: 'CmdOrCtrl+Shift+T', enabled: this.closed.length > 0, click: () => this.reopenClosed() },
    ]).popup({ window: this.win })
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
    if (tab.pendingUrl) {
      const url = tab.pendingUrl
      tab.pendingUrl = null
      tab.view.webContents.loadURL(url)
    }
    const prev = this.activeTab()
    if (prev && prev !== tab) {
      prev.lastActive = Date.now()
      this.win.contentView.removeChildView(prev.view)
      if (this.findingTab) {
        this.stopFind()
        this.send('find', { close: true })
      }
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
    // Pinned tabs stay open until you unpin them.
    if (this.tabs[idx].pinned) return
    const [tab] = this.tabs.splice(idx, 1)
    // Closing a tab nobody looked at for days counts as tidying up (XP).
    if (id !== this.activeId && Date.now() - tab.lastActive > STALE_TAB_MS) {
      xp.add('tabsCleaned')
      quests.progress('tabCleaned')
    }
    // Remember it for "Reopen closed tab" (Ctrl+Shift+T). Private windows forget.
    const closedUrl = realUrl(tab)
    if (!this.isPrivate && /^(https?|file):/.test(closedUrl) && !isNtp(closedUrl)) {
      this.closed.push({ url: closedUrl, title: tab.view.webContents.isDestroyed() ? closedUrl : tab.view.webContents.getTitle(), space: tab.space })
      if (this.closed.length > 25) this.closed.shift()
    }
    this.dismissPrompts((p) => p.tabId === id)
    if (this.findingTab === id) this.findingTab = null
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
    const top = this.shellH
    const bodyH = Math.max(0, height - top)
    const sideW = this.sidebar.open ? Math.min(SIDEBAR_WIDTH, Math.floor(width * 0.6)) : 0
    this.activeTab()?.view.setBounds({ x: 0, y: top, width: width - sideW, height: bodyH })
    const { view, appView, app: openApp } = this.sidebar
    if (view) view.setBounds({ x: width - sideW, y: top, width: sideW, height: openApp ? SIDEBAR_HEADER : bodyH })
    if (appView) appView.setBounds({ x: width - sideW, y: top + SIDEBAR_HEADER, width: sideW, height: Math.max(0, bodyH - SIDEBAR_HEADER) })
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

/** Passwords are saved and filled on secure sites (and local test servers). */
const vaultable = (url) => /^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)

/** The page a tab is really on (reader mode shows a data: page for it). */
function realUrl(tab) {
  if (!tab) return ''
  if (tab.reader) return tab.reader.url
  if (tab.pendingUrl) return tab.pendingUrl
  const wc = tab.view.webContents
  return wc.isDestroyed() ? '' : wc.getURL()
}

/** What the new tab page shows. */
function ntpData(pw) {
  const s = store.settings.data
  const totals = s.shields.totals || {}
  return {
    shortcuts: (Array.isArray(s.ntpShortcuts) ? s.ntpShortcuts : DEFAULT_SHORTCUTS).slice(0, 24),
    blocked: (totals.ads || 0) + (totals.trackers || 0),
    xp: xp.summary(),
    quests: quests.list(),
    pinned: pw && !pw.isPrivate ? pw.tabsInSpace().filter((t) => t.pinned).map((t) => ({ title: t.pendingUrl ? t.pendingTitle : t.view.webContents.getTitle(), url: realUrl(t) })) : [],
    remote: pw?.isPrivate ? [] : syncHost.remoteTabs().slice(0, 3),
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
        const url = realUrl(t)
        if (/^https?:/.test(url)) tabs.push({ title: t.reader ? t.reader.title : t.pendingUrl ? t.pendingTitle : wc.getTitle(), url, space: t.space, pinned: !!t.pinned })
      }
    }
    store.putRecord('tabs', store.settings.data.deviceId, { deviceName: store.settings.data.deviceName, tabs: tabs.slice(0, 100) })
  }, 3000)
}

// ---------- session restore ----------
// Normal windows' tabs (per Space, pinned first) are saved as you browse and
// reopened on the next start. Pinned tabs always come back; the rest only with
// "On startup: Reopen my tabs" (the default).

let sessionFrozen = false // set while quitting so closing windows doesn't erase the saved tabs
let sessionTimer = null

function sessionSnapshot() {
  const out = []
  for (const pw of windows.values()) {
    if (pw.isPrivate || pw.win.isDestroyed()) continue
    const activeBySpace = { ...pw.spaceActive, [pw.space]: pw.activeId }
    const tabs = []
    for (const t of pw.tabs) {
      const wc = t.view.webContents
      let url = realUrl(t)
      if (isNtp(url)) url = 'bit://newtab' // the app's folder can move between versions
      if (!/^(https?|file|bit):/.test(url)) continue
      tabs.push({ url, title: (t.reader ? t.reader.title : t.pendingUrl ? t.pendingTitle : wc.getTitle()) || url, pinned: !!t.pinned, space: t.space, active: activeBySpace[t.space] === t.id })
    }
    if (tabs.length) out.push({ space: pw.space, tabs: tabs.slice(0, 200) })
  }
  return out
}

function saveSessionNow() {
  clearTimeout(sessionTimer)
  if (sessionFrozen) return
  store.settings.data.session = { windows: sessionSnapshot(), savedAt: Date.now() }
  store.settings.flush()
}

function saveSession() {
  if (sessionFrozen) return
  clearTimeout(sessionTimer)
  sessionTimer = setTimeout(saveSessionNow, 1000)
}

/** Put a saved window's tabs back (lazily) into a fresh window. */
function restoreInto(pw, saved, { all }) {
  const known = new Set(spaceList().map((sp) => sp.id))
  const spaceOf = (id) => (known.has(id) ? id : defaultSpace())
  const active = {}
  for (const t of saved.tabs || []) {
    if (!all && !t.pinned) continue
    if (!/^(https?|file|bit):/.test(t.url || '')) continue
    const tab = pw.createTab(t.url, { space: spaceOf(t.space), pinned: !!t.pinned, lazy: true, select: false, title: t.title })
    if (t.active) active[tab.space] = tab.id
  }
  pw.space = spaceOf(saved.space)
  pw.ai.setSpace?.(pw.space)
  Object.assign(pw.spaceActive, active)
  const here = pw.tabsInSpace()
  if (!here.length) return false
  pw.selectTab(active[pw.space] && here.some((t) => t.id === active[pw.space]) ? active[pw.space] : here[here.length - 1].id)
  return true
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

  // Downloads go straight to the Downloads folder (no save dialog) and the
  // shell shows them; PDFs open in a tab from there.
  ses.on('will-download', (_e, item, wc) => handleDownload(item, wc))

  // Camera, microphone, location and notifications: ask with a pixel bar,
  // remember the answer per site (Settings → Site settings). Everything else
  // a page asks for stays denied, except full screen and copying.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (['fullscreen', 'clipboard-sanitized-write'].includes(permission)) return callback(true)
    const kinds = permissionKinds(permission, details)
    if (!kinds) return callback(false)
    askPermission(wc, kinds, details?.requestingUrl || wc?.getURL(), isPrivate).then(callback, () => callback(false))
  })
  ses.setPermissionCheckHandler((_wc, permission, origin, details) => {
    const kinds = permission === 'media' ? [details?.mediaType === 'video' ? 'camera' : 'microphone'] : permissionKinds(permission, details)
    if (!kinds) return true
    return kinds.every((k) => sitePermission(origin, k, isPrivate) === 'allow')
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

// ---------- downloads ----------

const downloads = new Map() // id -> { id, name, path, state, received, total, mime }
let nextDownloadId = 1

/** Where downloads go: the folder picked in Settings, else the system Downloads folder. */
function downloadDir() {
  const f = store.settings.data.downloads?.folder
  try {
    if (f && fs.statSync(f).isDirectory()) return f
  } catch {}
  return app.getPath('downloads')
}

function uniqueDownloadPath(name) {
  const dir = downloadDir()
  fs.mkdirSync(dir, { recursive: true })
  const clean = String(name || 'download').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 150) || 'download'
  const ext = path.extname(clean)
  const base = clean.slice(0, clean.length - ext.length)
  for (let i = 0; i < 1000; i++) {
    const p = path.join(dir, i ? `${base} (${i})${ext}` : clean)
    if (!fs.existsSync(p)) return p
  }
  return path.join(dir, `${Date.now()}-${clean}`)
}

function windowOfContents(wc) {
  for (const pw of windows.values()) if (pw.tabs.some((t) => t.view.webContents === wc)) return pw
  const focused = BrowserWindow.getFocusedWindow()
  return (focused && windows.get(focused.id)) || windows.values().next().value
}

function handleDownload(item, wc) {
  const opts = store.settings.data.downloads || {}
  const suggested = uniqueDownloadPath(item.getFilename())
  // "Ask where to save each file": Electron shows its save dialog when no path is set.
  if (opts.ask) item.setSaveDialogOptions({ defaultPath: suggested })
  else item.setSavePath(suggested)
  const savePath = suggested
  const d = { id: nextDownloadId++, name: path.basename(savePath), path: savePath, state: 'progressing', received: 0, total: item.getTotalBytes(), mime: item.getMimeType() }
  downloads.set(d.id, d)
  const pw = windowOfContents(wc)
  const push = () => pw?.send('download', { ...d })
  push()
  let last = 0
  item.on('updated', (_e, state) => {
    d.state = state === 'interrupted' ? 'interrupted' : 'progressing'
    d.received = item.getReceivedBytes()
    d.total = item.getTotalBytes()
    if (Date.now() - last > 250) (last = Date.now()), push()
  })
  item.once('done', (_e, state) => {
    d.state = state // completed | cancelled | interrupted
    d.received = item.getReceivedBytes()
    const real = item.getSavePath()
    if (real) {
      d.path = real
      d.name = path.basename(real)
    }
    push()
    // "Auto-print shipping labels": a finished PDF opens in a tab and the print dialog comes up.
    if (state === 'completed' && opts.autoPrintLabels && isPdfDownload(d) && pw) autoPrint(pw, d)
  })
}

function autoPrint(pw, d) {
  const tab = pw.createTab(pathToFileURL(d.path).href)
  pw.selectTab(tab.id)
  const wc = tab.view.webContents
  wc.once('did-finish-load', () => {
    lastAutoPrint = d.path
    // The PDF viewer prints the document itself when the page asks.
    setTimeout(() => !wc.isDestroyed() && wc.executeJavaScript('window.print()', true).catch(() => wc.print({})), 600)
  })
}
let lastAutoPrint = ''

const isPdfDownload = (d) => /\.pdf$/i.test(d.name) || d.mime === 'application/pdf'

ipcMain.on('download:show', (_e, id) => {
  const d = downloads.get(Number(id))
  if (d) shell.showItemInFolder(d.path)
})
ipcMain.on('download:open', (e, id) => {
  const d = downloads.get(Number(id))
  if (!d || d.state !== 'completed') return
  const pw = windows.get(BrowserWindow.fromWebContents(e.sender)?.id)
  // PDFs open in a tab with the built-in viewer; anything else in its own app.
  if (isPdfDownload(d) && pw) pw.selectTab(pw.createTab(pathToFileURL(d.path).href).id)
  else shell.openPath(d.path)
})

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
  xp.add('blocked')
  quests.progress('blocked')
  if (countTimers.has(wcId)) return
  countTimers.set(
    wcId,
    setTimeout(() => {
      countTimers.delete(wcId)
      const pw = windowForTab(wcId)
      if (pw && pw.activeId === wcId) pw.pushState()
    }, 250)
  )
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

function chromeUserAgent(ua) {
  return ua.replace(/ Electron\/\S+/, '').replace(/ (pixelbrowser|bit-browser|Bit Browser|@pixelbrowser\/desktop)\/\S+/gi, '')
}

async function openWindow({ isPrivate = false, url, restore = null } = {}) {
  if (!isPrivate) sessionFrozen = false
  // Private windows get an in-memory partition: nothing touches disk.
  const ses = isPrivate
    ? session.fromPartition(`private-${Date.now()}`)
    : session.fromPartition(PROFILE_PARTITION)
  // Look like plain Chrome to websites. The default user agent includes
  // "Electron" and the app name, and Google then refuses or shortens sign-ins.
  ses.setUserAgent(chromeUserAgent(ses.getUserAgent()))
  const extensions = await prepareSession(ses, { isPrivate })
  const pw = new PixelWindow({ ses, extensions, isPrivate })
  pw.win.webContents.once('did-finish-load', () => {
    const restored = restore ? restoreInto(pw, restore, { all: store.settings.data.startup !== 'new' }) : false
    // A link opened from another app still gets its own new tab on top.
    if (url || !restored) pw.createTab(url)
  })
  return pw
}

// ---------- site permissions ----------

const PERM_LABEL = { camera: 'camera', microphone: 'microphone', location: 'location', notifications: 'notifications' }
const privatePerms = new Map() // host -> { kind: 'allow'|'block' } for private windows (forgotten on quit)

/** Which of our four permission kinds a request is about, or null for anything else. */
function permissionKinds(permission, details) {
  if (permission === 'media') {
    const types = details?.mediaTypes?.length ? details.mediaTypes : ['video', 'audio']
    return [...new Set(types.map((t) => (t === 'video' ? 'camera' : 'microphone')))]
  }
  if (permission === 'geolocation') return ['location']
  if (permission === 'notifications') return ['notifications']
  return null
}

const permHost = (url) => {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

function sitePermission(url, kind, isPrivate) {
  const host = permHost(url)
  if (!host) return 'block'
  const table = isPrivate ? privatePerms.get(host) : store.settings.data.sitePerms[host]
  return table?.[kind] || 'ask'
}

function setSitePermission(host, kind, value, isPrivate = false) {
  if (!host || !PERM_LABEL[kind]) return
  if (isPrivate) {
    privatePerms.set(host, { ...(privatePerms.get(host) || {}), [kind]: value })
    return
  }
  const perms = store.settings.data.sitePerms
  const cur = { ...(perms[host] || {}) }
  if (value === 'ask') delete cur[kind]
  else cur[kind] = value
  if (Object.keys(cur).length) perms[host] = cur
  else delete perms[host]
  store.settings.data.sitePermsUpdatedAt = Date.now()
  store.settings.save()
  store.putRecord('settings', 'site-settings', { perms })
}

const permAsks = new Map() // "host|kinds" -> pending promise, so one bar answers repeated requests

async function askPermission(wc, kinds, url, isPrivate) {
  const host = permHost(url)
  if (!host) return false
  const now = kinds.map((k) => sitePermission(url, k, isPrivate))
  if (now.every((v) => v === 'allow')) return true
  if (now.some((v) => v === 'block')) return false
  const pw = wc && windowForTab(wc.id)
  if (!pw) return false
  const key = `${isPrivate ? 'p' : ''}${host}|${kinds.join(',')}`
  if (permAsks.has(key)) return permAsks.get(key)
  const ask = pw
    .prompt({
      tabId: wc.id,
      kind: 'permission',
      label: 'PERMISSION',
      text: `${host.replace(/^www\./, '')} wants to use your ${kinds.map((k) => PERM_LABEL[k]).join(' and ')}`,
      buttons: [
        { id: 'allow', label: 'ALLOW', hot: true },
        { id: 'block', label: 'BLOCK' },
      ],
      key: `perm:${wc.id}:${kinds.join(',')}`,
    })
    .then((answer) => {
      permAsks.delete(key)
      if (answer !== 'allow' && answer !== 'block') return false
      for (const k of kinds) setSitePermission(host, k, answer, isPrivate)
      broadcastSettingsSoon()
      return answer === 'allow'
    })
  permAsks.set(key, ask)
  return ask
}

function applyRemoteSitePerms() {
  const rec = store.records.data.settings['site-settings']
  const s = store.settings.data
  if (!rec || rec.deleted || rec.deviceId === s.deviceId || rec.updatedAt <= (s.sitePermsUpdatedAt || 0)) return
  if (rec.data?.perms && typeof rec.data.perms === 'object') {
    s.sitePerms = rec.data.perms
    s.sitePermsUpdatedAt = rec.updatedAt
    store.settings.save()
  }
}

// ---------- library window (bookmarks manager + history) ----------

let libraryWin = null

function openLibrary(section = 'bookmarks') {
  if (libraryWin && !libraryWin.isDestroyed()) {
    libraryWin.webContents.send('library:goto', section)
    return libraryWin.focus()
  }
  libraryWin = new BrowserWindow({
    width: 860,
    height: 720,
    title: 'Bit Browser Library',
    backgroundColor: '#0b0b16',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'library-preload.js'), sandbox: true, contextIsolation: true },
  })
  libraryWin.setMenuBarVisibility(false)
  libraryWin.webContents.on('did-finish-load', () => applyTheme(libraryWin.webContents))
  libraryWin.loadFile(path.join(__dirname, 'ui', 'library.html'), { hash: section })
}

function notifyLibrary() {
  if (libraryWin && !libraryWin.isDestroyed()) libraryWin.webContents.send('library:changed')
}

// ---------- bookmarks ----------

function focusedWindow() {
  const focused = BrowserWindow.getFocusedWindow()
  return (focused && windows.get(focused.id)) || [...windows.values()].find((w) => !w.isPrivate) || windows.values().next().value
}

function toggleBookmark(pw) {
  const tab = pw.activeTab()
  const url = realUrl(tab)
  if (!/^https?:/.test(url)) return
  const id = bookmarks.find(url)
  if (!id) {
    bookmarks.add({ url, title: tab.reader?.title || tab.view.webContents.getTitle() || url })
    quests.progress('bookmarked')
    pw.toast('Bookmarked. It\'s on the bookmarks bar.')
    return
  }
  const cur = bookmarks.list().find((b) => b.id === id)
  Menu.buildFromTemplate([
    { label: `Bookmarked in "${cur?.folder || bookmarks.DEFAULT_FOLDER}"`, enabled: false },
    { label: 'Move to folder', submenu: bookmarks.folders().map((f) => ({ label: f, type: 'radio', checked: f === cur?.folder, click: () => bookmarks.update(id, { folder: f }) })) },
    { label: 'Edit in bookmarks manager…', click: () => openLibrary('bookmarks') },
    { type: 'separator' },
    { label: 'Remove bookmark', click: () => bookmarks.remove(id) },
  ]).popup({ window: pw.win })
}

function bookmarkMenu(pw, id) {
  const b = bookmarks.list().find((x) => x.id === id)
  if (!b) return
  Menu.buildFromTemplate([
    { label: 'Open', click: () => pw.load(pw.activeTab()?.view.webContents, b.url) },
    { label: 'Open in new tab', click: () => pw.createTab(b.url) },
    { label: 'Edit in bookmarks manager…', click: () => openLibrary('bookmarks') },
    { type: 'separator' },
    { label: 'Delete', click: () => bookmarks.remove(id) },
  ]).popup({ window: pw.win })
}

function folderMenu(pw, name) {
  const items = bookmarks.list().filter((b) => b.folder === name)
  Menu.buildFromTemplate([
    ...(items.length
      ? items.slice(0, 50).map((b) => ({ label: (b.title || b.url).slice(0, 60), click: () => pw.load(pw.activeTab()?.view.webContents, b.url) }))
      : [{ label: '(empty)', enabled: false }]),
    { type: 'separator' },
    { label: 'Open all in new tabs', enabled: items.length > 0, click: () => items.slice(0, 20).forEach((b) => pw.createTab(b.url, { select: false })) },
    { label: 'Bookmarks manager…', click: () => openLibrary('bookmarks') },
  ]).popup({ window: pw.win })
}

bookmarks.onChange(() => {
  for (const pw of windows.values()) pw.pushState()
  notifyLibrary()
})

function toggleBookmarksBar() {
  store.settings.data.bookmarksBar = !store.settings.data.bookmarksBar
  store.settings.save()
  for (const pw of windows.values()) pw.pushState()
  broadcastSettingsSoon()
}

// ---------- the toolbar menu ----------

function appMenu(pw) {
  const tab = pw.activeTab()
  const url = realUrl(tab)
  const web = /^https?:/.test(url)
  Menu.buildFromTemplate([
    { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => pw.createTab() },
    { label: 'New private window', accelerator: 'CmdOrCtrl+Shift+N', click: () => openWindow({ isPrivate: true }) },
    { label: 'Reopen closed tab', accelerator: 'CmdOrCtrl+Shift+T', enabled: pw.closed.length > 0, click: () => pw.reopenClosed() },
    { type: 'separator' },
    { label: bookmarks.find(url) ? 'Edit bookmark…' : 'Bookmark this page', accelerator: 'CmdOrCtrl+D', enabled: web, click: () => toggleBookmark(pw) },
    { label: 'Bookmarks manager', accelerator: 'CmdOrCtrl+Shift+O', click: () => openLibrary('bookmarks') },
    { label: 'Show bookmarks bar', type: 'checkbox', checked: !!store.settings.data.bookmarksBar, accelerator: 'CmdOrCtrl+Shift+B', click: () => toggleBookmarksBar() },
    { label: 'History', accelerator: 'CmdOrCtrl+H', click: () => openLibrary('history') },
    { label: 'Downloads folder', click: () => shell.openPath(downloadDir()) },
    { type: 'separator' },
    { label: 'Find in page…', accelerator: 'CmdOrCtrl+F', enabled: !!tab, click: () => pw.openFind() },
    { label: tab?.reader ? 'Leave reader mode' : 'Reader mode', accelerator: 'CmdOrCtrl+Alt+R', enabled: !!tab?.reader || (web && !!tab?.readerable), click: () => pw.toggleReader() },
    { label: 'Translate this page', enabled: web, submenu: pw.translateItems() },
    { label: 'Picture in picture (video)', enabled: web, click: () => tab?.view.webContents.executeJavaScript(pipJS(0, 0), true).catch(() => {}) },
    { label: 'Fill business details', enabled: web, click: () => pw.fillBusiness() },
    { type: 'separator' },
    { label: 'Save page as PDF', accelerator: 'CmdOrCtrl+Shift+S', enabled: !!tab, click: () => pw.savePdf() },
    { label: 'Print…', accelerator: 'CmdOrCtrl+P', enabled: !!tab, click: () => tab?.view.webContents.print({}) },
    { type: 'separator' },
    { label: 'Passwords…', click: () => openSettings('passwords') },
    { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
  ]).popup({ window: pw.win })
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
    for (const t of pw.tabs) if (!t.view.webContents.isDestroyed() && isNtp(t.view.webContents.getURL())) applyTheme(t.view.webContents)
    pw.pushState()
  }
  if (settingsWin && !settingsWin.isDestroyed()) applyTheme(settingsWin.webContents)
  if (libraryWin && !libraryWin.isDestroyed()) applyTheme(libraryWin.webContents)
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
      { id: 'downloads', label: 'Downloads', value: `saved in ${downloadDir()}`, synced: false },
      { id: 'bookmarks', label: 'Bookmarks', value: `${bookmarks.list().length} bookmarks`, synced: true },
      { id: 'passwords', label: 'Passwords, addresses and cards', value: (() => { const v = vault.summary(); return `${v.logins.length} logins, ${v.addresses.length} addresses, ${v.cards.length} cards (encrypted with your OS keychain)` })(), synced: !!s.vault.syncPasswords },
      { id: 'sites', label: 'Site permissions', value: `${Object.keys(s.sitePerms || {}).length} sites`, synced: true },
      { id: 'crash', label: 'Crash log', value: s.crashReports ? `${crashlog.read().length} entries` : 'off', synced: false },
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
  } else if (id === 'bookmarks') {
    for (const b of bookmarks.list()) store.putRecord('bookmarks', b.id, null, { deleted: true })
    bookmarks.changed()
  } else if (id === 'passwords') {
    vault.wipe()
  } else if (id === 'sites') {
    store.settings.data.sitePerms = {}
    store.settings.data.sitePermsUpdatedAt = Date.now()
    store.settings.save()
    store.putRecord('settings', 'site-settings', { perms: {} })
  } else if (id === 'crash') {
    crashlog.clear()
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
ipcMain.on('tab:menu', (e, id) => fromSender(e)?.tabMenu(id))
ipcMain.on('tab:pin', (e, id, pinned) => fromSender(e)?.pinTab(id, pinned))
ipcMain.on('shell:height', (e, h) => {
  const pw = fromSender(e)
  const n = Math.round(Number(h))
  if (!pw || !(n >= 60 && n <= 600) || n === pw.shellH) return
  pw.shellH = n
  pw.layout()
})
ipcMain.on('bookmark:toggle', (e) => {
  const pw = fromSender(e)
  if (pw) toggleBookmark(pw)
})
ipcMain.on('bookmark:menu', (e, id) => {
  const pw = fromSender(e)
  if (pw) bookmarkMenu(pw, id)
})
ipcMain.on('bookmark:folder-menu', (e, name) => {
  const pw = fromSender(e)
  if (pw) folderMenu(pw, String(name || ''))
})
ipcMain.on('find:query', (e, text, opts) => fromSender(e)?.find(text, opts || {}))
ipcMain.on('find:stop', (e) => fromSender(e)?.stopFind())
ipcMain.on('prompt:answer', (e, id, action) => fromSender(e)?.answerPrompt(id, action))
ipcMain.on('reader:toggle', (e) => fromSender(e)?.toggleReader())
ipcMain.on('app:menu', (e) => {
  const pw = fromSender(e)
  if (pw) appMenu(pw)
})

// ---------- IPC from the Library window ----------

ipcMain.handle('library:bookmarks', () => ({ bookmarks: bookmarks.list(), folders: bookmarks.folders() }))
ipcMain.handle('library:bookmark-update', (_e, id, patch) => bookmarks.update(id, patch || {}))
ipcMain.handle('library:bookmark-remove', (_e, id) => bookmarks.remove(id))
ipcMain.handle('library:folder-add', (_e, name) => bookmarks.addFolder(name))
ipcMain.handle('library:folder-rename', (_e, from, to) => bookmarks.renameFolder(from, to))
ipcMain.handle('library:folder-remove', (_e, name) => bookmarks.removeFolder(name))
ipcMain.handle('library:history', (_e, query) => store.history.search(query, 800))
ipcMain.handle('library:history-remove', (_e, id) => store.history.remove(id))
ipcMain.handle('library:history-clear', async (_e, range, siteData) => {
  const since = { hour: Date.now() - 3600e3, day: Date.now() - 86400e3, week: Date.now() - 7 * 86400e3, all: 0 }[range] ?? Date.now() - 3600e3
  const n = store.history.clearSince(since)
  if (siteData) {
    const ses = session.fromPartition(PROFILE_PARTITION)
    await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql', 'filesystem'] }).catch(() => {})
    await ses.clearCache().catch(() => {})
  }
  return n
})
ipcMain.on('library:open', (_e, url, newTab) => {
  if (!isAllowedUrl(url)) return
  const pw = [...windows.values()].find((w) => !w.isPrivate)
  if (!pw) return openWindow({ url })
  if (newTab || !pw.activeTab()) pw.selectTab(pw.createTab(url).id)
  else pw.load(pw.activeTab().view.webContents, url)
  pw.win.focus()
})
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
    pw.pushStateNow()
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
    startup: s.startup || 'restore',
    theme: s.theme,
    themes: Object.fromEntries(Object.entries(THEMES).map(([id, t]) => [id, t])),
    sounds: !!s.sounds,
    privacy: { doh: s.privacy.doh, dohCustom: s.privacy.dohCustom, panicRange: s.privacy.panicRange },
    privateLock: { enabled: s.privateLock.enabled, hasPin: !!s.privateLock.pin, minutes: s.privateLock.minutes },
    phishing: { enabled: s.phishing.enabled, lastUpdate: s.phishing.lastUpdate, hosts: phishing.count() },
    spaces: spaceList(),
    xp: xp.summary(),
    familyLinks: s.familyLinks,
    quests: quests.list(),
    bookmarksBar: !!s.bookmarksBar,
    newTabPage: s.newTabPage || 'bit',
    ntpShortcuts: Array.isArray(s.ntpShortcuts) ? s.ntpShortcuts : DEFAULT_SHORTCUTS,
    sitePerms: s.sitePerms || {},
    downloads: { folder: s.downloads.folder || '', folderShown: downloadDir(), ask: !!s.downloads.ask, autoPrintLabels: !!s.downloads.autoPrintLabels },
    business: s.business || {},
    crashReports: !!s.crashReports,
    crashCount: crashlog.read().length,
    vault: vault.summary(),
    vaultLocked: !!s.privateLock.pin,
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
  if (patch.siteUp) {
    shields.setSiteDown(patch.siteUp, false)
    for (const pw of windows.values()) pw.activeTab()?.view.webContents.reload()
  }
  if (patch.autoplay && AUTOPLAY[patch.autoplay]) s.autoplay = patch.autoplay
  if (patch.startup === 'restore' || patch.startup === 'new') s.startup = patch.startup
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
  if (typeof patch.bookmarksBar === 'boolean') s.bookmarksBar = patch.bookmarksBar
  if (patch.newTabPage === 'bit' || patch.newTabPage === 'search') s.newTabPage = patch.newTabPage
  if (patch.ntpShortcuts === null) s.ntpShortcuts = null
  else if (Array.isArray(patch.ntpShortcuts)) {
    s.ntpShortcuts = patch.ntpShortcuts
      .filter((x) => x && /^https?:\/\//i.test(String(x.url || '').trim()))
      .slice(0, 24)
      .map((x) => ({ title: String(x.title || '').trim().slice(0, 40), url: String(x.url).trim().slice(0, 500) }))
  }
  if (patch.sitePerm) {
    const { host, kind, value } = patch.sitePerm
    if (['allow', 'block', 'ask'].includes(value)) setSitePermission(String(host || '').toLowerCase(), kind, value)
  }
  if (patch.siteReset) {
    delete s.sitePerms[String(patch.siteReset)]
    s.sitePermsUpdatedAt = Date.now()
    store.putRecord('settings', 'site-settings', { perms: s.sitePerms })
  }
  if (patch.downloads) {
    if (typeof patch.downloads.ask === 'boolean') s.downloads.ask = patch.downloads.ask
    if (typeof patch.downloads.autoPrintLabels === 'boolean') s.downloads.autoPrintLabels = patch.downloads.autoPrintLabels
    if (patch.downloads.folder === '') s.downloads.folder = ''
  }
  if (patch.business) {
    const b = {}
    for (const k of ['company', 'name', 'street', 'city', 'region', 'postal', 'country', 'phone', 'email']) {
      const v = String(patch.business[k] || '').trim().slice(0, 200)
      if (v) b[k] = v
    }
    s.business = Object.keys(b).length ? b : null
  }
  if (typeof patch.crashReports === 'boolean') {
    s.crashReports = patch.crashReports
    if (!patch.crashReports) crashlog.clear()
  }
  if (patch.vault) vault.setOptions(patch.vault)
  store.settings.save()
  for (const pw of windows.values()) pw.pushState()
  return settingsState()
})
ipcMain.handle('settings:panic', async (_e, range) => {
  await runPanic(range)
  return settingsState()
})
ipcMain.handle('settings:data', () => dataReport())

// Passwords (Settings → Passwords). Showing a password needs the PIN when one
// is set (Settings → Security), otherwise the Settings page asks you to confirm.
ipcMain.handle('vault:reveal', (_e, kind, id, pin) => {
  if (store.settings.data.privateLock.pin && !checkPin(String(pin || ''))) return { error: 'Wrong PIN.' }
  if (kind === 'login') return vault.getLogin(id) || { error: 'Not found.' }
  if (kind === 'card') return vault.listCards().find((c) => c.id === id) || { error: 'Not found.' }
  if (kind === 'address') return vault.listAddresses().find((a) => a.id === id) || { error: 'Not found.' }
  return { error: 'Unknown.' }
})
ipcMain.handle('vault:save', (_e, kind, data) => {
  if (kind === 'login') {
    if (data.id) vault.updateLogin(data.id, data)
    else vault.saveLogin({ url: data.url, username: data.username, password: data.password })
  } else if (kind === 'address') vault.saveAddress(data)
  else if (kind === 'card') vault.saveCard(data)
  return settingsState()
})
ipcMain.handle('vault:delete', (_e, kind, id) => {
  if (kind === 'login') vault.deleteLogin(id)
  else if (kind === 'address') vault.deleteAddress(id)
  else if (kind === 'card') vault.deleteCard(id)
  return settingsState()
})
ipcMain.handle('settings:pick-download-folder', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const r = await dialog.showOpenDialog(win, { title: 'Save downloads in…', defaultPath: downloadDir(), properties: ['openDirectory', 'createDirectory'] })
  if (!r.canceled && r.filePaths[0]) {
    store.settings.data.downloads.folder = r.filePaths[0]
    store.settings.save()
  }
  return settingsState()
})
ipcMain.handle('settings:crash-log', () => ({ entries: crashlog.read().slice(-30).reverse(), report: crashlog.report() }))
ipcMain.handle('settings:crash-copy', () => {
  const r = crashlog.report()
  if (r) clipboard.writeText(r)
  return !!r
})
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
    applyRemoteSitePerms()
  }
  // Synced passwords move into the encrypted vault (and the record copies are stripped).
  vault.applyRemote()
  if (changed.includes('bookmarks')) bookmarks.changed()
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

// A finished quest: tell every window, and play the level-up sound.
quests.onChange((completed) => {
  for (const q of completed || []) for (const pw of windows.values()) {
    pw.toast(`Quest complete: ${q.title} (+${q.xp} XP)`)
    pw.sound('levelup')
  }
  broadcastSettingsSoon()
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
  globalThis.__bitTest = {
    runPanic, shields, xp, setTheme, windows, history: store.history, records: store.records, downloads,
    bookmarks, vault, quests, store, openLibrary, toggleBookmark, appMenu, isNtp, NTP_URL, realUrl,
    sitePermission, setSitePermission, lastAutoPrint: () => lastAutoPrint, crashlog,
  }
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
          { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: (_i, w) => (w && windows.get(w.id))?.reopenClosed() },
          { type: 'separator' },
          { label: 'Save Page as PDF', accelerator: 'CmdOrCtrl+Shift+S', click: (_i, w) => (w && windows.get(w.id))?.savePdf() },
          { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: (_i, w) => (w && windows.get(w.id))?.activeTab()?.view.webContents.print({}) },
          { type: 'separator' },
          { label: 'Bitter Sidebar', accelerator: 'CmdOrCtrl+J', click: (_i, w) => w && windows.get(w.id)?.toggleSidebar() },
          { label: 'Panic: Close Private Windows and Wipe Recent Activity', accelerator: 'CmdOrCtrl+Shift+X', click: (_i, w) => panic(w) },
          { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
          { type: 'separator' },
          { label: 'Find in Page…', accelerator: 'CmdOrCtrl+F', click: (_i, w) => (w && windows.get(w.id))?.openFind() },
          { label: 'Fill Business Details', click: (_i, w) => (w && windows.get(w.id))?.fillBusiness() },
        ],
      },
      {
        label: 'Bookmarks',
        submenu: [
          { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: (_i, w) => { const pw = w && windows.get(w.id); if (pw) toggleBookmark(pw) } },
          { label: 'Bookmarks Manager', accelerator: 'CmdOrCtrl+Shift+O', click: () => openLibrary('bookmarks') },
          { label: 'Show Bookmarks Bar', accelerator: 'CmdOrCtrl+Shift+B', click: () => toggleBookmarksBar() },
          { label: 'History', accelerator: 'CmdOrCtrl+H', click: () => openLibrary('history') },
        ],
      },
      {
        label: 'View',
        submenu: [
          { label: 'Reader Mode', accelerator: 'CmdOrCtrl+Alt+R', click: (_i, w) => (w && windows.get(w.id))?.toggleReader() },
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
  const saved = store.settings.data.session?.windows || []
  if (saved.length) {
    await openWindow({ restore: saved[0], url: startUrls[0] || process.env.PIXEL_START_URL })
    for (const w of saved.slice(1)) await openWindow({ restore: w })
  } else await openWindow({ url: startUrls[0] || process.env.PIXEL_START_URL })
  startUrls.slice(1).forEach(openUrlInBrowser)
  syncHost.start()
  updater.start()
  updateExtensions().catch(() => {})
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (windows.size === 0) openWindow({ restore: store.settings.data.session?.windows?.[0] || null })
})

// Write sign-in cookies to disk regularly and on quit, so you stay logged in
// even if the app is closed right after signing in. (No quit interception:
// that would get in the way of installing updates.)
const flushCookies = () => session.fromPartition(PROFILE_PARTITION).cookies.flushStore().catch(() => {})
app.whenReady().then(() => setInterval(flushCookies, 30000))
app.on('before-quit', flushCookies)
app.on('before-quit', () => {
  saveSessionNow()
  sessionFrozen = true
})
