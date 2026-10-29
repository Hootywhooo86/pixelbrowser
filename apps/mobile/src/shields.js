// Bit Shields on the phone: blocks ads and trackers, hides ad slots, and
// strips YouTube ads.
//
// How it works:
//   - Filter lists download straight from their publishers (no Bit Browser
//     server) and compile on the phone (packages/shields-core).
//   - Android: request blocking happens natively in every WebView
//     (modules/bit-shields + plugins/with-shields.js). The same native code
//     also injects the document-start page script into every page and frame.
//   - iPhone: no native request blocking yet. Pages still get the page
//     script (hiding CSS, scriptlets, YouTube) through
//     injectedJavaScriptBeforeContentLoaded, and blocked hosts can't be
//     opened as pages.
//   - Per-site hiding CSS and scriptlets come from siteScript(url), which the
//     app injects when a page starts loading.
// Nothing about your browsing leaves the phone; counts stay on the device.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { requireOptionalNativeModule } from 'expo'
import { award } from './xp'
import { track } from './quests'
import {
  LISTS, REGIONAL_LISTS, SCRIPTLETS_URL, selectedLists, compileLists, createMatcher, buildPageScript, buildSiteScript, hostOf, findIn,
} from '@pixelbrowser/shields-core'
import { getState, update, putRecord } from './store'

const native = Platform.OS === 'android' ? requireOptionalNativeModule('BitShields') : null
const DIR = `${FileSystem.documentDirectory}bitshields/`
const MAX_AGE = 24 * 60 * 60 * 1000

/** Lists for the Settings screen. */
export const LIST_INFO = [
  ...LISTS.map((l) => ({ id: l.id, name: l.name, description: l.description, default: l.default, regional: false })),
  ...REGIONAL_LISTS.map((l) => ({ id: l.id, name: l.name, description: 'Regional ad list.', default: false, regional: true })),
]

let site = null // { cosmetic, scriptlets, scriptletExceptions }
let library = [] // uBO scriptlets (resources.json)
let generic = { generic: [], genericExceptions: [], off: {} }
let matcher = null // iOS only: JS request matching
let pageScript = ''
let nativeDocStart = false
let status = { ready: false, updating: false, error: '', rules: 0, lastUpdate: 0 }
const siteCache = new Map()
const jsCounts = new Map() // page URL -> blocks reported by page scripts
let pendingJs = 0
let version = 0
const listeners = new Set()

function changed() {
  version += 1
  for (const l of listeners) l()
}
const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const shields = () => getState().shields || {}
const enabled = () => shields().enabled !== false
const stripHash = (url) => String(url || '').split('#')[0]
const listsKey = () => {
  const s = shields()
  return selectedLists(s.lists, s.regional || []).map((l) => l.id).sort().join(',')
}

// ---------- startup and updates ----------

/** Loads saved rules, then refreshes the lists in the background if they're old. */
export async function initShields() {
  try {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
    nativeDocStart = !!native?.documentStartSupported?.()
    const meta = await readJson('meta.json')
    const data = await readJson('site.json')
    library = (await readJson('library.json')) || []
    if (data) {
      site = data.site
      generic = data.generic
      if (!native) matcher = createMatcher((await readJson('network.json')) || {})
      status = { ...status, ready: true, rules: meta?.rules || 0, lastUpdate: meta?.updatedAt || 0 }
    }
    await rebuildPageScript()
    native?.setEnabled(enabled())
    changed()
    const stale = !meta || Date.now() - (meta.updatedAt || 0) > MAX_AGE || meta.lists !== listsKey()
    if (stale) setTimeout(() => updateListsNow().catch(() => {}), data ? 15000 : 1500)
  } catch (e) {
    status = { ...status, error: String(e?.message || e) }
    changed()
  }
  setInterval(flushTotals, 10000)
  setInterval(() => {
    if (Date.now() - (status.lastUpdate || 0) > MAX_AGE) updateListsNow().catch(() => {})
  }, 6 * 60 * 60 * 1000)
}

async function readJson(name) {
  try {
    const info = await FileSystem.getInfoAsync(DIR + name)
    if (!info.exists) return null
    return JSON.parse(await FileSystem.readAsStringAsync(DIR + name))
  } catch {
    return null
  }
}

const write = (name, text) => FileSystem.writeAsStringAsync(DIR + name, text)

async function download(url) {
  const urls = Array.isArray(url) ? url : [url]
  let last
  for (const u of urls) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 60000)
      const res = await fetch(u, { signal: ctrl.signal })
      clearTimeout(t)
      if (!res.ok) throw new Error(`${res.status} from ${new URL(u).host}`)
      return await res.text()
    } catch (e) {
      last = e
    }
  }
  throw last
}

let updating = null

