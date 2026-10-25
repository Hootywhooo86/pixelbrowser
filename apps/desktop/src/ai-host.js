// Desktop side of the AI assistant: AI settings, the browser "driver" the
// shared agent uses to reach tabs, and one chat session per window.

const crypto = require('node:crypto')
const { ipcMain } = require('electron')
const {
  PROVIDERS, WEB_APPS, resolveProvider, providerProblem, runAssistant, historySize,
  locateScript, focusScript, EXTRACT_PAGE, capStatus, addSpend,
} = require('@pixelbrowser/ai-core')
const store = require('./store')

const LOG_LIMIT = 500

const MAX_HISTORY_CHARS = 600_000
const SCRIPT_TIMEOUT_MS = 10_000

// ---------- settings ----------

function aiSettings() {
  return store.settings.data.ai
}

function currentProvider() {
  const ai = aiSettings()
  const overrides = ai.providers[ai.provider] || {}
  return resolveProvider({ provider: ai.provider, ...overrides, apiKey: store.secrets.get(`apiKey:${ai.provider}`) })
}

function publicState() {
  const ai = aiSettings()
  return {
    provider: ai.provider,
    providers: Object.fromEntries(
      Object.entries(PROVIDERS).map(([id, p]) => [
        id,
        { ...p, ...(ai.providers[id] || {}), hasKey: store.secrets.has(`apiKey:${id}`) },
      ])
    ),
    webApps: WEB_APPS,
    memoryEnabled: store.settings.data.memoryEnabled,
    aiEnabled: store.settings.data.aiEnabled,
    memory: spaceMemory().items(),
    space: currentSpace(),
    spending: spendingSummary(),
  }
}

/** { provider, model?, baseUrl?, apiKey? } — apiKey '' clears, undefined keeps. */
function saveSettings({ provider, model, baseUrl, apiKey }) {
  const ai = aiSettings()
  if (provider && PROVIDERS[provider]) ai.provider = provider
  const id = ai.provider
  ai.providers[id] = {
    ...(ai.providers[id] || {}),
    ...(model !== undefined ? { model: model.trim() } : {}),
    ...(baseUrl !== undefined ? { baseUrl: baseUrl.trim() } : {}),
  }
  if (apiKey !== undefined) store.secrets.set(`apiKey:${id}`, apiKey.trim())
  store.settings.data.updatedAt.ai = Date.now()
  store.settings.save()
  syncedSettingsChanged()
  return publicState()
}

/** Mirror AI settings (and optionally keys) into the synced 'settings' collection. */
function syncedSettingsChanged() {
  const ai = aiSettings()
  store.putRecord('settings', 'ai', { provider: ai.provider, providers: ai.providers })
  const keys = {}
  for (const id of Object.keys(PROVIDERS)) {
    const k = store.secrets.get(`apiKey:${id}`)
    if (k) keys[id] = k
  }
  store.putRecord('settings', 'ai-keys', keys)
}

/** Apply AI settings that arrived from another device. */
function applyRemoteSettings() {
  const rec = store.records.data.settings.ai
  if (rec && !rec.deleted && rec.deviceId !== store.settings.data.deviceId && rec.updatedAt > store.settings.data.updatedAt.ai) {
    store.settings.data.ai = { provider: rec.data.provider, providers: rec.data.providers || {} }
    store.settings.data.updatedAt.ai = rec.updatedAt
    store.settings.save()
  }
  const keys = store.records.data.settings['ai-keys']
  if (keys && !keys.deleted && keys.deviceId !== store.settings.data.deviceId && store.settings.data.sync.syncKeys) {
    for (const [id, k] of Object.entries(keys.data || {})) if (PROVIDERS[id] && k) store.secrets.set(`apiKey:${id}`, k)
  }
}

// ---------- memory, kept per Space ----------
// Lives in store.memory (synced 'memory' collection, same format as the
// phone: plain-string data, Space in the record id).

const currentSpace = () => store.settings.data.activeSpace || 'personal'
const spaceMemory = (space = currentSpace()) => store.memory.forSpace(space)

const memoryApi = (space) => {
  const m = spaceMemory(space)
  return {
    enabled: store.settings.data.memoryEnabled,
    items: m.items(),
    add: async (fact) => m.add(fact),
    remove: async (fact) => m.remove(fact),
  }
}

// ---------- spending cap ----------

function spending() {
  const s = store.settings.data
  if (!s.spending) s.spending = { capDay: 0, capMonth: 0, spent: {} }
  return s.spending
}

