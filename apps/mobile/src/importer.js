// Import bookmarks and passwords exported from Chrome, Brave, Edge, Firefox,
// Safari, Bitwarden, 1Password or LastPass. Nothing leaves the phone.

import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { parseBookmarksHtml, parseChromeBookmarksJson, parsePasswordsCsv } from '@pixelbrowser/tools-core'
import { addBookmark, isBookmarked } from './bookmarks'
import { saveLogin, hasLogin } from './passwords'

const pause = () => new Promise((r) => setTimeout(r, 0))

/** Let the user pick an export file. Returns { name, text } or null if cancelled. */
export async function pickImportFile() {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false })
  if (res.canceled || !res.assets?.length) return null
  const file = res.assets[0]
  if (file.size && file.size > 30 * 1024 * 1024) throw new Error('That file is too big to be a bookmarks or passwords export.')
  const text = await FileSystem.readAsStringAsync(file.uri)
  FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => {}) // the cache copy may hold passwords
  return { name: file.name || '', text }
}

/**
 * Work out what's in a file.
 * → { kind: 'bookmarks', items } | { kind: 'passwords', items, skipped, format } | { kind: 'unknown' }
 */
export function readImport(text, name = '') {
  const head = String(text || '').slice(0, 2000)
  if (/NETSCAPE-Bookmark-file|<DT>\s*<A\s/i.test(head) || /\.html?$/i.test(name)) {
    const items = parseBookmarksHtml(text)
    if (items.length) return { kind: 'bookmarks', items }
  }
  if (/^\s*\{/.test(head) && /"roots"/.test(text)) {
    try {
      const items = parseChromeBookmarksJson(text)
      if (items.length) return { kind: 'bookmarks', items }
    } catch {}
  }
  const pw = parsePasswordsCsv(text)
  if (pw.logins.length) return { kind: 'passwords', items: pw.logins, skipped: pw.skipped, format: pw.format }
  return { kind: 'unknown' }
}

/** Add bookmarks, keeping their folders. Skips ones you already have. → { added, skipped } */
export async function importBookmarks(items, onProgress) {
  let added = 0
  let skipped = 0
  for (let i = 0; i < items.length; i++) {
    const b = items[i]
    if (isBookmarked(b.url)) skipped++
    else if (addBookmark({ url: b.url, title: b.title, folder: b.folder })) added++
    else skipped++
    if (i % 25 === 24) {
      onProgress?.(i + 1, items.length)
      await pause()
    }
  }
  onProgress?.(items.length, items.length)
  return { added, skipped }
}

/** Save logins into Bit Password Manager (encrypted on this phone). → { added, skipped } */
export async function importPasswords(items, onProgress) {
  let added = 0
  let skipped = 0
  for (let i = 0; i < items.length; i++) {
    const l = items[i]
    try {
      if (await hasLogin({ url: l.url, username: l.username, password: l.password })) skipped++
      else if (await saveLogin({ url: l.url, username: l.username, password: l.password })) added++
      else skipped++
    } catch {
      skipped++
    }
    if (i % 10 === 9) onProgress?.(i + 1, items.length)
  }
  onProgress?.(items.length, items.length)
  return { added, skipped }
}

/** How to get an export file out of each browser. */
export const EXPORT_HELP = [
  {
    title: 'Chrome, Brave or Edge on a computer',
    steps: [
      'Bookmarks: open the bookmarks manager (Ctrl+Shift+O), click ⋮ → Export bookmarks. You get an .html file.',
      'Passwords: Settings → Autofill / Passwords → Password Manager → Settings → Export passwords. You get a .csv file.',
      'Send the files to your phone (email to yourself, Google Drive, or a USB cable), then pick them here.',
    ],
  },
  {
    title: 'Chrome on Android',
    steps: [
      'Passwords: Chrome → ⋮ → Settings → Password Manager → ⚙ Settings → Export passwords. Save the .csv, then pick it here.',
      "Bookmarks: Chrome on Android can't export them. Sign in to Chrome on a computer with the same Google account and export from there.",
    ],
  },
  {
    title: 'Firefox, Bitwarden, 1Password, LastPass',
    steps: ['Use their "Export" option and choose CSV (passwords) or HTML (bookmarks).'],
  },
  {
    title: 'Keep it safe',
    steps: ['A passwords .csv file isn\'t encrypted. Delete it from your Downloads and Drive after importing.'],
  },
]
