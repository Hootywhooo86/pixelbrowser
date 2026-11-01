// 0.5 synced lists: notes, packages (tracking numbers), read later, and
// watchers (scheduled Bitter tasks and price tracking). Each is a records
// collection with the same shape as the phone app's, so they sync both ways.
// Read-later articles are also kept on this computer (not synced) so they
// can be read offline.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const store = require('./store')

const listeners = new Set()
const onChange = (fn) => listeners.add(fn)
function changed(kind) {
  for (const fn of listeners) fn(kind)
}

const live = (c) => store.liveRecords(c).filter((r) => r.data && typeof r.data === 'object')
const newest = (key) => (a, b) => (b[key] || 0) - (a[key] || 0)

// ---------- notes ----------
// data { text, url, title, space, createdAt, updatedAt }

const notes = {
  list(space) {
    return live('notes')
      .map((r) => ({ id: r.id, ...r.data }))
      .filter((n) => !space || (n.space || 'personal') === space)
      .sort(newest('updatedAt'))
  },
  add({ text, url = '', title = '', space = 'personal' }) {
    const clean = String(text || '').trim().slice(0, 20000)
    if (!clean && !url) return null
    const id = crypto.randomUUID()
    const now = Date.now()
    store.putRecord('notes', id, { text: clean, url: String(url).slice(0, 2000), title: String(title).slice(0, 300), space, createdAt: now, updatedAt: now })
    changed('notes')
    return id
  },
  update(id, patch = {}) {
    const r = store.records.data.notes[id]
    if (!r || r.deleted) return
    const next = { ...r.data, updatedAt: Date.now() }
    if (typeof patch.text === 'string') next.text = patch.text.slice(0, 20000)
    if (typeof patch.space === 'string') next.space = patch.space
    store.putRecord('notes', id, next)
    changed('notes')
  },
  remove(id) {
    if (!store.records.data.notes[id]) return
    store.putRecord('notes', id, null, { deleted: true })
    changed('notes')
  },
}

// ---------- packages ----------
// data { carrier, carrierName, number, url, label, source, addedAt, delivered }

const packages = {
  list() {
    return live('packages').map((r) => ({ id: r.id, ...r.data })).sort(newest('addedAt'))
  },
  has(number) {
    return live('packages').some((r) => r.data.number === number)
  },
  add({ carrier, carrierName, number, url, label = '', source = '' }) {
    const n = String(number || '').replace(/\s/g, '').toUpperCase()
    if (!n) return null
    const existing = live('packages').find((r) => r.data.number === n)
    if (existing) return existing.id
    const id = crypto.createHash('sha256').update(n).digest('hex').slice(0, 20)
    store.putRecord('packages', id, { carrier, carrierName, number: n, url, label: String(label).slice(0, 120), source: String(source).slice(0, 500), addedAt: Date.now(), delivered: false })
    changed('packages')
    return id
  },
  update(id, patch = {}) {
    const r = store.records.data.packages[id]
    if (!r || r.deleted) return
    const next = { ...r.data }
    if (typeof patch.label === 'string') next.label = patch.label.slice(0, 120)
    if (typeof patch.delivered === 'boolean') next.delivered = patch.delivered
    store.putRecord('packages', id, next)
    changed('packages')
  },
  remove(id) {
    if (!store.records.data.packages[id]) return
    store.putRecord('packages', id, null, { deleted: true })
    changed('packages')
  },
}

// ---------- read later ----------
// data { url, title, savedAt, read, words }; the article itself in userData/readlater/<id>.json

const articleDir = () => path.join(app.getPath('userData'), 'readlater')
const articleFile = (id) => path.join(articleDir(), `${String(id).replace(/[^a-z0-9-]/gi, '')}.json`)

const readLater = {
  list() {
    return live('readlater')
      .map((r) => ({ id: r.id, ...r.data, offline: fs.existsSync(articleFile(r.id)) }))
      .sort(newest('savedAt'))
  },
  has(url) {
    return live('readlater').some((r) => r.data.url === url)
  },
  add({ url, title, article = null }) {
    if (!/^https?:/.test(url || '')) return null
    const existing = live('readlater').find((r) => r.data.url === url)
    const id = existing?.id || crypto.createHash('sha256').update(url).digest('hex').slice(0, 20)
    if (article) {
      fs.mkdirSync(articleDir(), { recursive: true })
      fs.writeFileSync(articleFile(id), JSON.stringify({ ...article, url }))
    }
    store.putRecord('readlater', id, { url, title: String(title || article?.title || url).slice(0, 300), savedAt: existing?.data.savedAt || Date.now(), read: false, words: article?.words || 0 })
    changed('readlater')
    return id
  },
  article(id) {
    try {
      return JSON.parse(fs.readFileSync(articleFile(id), 'utf8'))
    } catch {
      return null
    }
  },
  markRead(id, read = true) {
    const r = store.records.data.readlater[id]
    if (!r || r.deleted) return false
    const was = r.data.read
    store.putRecord('readlater', id, { ...r.data, read: !!read })
    changed('readlater')
    return !was && read
  },
  remove(id) {
    if (!store.records.data.readlater[id]) return
    store.putRecord('readlater', id, null, { deleted: true })
    fs.rmSync(articleFile(id), { force: true })
    changed('readlater')
  },
}

// ---------- watchers ----------
// data { kind: 'changes'|'price', url, title, prompt, everyHours, createdAt,
//        lastRun, lastHash, lastText, lastPrice, currency, lastChange, history: [{at, price}] }

const watchers = {
  list() {
    return live('watchers').map((r) => ({ id: r.id, ...r.data })).sort(newest('createdAt'))
  },
  get(id) {
    const r = store.records.data.watchers[id]
    return r && !r.deleted ? { id, ...r.data } : null
  },
  add({ kind = 'changes', url, title = '', prompt = '', everyHours = 24 }) {
    if (!/^https?:/.test(url || '')) return null
    const id = crypto.randomUUID()
    store.putRecord('watchers', id, { kind, url, title: String(title || url).slice(0, 200), prompt: String(prompt).slice(0, 1000), everyHours: Math.max(0.5, Number(everyHours) || 24), createdAt: Date.now(), lastRun: 0 })
    changed('watchers')
    return id
  },
  patch(id, patch) {
    const cur = this.get(id)
    if (!cur) return
    const { id: _id, ...data } = { ...cur, ...patch }
    store.putRecord('watchers', id, data)
    changed('watchers')
  },
  remove(id) {
    if (!store.records.data.watchers[id]) return
    store.putRecord('watchers', id, null, { deleted: true })
    changed('watchers')
  },
}

module.exports = { notes, packages, readLater, watchers, onChange }