function spendingSummary() {
  const sp = spending()
  const today = new Date()
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const day = Number(sp.spent[key(today)]) || 0
  const month = Object.entries(sp.spent).reduce((n, [k, v]) => (k.startsWith(key(today).slice(0, 7)) ? n + v : n), 0)
  return { capDay: sp.capDay, capMonth: sp.capMonth, today: day, month }
}

const spendApi = () => ({
  check: () => capStatus(spending()),
  add: (dollars) => {
    addSpend(spending().spent, dollars)
    store.settings.save()
  },
})

ipcMain.handle('ai:get-spending', () => spendingSummary())
ipcMain.handle('ai:set-spending', (_e, { capDay, capMonth } = {}) => {
  const sp = spending()
  sp.capDay = Math.max(0, Number(capDay) || 0)
  sp.capMonth = Math.max(0, Number(capMonth) || 0)
  store.settings.save()
  return spendingSummary()
})

// ---------- agent activity log ----------

function agentLog() {
  const s = store.settings.data
  if (!Array.isArray(s.agentLog)) s.agentLog = []
  return s.agentLog
}

function addLog(entry) {
  const log = agentLog()
  log.push({ id: crypto.randomUUID(), at: Date.now(), ...entry })
  if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT)
  store.settings.save()
}

ipcMain.handle('ai:get-log', () => agentLog().slice().reverse())
ipcMain.handle('ai:clear-log', () => {
  store.settings.data.agentLog = []
  store.settings.save()
  return []
})

// ---------- driver: how the shared agent reaches this window's tabs ----------

function withTimeout(promise, ms, message) {
  let t
  return Promise.race([promise, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(message)), ms)))]).finally(() => clearTimeout(t))
}

function createDriver(pw) {
  const wcOf = (id) => {
    const tab = pw.getTab(id)
    if (!tab) throw new Error(`Tab ${id} is not open.`)
    return tab.view.webContents
  }
  const run = (id, script) => withTimeout(wcOf(id).executeJavaScript(script, true), SCRIPT_TIMEOUT_MS, 'The page did not respond.')

  const key = (wc, keyCode) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode })
    if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' })
    wc.sendInputEvent({ type: 'keyUp', keyCode })
  }

  return {
    activeTabId: async () => pw.activeId,
    listTabs: async () => pw.tabs.map((t) => ({ id: t.id, title: t.view.webContents.getTitle(), url: t.view.webContents.getURL() })),
    run,
    // Real mouse and keyboard events, so sites can't tell the agent from you.
    click: async (id, ref) => {
      const pos = await run(id, locateScript(ref))
      if (!pos?.ok) return pos
      const wc = wcOf(id)
      wc.sendInputEvent({ type: 'mouseMove', x: pos.x, y: pos.y })
      wc.sendInputEvent({ type: 'mouseDown', x: pos.x, y: pos.y, button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: pos.x, y: pos.y, button: 'left', clickCount: 1 })
      return { ok: true, message: `Clicked ${ref}.` }
    },
    type: async (id, ref, text, submit) => {
      const focused = await run(id, focusScript(ref))
      if (!focused?.ok) return focused
      const wc = wcOf(id)
      await wc.insertText(text)
      if (submit) key(wc, 'Enter')
      return { ok: true, message: `Typed into ${ref}${submit ? ' and pressed Enter' : ''}.` }
    },
    press: async (id, keyName) => {
      key(wcOf(id), keyName)
      return { ok: true, message: `Pressed ${keyName}.` }
    },
    navigate: async (id, url) => wcOf(id).loadURL(url).catch(() => {}),
    goBack: async (id) => wcOf(id).navigationHistory.goBack(),
    openTab: async (url) => pw.createTab(url).id,
    selectTab: async (id) => pw.selectTab(id),
    waitForLoad: (id, timeout = 10_000) =>
      new Promise((resolve) => {
        const wc = wcOf(id)
        const settle = () => setTimeout(resolve, 400)
        if (!wc.isLoading()) return settle()
        const t = setTimeout(resolve, timeout)
        wc.once('did-stop-loading', () => {
          clearTimeout(t)
          settle()
        })
      }),
    fetchText: async (url) => {
      const res = await pw.ses.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Bit Browser)' } })
      return res.text()
    },
  }
}

// ---------- one chat session per window ----------

class AISession {
  constructor(pw) {
    this.pw = pw
    this.history = []
    this.abort = null
    this.confirms = new Map()
  }

