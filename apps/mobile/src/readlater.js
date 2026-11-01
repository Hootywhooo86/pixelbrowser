// Reading list: pages saved to read later. The list (url, title, read/unread)
// syncs as records in the 'readlater' collection; the reader-mode article
// itself is kept on this device (documentDirectory/readlater/<id>.json) so it
// opens offline without filling the sync store.
// data: { url, title, siteName, addedAt, readAt, hasArticle }

import * as Crypto from 'expo-crypto'
import * as FileSystem from 'expo-file-system/legacy'
import { putRecord, liveRecords, useStore } from './store'
import { track } from './quests'
import { award } from './xp'

const DIR = `${FileSystem.documentDirectory}readlater/`
const fileFor = (id) => `${DIR}${id}.json`

const all = () => liveRecords('readlater').filter((r) => r.data?.url)
const asItem = (r) => ({ id: r.id, ...r.data })

export function isSaved(url) {
  return all().find((r) => r.data.url === url)?.id || null
}

/** Save a page for later. Pass the reader-mode article (from READER_JS) to keep it for offline reading. */
export async function saveForLater({ url, title, article } = {}) {
  if (!/^https?:/i.test(url || '')) return null
  const existing = all().find((r) => r.data.url === url)
  const id = existing?.id || Crypto.randomUUID()
  let hasArticle = !!existing?.data.hasArticle
  if (article?.html) {
    try {
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
      await FileSystem.writeAsStringAsync(fileFor(id), JSON.stringify(article))
      hasArticle = true
    } catch {}
  }
  putRecord('readlater', id, {
    url,
    title: String(title || article?.title || url).slice(0, 300),
    siteName: String(article?.siteName || '').slice(0, 80),
    addedAt: existing?.data.addedAt || Date.now(),
    readAt: 0,
    hasArticle,
  })
  return id
}

/** The saved article for offline reading, or null (saved on another device, or not readable). */
export async function savedArticle(id) {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(fileFor(id)))
  } catch {
    return null
  }
}

export function markRead(id, read = true) {
  const r = all().find((x) => x.id === id)
  if (!r) return
  const wasRead = !!r.data.readAt
  putRecord('readlater', id, { ...r.data, readAt: read ? Date.now() : 0 })
  if (read && !wasRead) {
    track('articleRead')
    award('articleFinished')
  }
}

export async function removeFromList(id) {
  putRecord('readlater', id, null, { deleted: true })
  await FileSystem.deleteAsync(fileFor(id), { idempotent: true }).catch(() => {})
}

/** React hook: unread first (newest saved first), then read. */
export function useReadingList() {
  useStore((s) => s.records.readlater)
  return all()
    .map(asItem)
    .sort((a, b) => (!!a.readAt - !!b.readAt) || b.addedAt - a.addedAt)
}