/** Downloads the selected lists, compiles them and swaps them in. */
export function updateListsNow() {
  if (updating) return updating
  updating = (async () => {
    status = { ...status, updating: true, error: '' }
    changed()
    try {
      const s = shields()
      const picked = selectedLists(s.lists, s.regional || [])
      const texts = []
      const failed = []
      for (const list of picked) {
        for (const url of list.urls) {
          try {
            texts.push({ text: await download(url), trusted: !!list.trusted, kind: list.kind })
          } catch {
            failed.push(list.name)
          }
        }
      }
      if (!texts.length) throw new Error("Couldn't download the filter lists. Check your connection.")
      try {
        const lib = JSON.parse(await download(SCRIPTLETS_URL))
        if (Array.isArray(lib?.scriptlets)) library = lib.scriptlets
      } catch {
        // keep the previous scriptlet library
      }
      const compiled = await compileLists(texts)
      site = { cosmetic: compiled.cosmetic, scriptlets: compiled.scriptlets, scriptletExceptions: compiled.scriptletExceptions }
      generic = { generic: compiled.cosmetic.generic, genericExceptions: compiled.cosmetic.genericExceptions, off: compiled.cosmetic.off }
      siteCache.clear()
      const n = compiled.network
      await write('site.json', JSON.stringify({ site, generic }))
      await write('library.json', JSON.stringify(library))
      await write('block.txt', n.block.join('\n'))
      await write('block3p.txt', n.block3p.join('\n'))
      await write('allow.txt', n.allow.join('\n'))
      await write('pageallow.txt', n.pageAllow.join('\n'))
      await write('trackers.txt', n.trackers.join('\n'))
      await write('paths.json', JSON.stringify({ paths: n.paths, allowPaths: n.allowPaths, generic: n.generic, allowGeneric: n.allowGeneric }))
      if (!native) {
        await write('network.json', JSON.stringify(n))
        matcher = createMatcher(n)
      }
      const rules = compiled.stats.network + compiled.stats.cosmetic + compiled.stats.scriptlets
      const updatedAt = Date.now()
      await write('meta.json', JSON.stringify({ updatedAt, lists: listsKey(), rules, failed }))
      await rebuildPageScript()
      status = { ready: true, updating: false, error: failed.length ? `Couldn't download: ${failed.join(', ')}` : '', rules, lastUpdate: updatedAt }
      update((st) => (st.shields = { ...st.shields, lastUpdate: updatedAt }))
    } catch (e) {
      status = { ...status, updating: false, error: String(e?.message || e) }
    } finally {
      updating = null
      changed()
    }
    return status
  })()
  return updating
}

/** Rebuilds the document-start script (after list updates or site toggles). */
async function rebuildPageScript() {
  const s = shields()
  const siteOff = Object.keys(s.siteOff || {}).filter((h) => s.siteOff[h])
  pageScript = buildPageScript({
    generic: generic.generic,
    genericExceptions: generic.genericExceptions,
    cosmeticOff: generic.off,
    scriptlets: site?.scriptlets || {},
    scriptletExceptions: site?.scriptletExceptions || {},
    library,
    siteOff,
  })
  siteCache.clear()
  if (native) {
    native.setSiteOff(siteOff)
    await write('docstart.js', enabled() ? pageScript : '')
    await native.load(DIR).catch(() => {})
  }
  changed()
}

// ---------- used by the browser screen ----------

/**
 * Script for every WebView's `injectedJavaScriptBeforeContentLoaded`. On
 * Android with document-start support this is '' (native code already runs
 * the same script earlier and in every frame).
 */
export function beforeContentJS() {
  if (!enabled() || nativeDocStart) return ''
  return pageScript
}

/** React hook: re-renders when the page script or status changes; returns beforeContentJS(). */
export function useShieldsScript() {
  useSyncExternalStore(subscribe, () => version)
  return beforeContentJS()
}

/** Per-site hiding CSS + scriptlets for the page at `url`; inject when it starts loading. '' if none. */
export function siteScript(url) {
  const host = hostOf(url)
  if (!enabled() || !host || !site || !siteShieldsOn(url)) return ''
  if (siteCache.has(host)) return siteCache.get(host)
  const js = buildSiteScript({ compiled: site, library, host })
  siteCache.set(host, js)
  if (siteCache.size > 60) siteCache.delete(siteCache.keys().next().value)
  return js
}

/** True when a page or frame at `url` (opened from `pageUrl`) is an ad/tracker host. */
export function isBlocked(url, pageUrl) {
  if (!enabled() || !/^https?:/i.test(String(url))) return false
  if (pageUrl && !siteShieldsOn(pageUrl)) return false
  if (native) return !!native.isBlocked(String(url), pageUrl ? String(pageUrl) : null)
  return !!matcher?.isBlocked(url, pageUrl)
}

export function siteShieldsOn(url) {
  const host = hostOf(url)
  const off = shields().siteOff || {}
  return !(host && findIn(new Set(Object.keys(off).filter((h) => off[h])), host))
}