  /** Switch this window's Bitter to another Space: its own memory and a fresh chat. */
  setSpace(id) {
    if (!id || id === currentSpace()) return
    store.settings.data.activeSpace = String(id)
    store.settings.save()
    this.newChat()
    this.pw.sendSidebar('sidebar:state', publicState())
  }

  emit(event) {
    this.pw.sendSidebar('ai:event', event)
  }

  newChat() {
    this.stop()
    this.history = []
    this.emit({ type: 'reset' })
  }

  stop() {
    this.abort?.abort()
    for (const resolve of this.confirms.values()) resolve(false)
    this.confirms.clear()
  }

  answerConfirm(id, ok) {
    const resolve = this.confirms.get(id)
    if (resolve) {
      this.confirms.delete(id)
      resolve(!!ok)
    }
  }

  confirm(request) {
    return new Promise((resolve) => {
      const id = crypto.randomUUID()
      this.confirms.set(id, resolve)
      this.emit({ type: 'confirm', id, ...request, action: undefined })
    })
  }

  async ask({ input, mode = 'ask', tabIds, search = false, includePage = true, video = false }) {
    if (!store.settings.data.aiEnabled) {
      this.emit({ type: 'error', message: 'AI is off. Turn on the AI slider to use Bitter.' })
      return
    }
    if (this.pw.isPrivate) {
      this.emit({ type: 'error', message: 'The assistant is off in private windows, so nothing you do here leaves this device.' })
      return
    }
    if (this.abort) this.stop()
    const provider = currentProvider()
    const problem = providerProblem(provider)
    this.emit({ type: 'user', text: input, mode })
    if (problem) {
      this.emit({ type: 'error', message: problem, openSettings: true })
      return
    }
    if (historySize(this.history) > MAX_HISTORY_CHARS) {
      this.history = []
      this.emit({ type: 'notice', text: 'This chat got very long, so I started a fresh one.' })
    }

    const controller = new AbortController()
    controller.runId = crypto.randomUUID()
    this.abort = controller
    this.emit({ type: 'busy', busy: true })
    try {
      const { history } = await runAssistant({
        provider,
        driver: createDriver(this.pw),
        history: this.history,
        input,
        mode,
        tabIds,
        search,
        includePage,
        video,
        memory: memoryApi(),
        spend: spendApi(),
        signal: controller.signal,
        onEvent: (e) => {
          if (e.type === 'agent') this.pw.setAgentActive(e.active)
          if (e.type === 'log') addLog({ ...e, type: undefined, runId: controller.runId })
          this.emit(e)
        },
        confirm: (req) => this.confirm(req),
      })
      this.history = history
    } catch (err) {
      if (err.history) this.history = err.history
      this.emit({ type: 'error', message: friendlyError(err, provider) })
    } finally {
      if (this.abort === controller) this.abort = null
      this.emit({ type: 'busy', busy: false })
      this.pw.sendSidebar('sidebar:state', publicState())
    }
  }

  /** Paste the current page into an AI web app open in the sidebar. */
  async sharePageWithApp(appWc) {
    const tab = this.pw.activeTab()
    if (!tab || !appWc || !store.settings.data.aiEnabled) return
    const page = await withTimeout(tab.view.webContents.executeJavaScript(EXTRACT_PAGE, true), SCRIPT_TIMEOUT_MS, 'timeout').catch(() => null)
    if (!page) return
    const text = `Here is the page I'm looking at.\nTitle: ${page.title}\nURL: ${page.url}\n\n${(page.selection || page.text).slice(0, 12000)}\n\n`
    await appWc.executeJavaScript(
      `(() => { const el = document.querySelector('textarea, [contenteditable="true"], [contenteditable=""], input[type=text]'); if (el) el.focus(); return !!el })()`,
      true
    ).catch(() => false)
    appWc.focus()
    await appWc.insertText(text)
  }
}

function friendlyError(err, provider) {
  const msg = String(err?.message || err)
  if (/401|invalid.*key|authentication/i.test(msg)) return `${provider.label} rejected the API key. Check it in AI settings.`
  if (/429|rate/i.test(msg)) return `${provider.label} says you're sending too many requests or are out of credit. Try again soon.`
  if (/ECONNREFUSED|fetch failed/i.test(msg) && provider.local) return `Couldn't reach ${provider.label} at ${provider.baseUrl}. Is it running?`
  return msg.slice(0, 400)
}

module.exports = { AISession, publicState, saveSettings, applyRemoteSettings, syncedSettingsChanged, spaceMemory }
