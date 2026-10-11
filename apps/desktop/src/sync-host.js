// Desktop side of end-to-end encrypted sync: memory, history, open tabs and
// AI settings travel between your devices; the server only sees ciphertext.

const QRCode = require('qrcode')
const { SyncClient, createSyncCode, isValidSyncCode, syncOnce, syncQrPayload } = require('@pixelbrowser/sync-core')
const store = require('./store')

const AUTO_SYNC_MS = 2 * 60 * 1000
let timer = null
let debounce = null
let running = null
let lastError = ''
let listeners = new Set()

function cfg() {
  return store.settings.data.sync
}

function code() {
  return store.secrets.get('syncCode')
}

function status() {
  return {
    enabled: !!code(),
    server: cfg().server,
    lastSyncAt: cfg().lastSyncAt,
    syncKeys: !!cfg().syncKeys,
    error: lastError,
    deviceName: store.settings.data.deviceName,
  }
}

function onChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify(changedCollections = []) {
  for (const fn of listeners) fn({ status: status(), changed: changedCollections })
}

function client() {
  return new SyncClient({ server: cfg().server, code: code(), deviceId: store.settings.data.deviceId })
}

async function qrFor(c) {
  return QRCode.toDataURL(syncQrPayload(c, cfg().server), { margin: 1, scale: 6, color: { dark: '#0b0b16', light: '#f4f1ff' } })
}

async function create(server) {
  cfg().server = server.trim()
  const c = createSyncCode()
  store.secrets.set('syncCode', c)
  cfg().cursor = 0
  cfg().lastPushedAt = 0
  store.settings.save()
  await syncNow()
  return { code: c, qr: await qrFor(c) }
}

async function join(server, c) {
  if (!isValidSyncCode(c)) throw new Error('That sync code is not valid. Check the 24 words.')
  cfg().server = server.trim()
  store.secrets.set('syncCode', c.trim().toLowerCase().replace(/\s+/g, ' '))
  cfg().cursor = 0
  cfg().lastPushedAt = 0
  store.settings.save()
  await syncNow()
  return status()
}

async function showCode() {
  const c = code()
  if (!c) return null
  return { code: c, qr: await qrFor(c) }
}

async function leave({ wipe = false } = {}) {
  if (wipe && code()) await client().wipe().catch(() => {})
  store.secrets.set('syncCode', '')
  cfg().cursor = 0
  cfg().lastPushedAt = 0
  store.settings.save()
  notify()
}

/** Called by the app whenever local data changes. */
function schedule() {
  if (!code()) return
  clearTimeout(debounce)
  debounce = setTimeout(() => syncNow().catch(() => {}), 5000)
}

function syncNow() {
  if (!code() || !cfg().server) return Promise.resolve(status())
  if (running) return running
  running = (async () => {
    try {
      const result = await syncOnce({
        client: client(),
        data: store.records.data,
        deviceId: store.settings.data.deviceId,
        cursor: cfg().cursor,
        lastPushedAt: cfg().lastPushedAt,
        skip: (collection, r) => collection === 'settings' && r.id === 'ai-keys' && !cfg().syncKeys,
      })
      cfg().cursor = result.cursor
      cfg().lastPushedAt = result.lastPushedAt
      cfg().lastSyncAt = Date.now()
      lastError = ''
      store.records.save()
      store.settings.save()
      notify(result.changed)
    } catch (err) {
      lastError = err.message
      notify()
    } finally {
      running = null
    }
    return status()
  })()
  return running
}

function start() {
  clearInterval(timer)
  timer = setInterval(() => syncNow().catch(() => {}), AUTO_SYNC_MS)
  syncNow().catch(() => {})
}

/** Tabs open on other devices, newest first. */
function remoteTabs() {
  const me = store.settings.data.deviceId
  return store
    .liveRecords('tabs')
    .filter((r) => r.id !== me)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((r) => ({ deviceName: r.data.deviceName, updatedAt: r.updatedAt, tabs: r.data.tabs }))
}

module.exports = { status, create, join, showCode, leave, schedule, syncNow, start, onChange, remoteTabs }
