// Bookmarks: synced records in the 'bookmarks' collection, same shape as the
// phone app: data { url, title, folder, createdAt }. The 'Bookmarks' folder
// is what shows on the bookmarks bar; other folders show as folder buttons.

const crypto = require('node:crypto')
const store = require('./store')

const DEFAULT_FOLDER = 'Bookmarks'
const listeners = new Set()

const all = () => store.liveRecords('bookmarks').filter((r) => r.data?.url)
const asItem = (r) => ({ id: r.id, ...r.data, folder: r.data.folder || DEFAULT_FOLDER })

function changed() {
  for (const fn of listeners) fn()
}

function list() {
  return all()
    .map(asItem)
    .sort((a, b) => a.folder.localeCompare(b.folder) || (a.createdAt || 0) - (b.createdAt || 0))
}

/** id of the bookmark for this url, or null. */
function find(url) {
  return all().find((r) => r.data.url === url)?.id || null
}

/** Add (or update) the bookmark for a url. Returns its id. */
function add({ url, title, folder = DEFAULT_FOLDER }) {
  if (!/^https?:/i.test(url || '')) return null
  const existing = all().find((r) => r.data.url === url)
  const id = existing?.id || crypto.randomUUID()
  store.putRecord('bookmarks', id, {
    url,
    title: String(title || url).slice(0, 300),
    folder: String(folder || DEFAULT_FOLDER).slice(0, 60),
    createdAt: existing?.data.createdAt || Date.now(),
  })
  changed()
  return id
}

function remove(id) {
  if (!store.records.data.bookmarks[id]) return
  store.putRecord('bookmarks', id, null, { deleted: true })
  changed()
}

function update(id, patch = {}) {
  const r = all().find((x) => x.id === id)
  if (!r) return
  const next = { ...r.data }
  if (typeof patch.title === 'string') next.title = patch.title.trim().slice(0, 300) || r.data.url
  if (typeof patch.folder === 'string') next.folder = patch.folder.trim().slice(0, 60) || DEFAULT_FOLDER
  if (typeof patch.url === 'string' && /^https?:/i.test(patch.url.trim())) next.url = patch.url.trim()
  store.putRecord('bookmarks', id, next)
  changed()
}

/** Folder names: 'Bookmarks' first, then folders with bookmarks or made empty in the manager. */
function folders() {
  const names = new Set([DEFAULT_FOLDER, ...(store.settings.data.bookmarkFolders || []), ...all().map((r) => r.data.folder || DEFAULT_FOLDER)])
  return [...names].sort((a, b) => (a === DEFAULT_FOLDER ? -1 : b === DEFAULT_FOLDER ? 1 : a.localeCompare(b)))
}

function addFolder(name) {
  const clean = String(name || '').trim().slice(0, 60)
  if (!clean || folders().includes(clean)) return
  store.settings.data.bookmarkFolders = [...(store.settings.data.bookmarkFolders || []), clean]
  store.settings.save()
  changed()
}

/** Delete a folder: its bookmarks move to 'Bookmarks'. */
function removeFolder(name) {
  if (name === DEFAULT_FOLDER) return
  for (const r of all()) if ((r.data.folder || DEFAULT_FOLDER) === name) store.putRecord('bookmarks', r.id, { ...r.data, folder: DEFAULT_FOLDER })
  store.settings.data.bookmarkFolders = (store.settings.data.bookmarkFolders || []).filter((f) => f !== name)
  store.settings.save()
  changed()
}

function renameFolder(from, to) {
  const clean = String(to || '').trim().slice(0, 60)
  if (!clean || from === DEFAULT_FOLDER || clean === from) return
  for (const r of all()) if ((r.data.folder || DEFAULT_FOLDER) === from) store.putRecord('bookmarks', r.id, { ...r.data, folder: clean })
  store.settings.data.bookmarkFolders = [...new Set((store.settings.data.bookmarkFolders || []).map((f) => (f === from ? clean : f)))]
  store.settings.save()
  changed()
}

/** What the bookmarks bar shows: the 'Bookmarks' folder's items, then the other folders. */
function bar() {
  const items = list()
  return {
    items: items.filter((b) => b.folder === DEFAULT_FOLDER).slice(0, 60).map((b) => ({ id: b.id, title: b.title, url: b.url })),
    folders: folders().filter((f) => f !== DEFAULT_FOLDER),
  }
}

const onChange = (fn) => listeners.add(fn)

module.exports = { DEFAULT_FOLDER, list, find, add, remove, update, folders, addFolder, removeFolder, renameFolder, bar, onChange, changed }
