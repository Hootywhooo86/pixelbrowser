// Bookmarks: synced records in the 'bookmarks' collection.
// data: { url, title, folder, createdAt }

import * as Crypto from 'expo-crypto'
import { putRecord, liveRecords, useStore } from './store'

const DEFAULT_FOLDER = 'Bookmarks'

const all = () => liveRecords('bookmarks').filter((r) => r.data?.url)

const sortBookmarks = (list) =>
  list.sort((a, b) => a.folder.localeCompare(b.folder) || (a.title || a.url).localeCompare(b.title || b.url))

const asItem = (r) => ({ id: r.id, ...r.data, folder: r.data.folder || DEFAULT_FOLDER })

/** id of the bookmark for this url, or null. */
export function isBookmarked(url) {
  return all().find((r) => r.data.url === url)?.id || null
}

/** Add (or update) the bookmark for a url. Returns its id. */
export function addBookmark({ url, title, folder = DEFAULT_FOLDER }) {
  if (!/^https?:/i.test(url || '')) return null
  const existing = all().find((r) => r.data.url === url)
  const id = existing?.id || Crypto.randomUUID()
  putRecord('bookmarks', id, {
    url,
    title: String(title || url).slice(0, 300),
    folder: String(folder || DEFAULT_FOLDER).slice(0, 60),
    createdAt: existing?.data.createdAt || Date.now(),
  })
  return id
}

export function removeBookmark(id) {
  putRecord('bookmarks', id, null, { deleted: true })
}

function patch(id, change) {
  const r = all().find((x) => x.id === id)
  if (r) putRecord('bookmarks', id, { ...r.data, ...change })
}

export const moveBookmark = (id, folder) => patch(id, { folder: String(folder || DEFAULT_FOLDER).trim().slice(0, 60) || DEFAULT_FOLDER })
export const renameBookmark = (id, title) => patch(id, { title: String(title || '').trim().slice(0, 300) })

/** Folder names in use, 'Bookmarks' first. */
export function folders() {
  const names = new Set([DEFAULT_FOLDER, ...all().map((r) => r.data.folder || DEFAULT_FOLDER)])
  return [...names].sort((a, b) => (a === DEFAULT_FOLDER ? -1 : b === DEFAULT_FOLDER ? 1 : a.localeCompare(b)))
}

/** React hook: bookmarks sorted by folder, then title. */
export function useBookmarks() {
  useStore((s) => s.records.bookmarks)
  return sortBookmarks(all().map(asItem))
}
