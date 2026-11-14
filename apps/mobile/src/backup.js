// Encrypted backup and restore: everything in one .bitbackup file, locked with
// a passphrase only you know (scrypt + XChaCha20-Poly1305, see sync-core).
// Restoring merges into what's already on the phone; it never wipes anything.

import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import * as Crypto from 'expo-crypto'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { encryptBackup, decryptBackup, isBackup } from '@pixelbrowser/sync-core/backup'
import { getState, update, putRecord, liveRecords } from './store'
import { listLogins, saveLogin, listAddresses, saveAddress, listCards, saveCard } from './passwords'
import { listTotp, addTotp } from './totp'

// Phones are slower than computers; 2^14 keeps a backup to a couple of seconds.
const KDF = { N: 2 ** 14, r: 8, p: 1 }
const RECORD_KINDS = ['bookmarks', 'notes', 'readlater', 'packages', 'memory', 'history', 'watchers']
const SETTING_KEYS = [
  'searchEngine', 'customSearchUrl', 'homepage', 'theme', 'customTheme', 'tabSkin', 'sounds', 'autoplay', 'textZoom',
  'spaces', 'activeSpace', 'shields', 'siteSettings', 'xp', 'quests', 'businessProfile', 'ntp', 'restoreTabs',
  'hideBarsOnScroll', 'fullscreenVideo', 'rotateFullscreen', 'familyLinks', 'phishing', 'cleanLinks', 'hiddenElements', 'homeShortcuts', 'autoPrintLabels', 'deviceName',
]

/** Everything worth keeping, with secrets decrypted (only ever written out encrypted). */
export async function collectBackup() {
  const s = getState()
  const records = {}
  for (const k of RECORD_KINDS) records[k] = liveRecords(k).map((r) => ({ id: r.id, updatedAt: r.updatedAt, data: r.data }))
  const settings = {}
  for (const k of SETTING_KEYS) if (s[k] !== undefined) settings[k] = s[k]
  return {
    app: 'Bit Browser',
    version: Constants.expoConfig?.version || '',
    platform: Platform.OS,
    createdAt: new Date().toISOString(),
    tabs: s.savedTabs || [],
    settings,
    records,
    secrets: { logins: await listLogins(), addresses: await listAddresses(), cards: await listCards(), totp: await listTotp() },
  }
}

export function backupSummary(b) {
  const r = b?.records || {}
  return {
    createdAt: b?.createdAt,
    version: b?.version,
    tabs: b?.tabs?.length || 0,
    bookmarks: r.bookmarks?.length || 0,
    notes: r.notes?.length || 0,
    readlater: r.readlater?.length || 0,
    packages: r.packages?.length || 0,
    history: r.history?.length || 0,
    logins: b?.secrets?.logins?.length || 0,
    addresses: b?.secrets?.addresses?.length || 0,
    cards: b?.secrets?.cards?.length || 0,
    totp: b?.secrets?.totp?.length || 0,
  }
}

/** Make the encrypted file. → { path, name, summary } */
export async function createBackupFile(passphrase) {
  const data = await collectBackup()
  const text = await encryptBackup(data, passphrase, KDF)
  const name = `BitBrowser-backup-${new Date().toISOString().slice(0, 10)}.bitbackup`
  const path = `${FileSystem.cacheDirectory}${name}`
  await FileSystem.writeAsStringAsync(path, text)
  return { path, name, summary: backupSummary(data) }
}

/** Send the file to Google Drive, email, another app… */
export async function shareBackupFile(file) {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.")
  await Sharing.shareAsync(file.path, { mimeType: 'application/octet-stream', dialogTitle: 'Save your Bit Browser backup' })
}

/** Android: save into a folder you pick (like Downloads). */
export async function saveBackupToFolder(file) {
  if (Platform.OS !== 'android') return shareBackupFile(file)
  const SAF = FileSystem.StorageAccessFramework
  const perm = await SAF.requestDirectoryPermissionsAsync()
  if (!perm.granted) return false
  const target = await SAF.createFileAsync(perm.directoryUri, file.name, 'application/octet-stream')
  await FileSystem.writeAsStringAsync(target, await FileSystem.readAsStringAsync(file.path))
  return true
}

/** Remove the unencrypted-free (but still personal) copy from the cache once saved. */
export const discardBackupFile = (file) => FileSystem.deleteAsync(file.path, { idempotent: true }).catch(() => {})

/** Pick a .bitbackup file. → text or null */
export async function pickBackupFile() {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true })
  if (res.canceled || !res.assets?.length) return null
  const text = await FileSystem.readAsStringAsync(res.assets[0].uri)
  FileSystem.deleteAsync(res.assets[0].uri, { idempotent: true }).catch(() => {})
  if (!isBackup(text)) throw new Error("That isn't a Bit Browser backup file (.bitbackup).")
  return text
}

