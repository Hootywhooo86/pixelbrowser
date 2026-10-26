// Downloads for the phone app. The web view can't save files by itself, so
// links that look like files are fetched here into the app's documents
// folder and listed in Settings → Downloads.

import { useSyncExternalStore } from 'react'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import * as Sharing from 'expo-sharing'

const KEY = 'pixel-downloads-v1'
const DIR = `${FileSystem.documentDirectory}downloads/`

const FILE_EXT = /\.(apk|aab|zip|pdf|exe|dmg|deb|appimage|mp3|mp4|mov|m4a|wav|docx?|xlsx?|pptx?|csv|7z|rar|tar|gz|tgz|bz2|xz|iso|msi|epub)$/i

const MIME = {
  apk: 'application/vnd.android.package-archive',
  aab: 'application/octet-stream',
  zip: 'application/zip',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  csv: 'text/csv',
  epub: 'application/epub+zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  gz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  tar: 'application/x-tar',
}

let items = []
let loaded = false
let version = 0
const listeners = new Set()
const tasks = new Map() // id -> DownloadResumable

function emit() {
  version += 1
  for (const l of listeners) l()
}

function persist() {
  AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {})
}

function patch(id, data) {
  items = items.map((d) => (d.id === id ? { ...d, ...data } : d))
  emit()
  if (data.status !== 'downloading' || data.progress === undefined) persist()
}

async function load() {
  if (loaded) return
  loaded = true
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(KEY)) || '[]')
    // A download that was running when the app closed can't be resumed.
    items = saved.map((d) => (d.status === 'downloading' ? { ...d, status: 'failed', error: 'Stopped when the app closed.' } : d))
  } catch {
    items = []
  }
  emit()
}
load()

const pathOf = (url) => {
  try {
    return new URL(url).pathname
  } catch {
    return String(url || '').split(/[?#]/)[0]
  }
}

const extOf = (name) => (/\.([A-Za-z0-9]+)$/.exec(name || '') || [])[1]?.toLowerCase() || ''

export function mimeFor(filename, fallback) {
  return MIME[extOf(filename)] || fallback || 'application/octet-stream'
}

/** True for links that should be saved as a file instead of opened as a page. */
export function looksLikeDownload(url) {
  if (!/^https?:/i.test(url || '')) return false
  const path = pathOf(url)
  if (/^\/[^/]+\/[^/]+\/releases\/download\//.test(path) && /(^|\.)github\.com$/i.test(hostOf(url))) return true
  if (/\.pdf$/i.test(path)) return Platform.OS === 'android' // iOS shows PDFs in the page
  return FILE_EXT.test(path)
}

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** A safe file name from a Content-Disposition header or the URL. */
export function guessFilename(url, contentDisposition) {
  let name = ''
  const cd = String(contentDisposition || '')
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd)
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd)
  try {
    if (star) name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
  } catch {}
  if (!name && plain) name = plain[1].trim()
  if (!name) {
    const last = pathOf(url).split('/').filter(Boolean).pop() || ''
    try {
      name = decodeURIComponent(last)
    } catch {
      name = last
    }
  }
  name = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 120)
  return name || 'download'
}

async function uniquePath(filename) {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
  const ext = extOf(filename)
  const base = ext ? filename.slice(0, -(ext.length + 1)) : filename
  for (let i = 0; i < 1000; i++) {
    const name = i ? `${base} (${i})${ext ? `.${ext}` : ''}` : filename
    const info = await FileSystem.getInfoAsync(DIR + encodeURIComponent(name))
    if (!info.exists) return { name, path: DIR + encodeURIComponent(name) }
  }
  return { name: filename, path: DIR + `${Date.now()}-${encodeURIComponent(filename)}` }
}

/** True for a PDF download item, a .pdf URL/file name, or the PDF MIME type. */
export function isPdf(x) {
  if (!x) return false
  if (typeof x === 'object') return /pdf/i.test(x.mimeType || '') || /\.pdf$/i.test(x.filename || '')
  return /^application\/pdf/i.test(x) || /\.pdf$/i.test(pathOf(x))
}