/** "Shields down for this site" (synced to your other devices). */
export async function setSiteShields(url, on) {
  const host = hostOf(url)
  if (!host) return
  update((st) => {
    const siteOff = { ...(st.shields.siteOff || {}) }
    // Turning Shields back on clears the site and any parent entry covering it.
    if (on) for (const h of Object.keys(siteOff)) if (host === h || host.endsWith(`.${h}`)) delete siteOff[h]
    if (!on) siteOff[host] = true
    st.shields = { ...st.shields, siteOff }
    st.updatedAt = { ...st.updatedAt, shields: Date.now() }
  })
  pushSynced()
  await rebuildPageScript()
}

export async function setShieldsEnabled(on) {
  update((st) => {
    st.shields = { ...st.shields, enabled: !!on }
    st.updatedAt = { ...st.updatedAt, shields: Date.now() }
  })
  native?.setEnabled(!!on)
  pushSynced()
  await rebuildPageScript()
}

/** Turn a list on or off (ids from LIST_INFO); refreshes the rules. */
export async function setListEnabled(id, on) {
  const regional = REGIONAL_LISTS.some((l) => l.id === id)
  update((st) => {
    const s = { ...st.shields }
    if (regional) s.regional = on ? [...new Set([...(s.regional || []), id])] : (s.regional || []).filter((x) => x !== id)
    else s.lists = { ...s.lists, [id]: !!on }
    st.shields = s
    st.updatedAt = { ...st.updatedAt, shields: Date.now() }
  })
  pushSynced()
  return updateListsNow()
}

function pushSynced() {
  const s = shields()
  putRecord('settings', 'shields', { enabled: s.enabled !== false, siteOff: s.siteOff || {}, lists: s.lists || {}, regional: s.regional || [] })
}

/** Applies Shields settings synced from another device. Called by src/sync.js. */
export async function applyRemoteShields() {
  const s = getState()
  const rec = s.records.settings?.shields
  if (!rec || rec.deleted || rec.deviceId === s.deviceId || rec.updatedAt <= (s.updatedAt?.shields || 0)) return
  const before = listsKey()
  update((st) => {
    st.shields = { ...st.shields, enabled: rec.data.enabled !== false, siteOff: rec.data.siteOff || {}, lists: rec.data.lists || st.shields.lists, regional: rec.data.regional || [] }
    st.updatedAt = { ...st.updatedAt, shields: rec.updatedAt }
  })
  native?.setEnabled(enabled())
  await rebuildPageScript()
  if (listsKey() !== before) updateListsNow().catch(() => {})
}

// ---------- counts ----------

/**
 * Handles messages from the page script. Returns true if it was a Shields
 * message (then the app can ignore it).
 */
export function handleShieldsMessage(msg, url) {
  if (!msg || msg.__bitBlocked === undefined) return false
  recordBlocked(url, Number(msg.__bitBlocked) || 0)
  return true
}

/** Blocks found by page scripts (e.g. YouTube ads skipped). */
export function recordBlocked(url, n) {
  if (!n) return
  const key = stripHash(url)
  jsCounts.set(key, (jsCounts.get(key) || 0) + n)
  if (jsCounts.size > 200) jsCounts.delete(jsCounts.keys().next().value)
  pendingJs += n
}

/** Blocked count for the page at `url` (network blocks + page-script blocks). */
export function blockedCount(url) {
  if (!url) return 0
  const key = stripHash(url)
  return (native ? native.blockedOn(key) : 0) + (jsCounts.get(key) || 0)
}

/** React hook: the blocked count for `url`, refreshed every 1.5 s. */
export function useBlockedCount(url) {
  const [n, setN] = useState(() => blockedCount(url))
  useEffect(() => {
    setN(blockedCount(url))
    const t = setInterval(() => setN(blockedCount(url)), 1500)
    return () => clearInterval(t)
  }, [url])
  return n
}

/** React hook: { ready, updating, error, rules, lastUpdate } for Settings. */
export function useShieldsStatus() {
  useSyncExternalStore(subscribe, () => version)
  return status
}

let pagesPending = 0
/** Call when a page finishes loading: counts pages where something was blocked. */
export function notePageLoaded(url) {
  if (blockedCount(url) > 0) pagesPending += 1
}

function flushTotals() {
  const [ads = 0, trackers = 0] = native?.takeTotals?.() || []
  const js = pendingJs
  const pages = pagesPending
  pendingJs = 0
  pagesPending = 0
  if (!ads && !trackers && !js && !pages) return
  if (ads + trackers + js) {
    award('blocked', ads + trackers + js)
    track('blocked', ads + trackers + js)
  }
  update((st) => {
    const t = st.shields.totals || { ads: 0, trackers: 0, pages: 0 }
    st.shields = { ...st.shields, totals: { ads: (t.ads || 0) + ads + js, trackers: (t.trackers || 0) + trackers, pages: (t.pages || 0) + pages } }
  })
}