export const openBackup = (text, passphrase) => decryptBackup(text, passphrase)

/** Merge a backup into this phone. Existing things win; nothing is deleted. → counts */
export async function restoreBackup(b) {
  const got = { tabs: 0, bookmarks: 0, notes: 0, readlater: 0, packages: 0, other: 0, logins: 0, addresses: 0, cards: 0, totp: 0 }
  const r = b.records || {}

  // Synced records: add the ones this phone doesn't have (bookmarks matched by address).
  const haveUrls = new Set(liveRecords('bookmarks').map((x) => x.data?.url))
  for (const x of r.bookmarks || []) if (x.data?.url && !haveUrls.has(x.data.url)) putRecord('bookmarks', Crypto.randomUUID(), x.data), got.bookmarks++
  for (const kind of ['notes', 'readlater', 'packages', 'memory', 'history', 'watchers']) {
    const have = getState().records[kind] || {}
    for (const x of r[kind] || []) {
      if (!x?.id || !x.data || have[x.id]) continue
      putRecord(kind, x.id, x.data)
      if (got[kind] !== undefined) got[kind]++
      else got.other++
    }
  }

  // Tabs: add saved tabs whose address isn't already saved.
  const s0 = getState()
  const urls = new Set((s0.savedTabs || []).map((t) => t.url))
  const newTabs = (b.tabs || []).filter((t) => t?.url && !urls.has(t.url))
  got.tabs = newTabs.length

  update((s) => {
    const set = b.settings || {}
    if (newTabs.length) s.savedTabs = [...(s.savedTabs || []), ...newTabs]
    // Spaces: union by id.
    if (Array.isArray(set.spaces)) {
      const ids = new Set((s.spaces || []).map((x) => x.id))
      s.spaces = [...(s.spaces || []), ...set.spaces.filter((x) => x?.id && !ids.has(x.id))]
    }
    // Per-site choices and Shields-down sites: keep this phone's, add the rest.
    if (set.siteSettings) s.siteSettings = { ...set.siteSettings, ...(s.siteSettings || {}) }
    if (set.shields?.siteOff) s.shields = { ...s.shields, siteOff: { ...set.shields.siteOff, ...(s.shields?.siteOff || {}) } }
    // XP: never go backwards.
    if (set.xp) {
      const a = s.xp || {}
      const c = { ...(set.xp.counters || {}) }
      for (const [k, v] of Object.entries(a.counters || {})) c[k] = Math.max(v || 0, c[k] || 0)
      s.xp = { ...set.xp, ...a, total: Math.max(a.total || 0, set.xp.total || 0), streak: Math.max(a.streak || 0, set.xp.streak || 0), counters: c, badges: { ...(set.xp.badges || {}), ...(a.badges || {}) } }
    }
    // Simple preferences: only fill in what this phone hasn't set.
    for (const k of ['businessProfile', 'customTheme', 'homepage', 'customSearchUrl']) if (set[k] && !s[k]) s[k] = set[k]
    if (set.theme && (!s.theme || s.theme === 'bit')) s.theme = set.theme
    if (set.searchEngine && (!s.searchEngine || s.searchEngine === 'duckduckgo')) s.searchEngine = set.searchEngine
  })

  // Secrets go back into SecureStore.
  const sec = b.secrets || {}
  for (const l of sec.logins || []) if (await saveLogin({ origin: l.origin, username: l.username, password: l.password }).catch(() => null)) got.logins++
  const addrKey = (a) => [a.name, a.street, a.postal].join('|').toLowerCase()
  const haveAddr = new Set((await listAddresses()).map(addrKey))
  for (const a of sec.addresses || []) {
    const { id, updatedAt, ...rest } = a
    if (!haveAddr.has(addrKey(rest))) await saveAddress(rest).then(() => got.addresses++).catch(() => {})
  }
  const haveCards = new Set((await listCards()).map((c) => String(c.number || '')))
  for (const c of sec.cards || []) {
    const { id, updatedAt, ...rest } = c
    if (rest.number && !haveCards.has(String(rest.number))) await saveCard(rest).then(() => got.cards++).catch(() => {})
  }
  const before = (await listTotp()).length
  for (const t of sec.totp || []) {
    const { id, updatedAt, ...rest } = t
    await addTotp(rest).catch(() => {})
  }
  got.totp = (await listTotp()).length - before
  update((s) => (s.lastRestoreAt = Date.now()))
  return got
}

export function noteBackupMade() {
  update((s) => (s.lastBackupAt = Date.now()))
}