// "Open this PDF in the viewer": App.js listens and shows PdfViewer.
const pdfListeners = new Set()
export function onOpenPdf(fn) {
  pdfListeners.add(fn)
  return () => pdfListeners.delete(fn)
}
export function openPdf(item) {
  if (!item || item.status !== 'done') return
  if (pdfListeners.size) for (const fn of pdfListeners) fn(item)
  else openDownload(item).catch(() => {})
}

/** Download a file into the app; it appears in the Downloads list. */
export async function startDownload({ url, filename, mimeType, headers, cookie, referer, userAgent } = {}) {
  await load()
  const { name, path } = await uniquePath(filename || guessFilename(url))
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const item = { id, url, filename: name, size: 0, mimeType: mimeType || mimeFor(name), status: 'downloading', progress: 0, path, startedAt: Date.now(), error: '' }
  items = [item, ...items]
  emit()
  persist()

  let lastTick = 0
  // Send what the page would: its cookies (for signed-in files), where the
  // link was clicked and the browser's own user agent.
  const sendHeaders = { ...(headers || {}) }
  if (cookie) sendHeaders.Cookie = cookie
  if (referer) sendHeaders.Referer = referer
  if (userAgent) sendHeaders['User-Agent'] = userAgent
  const wantPdf = isPdf(name) || isPdf(mimeType || '')
  const task = FileSystem.createDownloadResumable(url, path, { headers: sendHeaders }, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
    const now = Date.now()
    if (now - lastTick < 250) return
    lastTick = now
    const total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : 0
    patch(id, { size: total || totalBytesWritten, progress: total ? totalBytesWritten / total : 0 })
  })
  tasks.set(id, task)
  try {
    const res = await task.downloadAsync()
    tasks.delete(id)
    if (!res) return items.find((d) => d.id === id) // cancelled
    if (res.status >= 400) throw new Error(`The server said ${res.status}.`)
    const info = await FileSystem.getInfoAsync(res.uri)
    const h = res.headers || {}
    const ctype = (h['Content-Type'] || h['content-type'] || '').split(';')[0].trim()
    // A sign-in page instead of the file: say so instead of saving junk.
    if (/^text\/html/i.test(ctype) && !/\.html?$/i.test(name)) throw new Error('The site sent a web page instead of the file. You may need to sign in; tap the download on the page again.')
    if (wantPdf || /pdf/i.test(ctype)) {
      const head = await FileSystem.readAsStringAsync(res.uri, { encoding: FileSystem.EncodingType.Base64, position: 0, length: 5 }).catch(() => '')
      if (head && !head.startsWith('JVBER')) throw new Error("The file isn't a real PDF. The link may have expired; open it from the site again.")
    }
    patch(id, {
      status: 'done',
      progress: 1,
      size: info.size || 0,
      mimeType: mimeType || (ctype && ctype !== 'application/octet-stream' ? ctype : mimeFor(name)),
    })
  } catch (e) {
    tasks.delete(id)
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {})
    patch(id, { status: 'failed', error: String(e?.message || e) })
  }
  return items.find((d) => d.id === id)
}

// ---------- files handed over by web pages (blob:, data:, signed-in links) ----------

const incoming = new Map() // id -> { item, parts: [], got }

/**
 * Take one { __bitFile } chunk from download-capture.js. When the last chunk
 * arrives the file is written and its finished Downloads item is returned
 * (otherwise null).
 */
