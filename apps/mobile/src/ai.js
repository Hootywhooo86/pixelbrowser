// Phone side of the AI assistant: settings, the browser driver for the
// shared agent, and one chat session that lives while the app runs.

import { PROVIDERS, resolveProvider, providerProblem, runAssistant, historySize, capStatus, addSpend } from '@pixelbrowser/ai-core'
import { getState, update, getSecret, setSecret, putRecord, memory } from './store'

const MAX_HISTORY_CHARS = 400_000
const LOG_LIMIT = 500

export async function currentProvider() {
  const { ai } = getState()
  return resolveProvider({ provider: ai.provider, ...(ai.providers[ai.provider] || {}), apiKey: await getSecret(`apiKey:${ai.provider}`) })
}

export async function saveAISettings({ provider, model, baseUrl, apiKey }) {
  update((s) => {
    if (PROVIDERS[provider]) s.ai.provider = provider
    const id = s.ai.provider
    s.ai.providers[id] = { ...(s.ai.providers[id] || {}), model: (model || '').trim(), baseUrl: (baseUrl || '').trim() }
    s.updatedAt.ai = Date.now()
  })
  if (apiKey !== undefined) await setSecret(`apiKey:${getState().ai.provider}`, apiKey.trim())
  // Mirror to the synced settings collection (keys only leave if the user opted in).
  const { ai } = getState()
  putRecord('settings', 'ai', { provider: ai.provider, providers: ai.providers })
  const keys = {}
  for (const id of Object.keys(PROVIDERS)) {
    const k = await getSecret(`apiKey:${id}`)
    if (k) keys[id] = k
  }
  putRecord('settings', 'ai-keys', keys)
}

/**
 * browser: { tabs(), activeId(), run(id, script), navigate(id, url), goBack(id),
 *            openTab(url) -> id, selectTab(id), isLoading(id) }
 */
export function createDriver(browser) {
  return {
    activeTabId: async () => browser.activeId(),
    listTabs: async () => browser.tabs().filter((t) => !t.private).map((t) => ({ id: t.id, title: t.title, url: t.url })),
    run: (id, script) => browser.run(id, script),
    navigate: async (id, url) => browser.navigate(id, url),
    goBack: async (id) => browser.goBack(id),
    openTab: async (url) => browser.openTab(url),
    selectTab: async (id) => browser.selectTab(id),
    waitForLoad: async (id, timeout = 10_000) => {
      const end = Date.now() + timeout
      await sleep(300)
      while (browser.isLoading(id) && Date.now() < end) await sleep(200)
      await sleep(400)
    },
    fetchText: async (url) => (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Bit Browser)' } })).text(),
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const session = {
  history: [],
  abort: null,
  confirms: new Map(),
  newChat() {
    this.stop()
    this.history = []
  },
  stop() {
    this.abort?.abort()
    for (const resolve of this.confirms.values()) resolve(false)
    this.confirms.clear()
  },
}

// ---------- spending cap + agent activity log ----------

const spendApi = () => ({
  check: () => capStatus(getState().spending || {}),
  add: (dollars) =>
    update((s) => {
      s.spending = s.spending || { capDay: 0, capMonth: 0, spent: {} }
      s.spending.spent = addSpend({ ...(s.spending.spent || {}) }, dollars)
    }),
})

/** Today's and this month's estimated AI spend, in dollars. */
export function spendingSummary() {
  const sp = getState().spending || {}
  const now = new Date()
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const spent = sp.spent || {}
  const month = Object.entries(spent).reduce((n, [k, v]) => (k.startsWith(day.slice(0, 7)) ? n + (Number(v) || 0) : n), 0)
  return { capDay: sp.capDay || 0, capMonth: sp.capMonth || 0, today: Number(spent[day]) || 0, month }
}

export function setSpendingCaps({ capDay, capMonth }) {
  update((s) => {
    s.spending = { ...(s.spending || { spent: {} }), capDay: Math.max(0, Number(capDay) || 0), capMonth: Math.max(0, Number(capMonth) || 0) }
  })
}

function addLog(entry) {
  update((s) => {
    const log = [...(s.agentLog || []), { id: String(Date.now()) + Math.random().toString(36).slice(2, 6), at: Date.now(), ...entry }]
    s.agentLog = log.length > LOG_LIMIT ? log.slice(-LOG_LIMIT) : log
  })
}

export function clearAgentLog() {
  update((s) => (s.agentLog = []))
}

/** The AI slider. Off stops anything running and blocks every AI call. */
export function setAIEnabled(on) {
  if (!on) session.stop()
  update((s) => (s.aiEnabled = !!on))
}

/** Run one question. onEvent receives the same events as desktop. */
export async function ask({ browser, input, mode, tabIds, search = false, includePage = true, video = false, onEvent }) {
  if (!getState().aiEnabled) return onEvent({ type: 'error', message: 'AI is off. Turn on the AI slider to use Bitter.' })
  if (session.abort) session.stop()
  const provider = await currentProvider()
  onEvent({ type: 'user', text: input, mode })
  const problem = providerProblem(provider)
  if (problem) return onEvent({ type: 'error', message: problem, openSettings: true })
  // Each Space has its own chat (and its own memory).
  const space = getState().activeSpace || 'personal'
  if (session.space !== space) {
    session.history = []
    session.space = space
  }
  if (historySize(session.history) > MAX_HISTORY_CHARS) {
    session.history = []
    onEvent({ type: 'notice', text: 'This chat got very long, so I started a fresh one.' })
  }
  const controller = new AbortController()
  const runId = String(Date.now())
  session.abort = controller
  onEvent({ type: 'busy', busy: true })
  try {
    const { history } = await runAssistant({
      provider,
      driver: createDriver(browser),
      history: session.history,
      input,
      mode,
      tabIds,
      search,
      includePage,
      video,
      spend: spendApi(),
      memory: {
        enabled: getState().memoryEnabled,
        items: memory.items(),
        add: async (f) => memory.add(f),
        remove: async (f) => memory.remove(f),
      },
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === 'log') addLog({ kind: e.kind, text: e.text, site: e.site, runId })
        onEvent(e)
      },
      confirm: (req) =>
        new Promise((resolve) => {
          const id = String(Math.random()).slice(2)
          session.confirms.set(id, resolve)
          onEvent({ type: 'confirm', id, kind: req.kind, reason: req.reason, url: req.url })
        }),
    })
    session.history = history
  } catch (err) {
    if (err.history) session.history = err.history
    const msg = String(err?.message || err)
    onEvent({ type: 'error', message: /401|invalid.*key/i.test(msg) ? `${provider.label} rejected the API key. Check it in Settings.` : msg.slice(0, 400) })
  } finally {
    if (session.abort === controller) session.abort = null
    onEvent({ type: 'busy', busy: false })
  }
}

export function answerConfirm(id, ok) {
  const resolve = session.confirms.get(id)
  if (resolve) {
    session.confirms.delete(id)
    resolve(!!ok)
  }
}
