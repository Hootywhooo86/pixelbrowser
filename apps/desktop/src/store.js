// Local storage for the desktop app. Everything lives in the user's profile
// folder. Secrets (API keys, the sync code) are encrypted with the OS
// keychain through Electron's safeStorage.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { app, safeStorage } = require('electron')

function dir() {
  return app.getPath('userData')
}

class JsonFile {
  constructor(name, defaults) {
    this.file = path.join(dir(), name)
    this.timer = null
    try {
      this.data = { ...defaults, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }
    } catch {
      this.data = structuredClone(defaults)
    }
  }

  save() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }

  flush() {
    clearTimeout(this.timer)
    const tmp = `${this.file}.tmp`
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(this.data))
    fs.renameSync(tmp, this.file)
  }
}

const settings = new JsonFile('pixel-settings.json', {
  deviceId: crypto.randomUUID(),
  deviceName: `${process.platform === 'darwin' ? 'Mac' : process.platform === 'win32' ? 'Windows PC' : 'Linux PC'}`,
  ai: { provider: 'anthropic', providers: {} }, // providers[id] = { model, baseUrl }
  memoryEnabled: true,
  aiEnabled: true, // the AI slider; off = nothing is sent to any AI (per device, never synced)
  searchEngine: 'duckduckgo',
  autoUpdate: true,
  customSearchUrl: '',
  sync: { server: '', cursor: 0, lastPushedAt: 0, lastSyncAt: 0, syncKeys: false },
  updatedAt: { ai: 0 },
  // v0.3
  shields: {
    enabled: true,
    lists: { easylist: true, easyprivacy: true, ublock: true, ublockQuick: true, peterlowe: true, annoyances: false, cookies: false },
    regional: [], // extra regional list ids (see shields.js)
    siteOff: {}, // host -> true when Shields are down for that site (synced)
    totals: { ads: 0, trackers: 0 },
    lastUpdate: 0,
    updatedAt: 0,
  },
  autoplay: 'muted', // 'off' | 'muted' | 'on' (applies after a restart)
  theme: { id: 'bit', custom: null, skin: 'classic', updatedAt: 0 },
  sounds: false, // retro sound effects, off by default
  privacy: { doh: 'automatic', dohCustom: '', panicRange: '1h' },
  privateLock: { enabled: false, pin: '', minutes: 5 }, // pin = salted hash
  phishing: { enabled: true, lastUpdate: 0 },
  spaces: {
    list: [
      { id: 'personal', name: 'Personal' },
      { id: 'work', name: 'Work' },
      { id: '128bit', name: '128bit' },
    ],
    updatedAt: 0,
  },
  xp: { counters: { blocked: 0, tabsCleaned: 0, streakDays: 0 }, lastDay: '', streak: 0, updatedAt: 0 },
  familyLinks: { bitcaller: true, tracker: true },
})
settings.save()

// Synced collections, stored as { [id]: { id, updatedAt, deviceId, deleted?, data } }
const records = new JsonFile('pixel-records.json', { memory: {}, history: {}, tabs: {}, settings: {} })

const secretsFile = new JsonFile('pixel-secrets.json', {})

const secrets = {
  get(name) {
    const value = secretsFile.data[name]
    if (!value) return ''
    try {
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value, 'base64')) : Buffer.from(value, 'base64').toString('utf8')
    } catch {
      return ''
    }
  },
  set(name, plain) {
    if (!plain) delete secretsFile.data[name]
    else {
      const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain) : Buffer.from(plain, 'utf8')
      secretsFile.data[name] = buf.toString('base64')
    }
    secretsFile.flush()
  },
  has(name) {
    return !!secretsFile.data[name]
  },
}

const changeListeners = new Set()

/** Called after this device changes a synced record (sync uploads it soon). */
function onLocalChange(fn) {
  changeListeners.add(fn)
}

/** Write a record this device changed. */
function putRecord(collection, id, data, { deleted = false } = {}) {
  records.data[collection][id] = { id, updatedAt: Date.now(), deviceId: settings.data.deviceId, deleted, data: deleted ? null : data }
  records.save()
  for (const fn of changeListeners) fn(collection)
}

function liveRecords(collection) {
  return Object.values(records.data[collection] || {}).filter((r) => !r.deleted)
}

// ---------- memory (what the assistant remembers) ----------

// Kept per Space. Record data stays a plain string (older versions read
// it); the Space is in the id: '<space>:<uuid>', or a bare uuid = Personal.
const memSpace = (r) => (String(r.id).includes(':') ? String(r.id).split(':')[0] : 'personal')
const activeSpace = () => settings.data.activeSpace || 'personal'

function memoryFor(space) {
  const mine = () => liveRecords('memory').filter((r) => typeof r.data === 'string' && memSpace(r) === (space || activeSpace()))
  return {
    items() {
      return mine().sort((a, b) => a.updatedAt - b.updatedAt).map((r) => r.data)
    },
    add(text) {
      const clean = String(text || '').trim().slice(0, 500)
      if (!clean || this.items().includes(clean)) return
      const sp = space || activeSpace()
      putRecord('memory', sp === 'personal' ? crypto.randomUUID() : `${sp}:${crypto.randomUUID()}`, clean)
    },
    remove(text) {
      const hit = mine().find((r) => r.data === text)
      if (!hit) return false
      putRecord('memory', hit.id, null, { deleted: true })
      return true
    },
  }
}

// The active Space's memory; forSpace(id) for a specific one.
const memory = {
  items: () => memoryFor().items(),
  add: (text) => memoryFor().add(text),
  remove: (text) => memoryFor().remove(text),
  forSpace: (space) => memoryFor(space),
}

// ---------- browsing history ----------

const HISTORY_LIMIT = 3000

const history = {
  add(url, title) {
    if (!/^https?:/.test(url)) return
    const id = crypto.createHash('sha256').update(url).digest('hex').slice(0, 24)
    putRecord('history', id, { url, title: title || url, visitedAt: Date.now() })
    const all = Object.values(records.data.history)
    if (all.length > HISTORY_LIMIT * 1.2) {
      all.sort((a, b) => b.updatedAt - a.updatedAt)
      records.data.history = Object.fromEntries(all.slice(0, HISTORY_LIMIT).map((r) => [r.id, r]))
    }
  },
  recent(limit = 50) {
    return liveRecords('history').sort((a, b) => b.data.visitedAt - a.data.visitedAt).slice(0, limit).map((r) => r.data)
  },
}

module.exports = { settings, records, secrets, putRecord, liveRecords, onLocalChange, memory, history }
