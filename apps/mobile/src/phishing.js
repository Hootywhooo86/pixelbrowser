// Phishing and malware warnings. Free host feeds download straight from their
// publishers every 12 hours and are checked on the phone, so the sites you
// visit are never sent anywhere.

import * as FileSystem from 'expo-file-system/legacy'
import { PHISHING_FEEDS, parseHostsList, hostOf, parents } from '@pixelbrowser/shields-core'
import { getState, update } from './store'

const DIR = `${FileSystem.documentDirectory}bitshields/`
const FILE = `${DIR}phishing.json`
const MAX_AGE = 12 * 60 * 60 * 1000

let bad = new Map() // host -> feed name
const allowed = new Set() // hosts the user chose to open anyway (this session)
let timer = null

/** Loads the saved feeds, then refreshes them if they're older than 12 hours. */
export async function initPhishing() {
  try {
    const info = await FileSystem.getInfoAsync(FILE)
    if (info.exists) load(JSON.parse(await FileSystem.readAsStringAsync(FILE)))
  } catch {}
  const age = Date.now() - (getState().phishing?.lastUpdate || 0)
  if (age > MAX_AGE || !bad.size) setTimeout(() => updatePhishingNow().catch(() => {}), bad.size ? 20000 : 3000)
  clearInterval(timer)
  timer = setInterval(() => updatePhishingNow().catch(() => {}), MAX_AGE)
}

function load(data) {
  const next = new Map()
  for (const feed of data?.feeds || []) for (const h of feed.hosts) if (!next.has(h)) next.set(h, feed.name)
  bad = next
}

/** Downloads the feeds now. Keeps the old data if a download fails. */
export async function updatePhishingNow() {
  const feeds = []
  for (const f of PHISHING_FEEDS) {
    try {
      const res = await fetch(f.url)
      if (!res.ok) throw new Error(String(res.status))
      feeds.push({ id: f.id, name: f.name, hosts: parseHostsList(await res.text()) })
    } catch {}
  }
  if (!feeds.length) return false
  const data = { updatedAt: Date.now(), feeds }
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
  await FileSystem.writeAsStringAsync(FILE, JSON.stringify(data))
  load(data)
  update((s) => (s.phishing = { ...s.phishing, lastUpdate: data.updatedAt }))
  return true
}

/** null if fine, or { host, list } when `url` is on a phishing/malware list. */
export function isDangerous(url) {
  if (getState().phishing?.enabled === false || !bad.size) return null
  const host = hostOf(url)
  if (!host || allowed.has(host)) return null
  for (const h of parents(host)) {
    if (!h.includes('.')) break
    const list = bad.get(h)
    if (list) return { host, list }
  }
  return null
}

/** "Continue anyway": stop warning about `host` until the app restarts. */
export function allowOnce(host) {
  if (host) allowed.add(String(host).toLowerCase())
}

/** Number of dangerous hosts known (for Settings). */
export function phishingCount() {
  return bad.size
}