export async function receiveChunk(msg) {
  const c = msg?.__bitFile || msg
  if (!c || !c.id || typeof c.chunk !== 'string') return null
  await load()
  let entry = incoming.get(c.id)
  if (!entry) {
    const name = guessFilename('', `filename="${String(c.name || 'download').replace(/"/g, '')}"`)
    const { name: unique, path } = await uniquePath(name)
    if (incoming.has(c.id)) entry = incoming.get(c.id)
    else {
      const item = { id: `${Date.now()}-${c.id}`, url: '', filename: unique, size: c.size || 0, mimeType: c.mime && c.mime !== 'application/octet-stream' ? c.mime : mimeFor(unique), status: 'downloading', progress: 0, path, startedAt: Date.now(), error: '' }
      entry = { item, parts: new Array(c.total), got: 0 }
      incoming.set(c.id, entry)
      items = [item, ...items]
      emit()
    }
  }
  if (entry.parts[c.index] === undefined) entry.got += 1
  entry.parts[c.index] = c.chunk
  if (entry.got < c.total) {
    patch(entry.item.id, { progress: entry.got / c.total })
    return null
  }
  incoming.delete(c.id)
  try {
    await FileSystem.writeAsStringAsync(entry.item.path, entry.parts.join(''), { encoding: FileSystem.EncodingType.Base64 })
    const info = await FileSystem.getInfoAsync(entry.item.path)
    patch(entry.item.id, { status: 'done', progress: 1, size: info.size || c.size || 0 })
  } catch (e) {
    patch(entry.item.id, { status: 'failed', error: String(e?.message || e) })
  }
  return items.find((d) => d.id === entry.item.id)
}

/** Print a PDF (shipping labels print at their real size). */
export async function printDownload(item) {
  if (!item || item.status !== 'done') return
  const Print = require('expo-print')
  await Print.printAsync({ uri: item.path })
}

/**
 * Save a copy where you can find it outside the app. Android asks which
 * folder (pick Downloads); iPhone opens the share sheet ("Save to Files").
 * Returns true when saved.
 */
export async function saveDownloadCopy(item) {
  if (!item || item.status !== 'done') return false
  if (Platform.OS !== 'android') {
    await shareDownload(item)
    return true
  }
  const SAF = FileSystem.StorageAccessFramework
  const perm = await SAF.requestDirectoryPermissionsAsync()
  if (!perm.granted) return false
  const mime = item.mimeType || mimeFor(item.filename)
  const ext = extOf(item.filename)
  const base = ext ? item.filename.slice(0, -(ext.length + 1)) : item.filename
  const target = await SAF.createFileAsync(perm.directoryUri, base, mime)
  const data = await FileSystem.readAsStringAsync(item.path, { encoding: FileSystem.EncodingType.Base64 })
  await FileSystem.writeAsStringAsync(target, data, { encoding: FileSystem.EncodingType.Base64 })
  return true
}

/** Read a finished download as base64 (the PDF viewer uses this). */
export function readDownloadBase64(item) {
  return FileSystem.readAsStringAsync(item.path, { encoding: FileSystem.EncodingType.Base64 })
}

/** Open a finished download in the app that handles it (APKs open the installer). */
export async function openDownload(item) {
  if (!item || item.status !== 'done') return
  if (Platform.OS === 'android') {
    const data = await FileSystem.getContentUriAsync(item.path)
    const type = extOf(item.filename) === 'apk' ? MIME.apk : item.mimeType || mimeFor(item.filename)
    // FLAG_GRANT_READ_URI_PERMISSION
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data, flags: 1, type })
  } else {
    await shareDownload(item)
  }
}

export async function shareDownload(item) {
  if (!item || item.status !== 'done') return
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.")
  await Sharing.shareAsync(item.path, { mimeType: item.mimeType || mimeFor(item.filename), dialogTitle: item.filename })
}

/** Remove from the list and delete the file (stops it if still downloading). */
export async function deleteDownload(id) {
  const item = items.find((d) => d.id === id)
  const task = tasks.get(id)
  if (task) {
    tasks.delete(id)
    await task.cancelAsync().catch(() => {})
  }
  items = items.filter((d) => d.id !== id)
  emit()
  persist()
  if (item?.path) await FileSystem.deleteAsync(item.path, { idempotent: true }).catch(() => {})
}

const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** React hook: the downloads list, newest first. */
export function useDownloads() {
  useSyncExternalStore(subscribe, () => version)
  return [...items].sort((a, b) => b.startedAt - a.startedAt)
}

export function formatSize(bytes) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}
