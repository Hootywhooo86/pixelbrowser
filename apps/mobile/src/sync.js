// Phone side of end-to-end encrypted sync. Same protocol and merge as
// desktop (both use syncOnce from @pixelbrowser/sync-core).

import { SyncClient, createSyncCode, isValidSyncCode, normalizeSyncCode, syncOnce } from '@pixelbrowser/sync-core'
import { PROVIDERS } from '@pixelbrowser/ai-core'
import { getState, update, getSecret, setSecret, onLocalChange, liveRecords } from './store'
import { applyRemoteShields } from './shields'

let running = null
let debounce = null
let timer = null

async function client() {
  const s = getState()
  return new SyncClient({ server: s.sync.server, code: await getSecret('syncCode'), deviceId: s.deviceId })
}

export async function createChain(server) {
  const code = createSyncCode()
  await setSecret('syncCode', code)
  update((s) => Object.assign(s.sync, { server: server.trim(), enabled: true, cursor: 0, lastPushedAt: 0, error: '' }))
  await syncNow()
  return code
}

export async function joinChain(server, code) {
  if (!isValidSyncCode(code)) throw new Error('That sync code is not valid. Check the 24 words.')
  await setSecret('syncCode', normalizeSyncCode(code))
  update((s) => Object.assign(s.sync, { server: server.trim(), enabled: true, cursor: 0, lastPushedAt: 0, error: '' }))
  await syncNow()
}

export async function leaveChain({ wipe = false } = {}) {
  if (wipe) await (await client()).wipe().catch(() => {})
  await setSecret('syncCode', '')
  update((s) => Object.assign(s.sync, { enabled: false, cursor: 0, lastPushedAt: 0 }))
}

export function showCode() {
  return getSecret('syncCode')
}

export function syncNow() {
  const s = getState()
  if (!s.sync.enabled || !s.sync.server) return Promise.resolve()
  if (running) return running
  running = (async () => {
    try {
      const data = structuredCloneSafe(s.records)
      const result = await syncOnce({
        client: await client(),
        data,
        deviceId: s.deviceId,
        cursor: s.sync.cursor,
        lastPushedAt: s.sync.lastPushedAt,
        skip: (collection, r) => collection === 'settings' && r.id === 'ai-keys' && !s.sync.syncKeys,
      })
      update((st) => {
        // Keep anything this device wrote during the round.
        for (const [collection, recs] of Object.entries(data)) {
          for (const [id, r] of Object.entries(recs)) {
            const mine = st.records[collection][id]
            if (!mine || mine.updatedAt <= r.updatedAt) st.records[collection][id] = r
          }
        }
        Object.assign(st.sync, { cursor: result.cursor, lastPushedAt: result.lastPushedAt, lastSyncAt: Date.now(), error: '' })
      })
      if (result.changed.includes('settings')) await applyRemoteSettings()
    } catch (err) {
      update((st) => (st.sync.error = err.message))
    } finally {
      running = null
    }
  })()
  return running
}

function structuredCloneSafe(v) {
  return JSON.parse(JSON.stringify(v))
}

async function applyRemoteSettings() {
  const s = getState()
  const rec = s.records.settings.ai
  if (rec && !rec.deleted && rec.deviceId !== s.deviceId && rec.updatedAt > s.updatedAt.ai) {
    update((st) => {
      st.ai = { provider: rec.data.provider, providers: rec.data.providers || {} }
      st.updatedAt.ai = rec.updatedAt
    })
  }
  const search = s.records.settings.search
  if (search && !search.deleted && search.deviceId !== s.deviceId && search.updatedAt > (s.updatedAt.search || 0)) {
    update((st) => {
      st.searchEngine = search.data.engine
      st.customSearchUrl = search.data.customUrl || ''
      st.updatedAt.search = search.updatedAt
    })
  }
  await applyRemoteShields().catch(() => {})
  const keys = s.records.settings['ai-keys']
  if (keys && !keys.deleted && keys.deviceId !== s.deviceId && s.sync.syncKeys) {
    for (const [id, k] of Object.entries(keys.data || {})) if (PROVIDERS[id] && k) await setSecret(`apiKey:${id}`, k)
  }
}

export function startSync() {
  onLocalChange(() => {
    clearTimeout(debounce)
    debounce = setTimeout(() => syncNow(), 5000)
  })
  clearInterval(timer)
  timer = setInterval(() => syncNow(), 2 * 60 * 1000)
  syncNow()
}

export function remoteTabs() {
  const me = getState().deviceId
  return liveRecords('tabs')
    .filter((r) => r.id !== me)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((r) => ({ deviceName: r.data.deviceName, tabs: r.data.tabs || [] }))
}
