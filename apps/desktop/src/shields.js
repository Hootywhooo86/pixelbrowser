// Bit Shields: blocks ads and trackers (network + cosmetic + scriptlets, the
// same filter lists uBlock Origin uses, including its YouTube rules), with a
// per-page count and "Shields down" per site. Phishing and malware sites get
// a warning page first. Lists come only from the list hosts; counts and
// settings stay on this device (the per-site choices sync, encrypted).

const fs = require('node:fs')
const path = require('node:path')
const { app, ipcMain } = require('electron')
const { ElectronBlocker, fromElectronDetails } = require('@ghostery/adblocker-electron')
const store = require('./store')
const phishing = require('./phishing')

const PRELOAD_PATH = require.resolve('@ghostery/adblocker-electron-preload')
const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000

const GH = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets'
const LISTS = {
  easylist: { label: 'EasyList (ads)', urls: [`${GH}/easylist/easylist.txt`] },
  easyprivacy: { label: 'EasyPrivacy (trackers)', urls: [`${GH}/easylist/easyprivacy.txt`, `${GH}/ublock-origin/privacy.txt`] },
  ublock: {
    label: 'uBlock filters (incl. YouTube ads)',
    urls: ['filters', 'filters-2020', 'filters-2021', 'filters-2022', 'filters-2023', 'filters-2024', 'badware', 'resource-abuse'].map((n) => `${GH}/ublock-origin/${n}.txt`),
  },
  ublockQuick: { label: 'uBlock quick fixes and unbreak', urls: [`${GH}/ublock-origin/quick-fixes.txt`, `${GH}/ublock-origin/unbreak.txt`] },
  peterlowe: { label: "Peter Lowe's ad server list", urls: [`${GH}/peter-lowe/serverlist.txt`] },
  annoyances: { label: 'Annoyances (pop-ups, "get the app" banners)', urls: [`${GH}/ublock-origin/annoyances-others.txt`] },
  cookies: { label: 'Cookie banners', urls: [`${GH}/easylist/easylist-cookie.txt`, `${GH}/ublock-origin/annoyances-cookies.txt`] },
}
const REGIONAL = {
  de: { label: 'German (EasyList Germany)', url: 'https://easylist.to/easylistgermany/easylistgermany.txt' },
  fr: { label: 'French (Liste FR)', url: 'https://easylist-downloads.adblockplus.org/liste_fr.txt' },
  es: { label: 'Spanish (EasyList Spanish)', url: 'https://easylist-downloads.adblockplus.org/easylistspanish.txt' },
  it: { label: 'Italian (EasyList Italy)', url: 'https://easylist-downloads.adblockplus.org/easylistitaly.txt' },
  nl: { label: 'Dutch (EasyList Dutch)', url: 'https://easylist-downloads.adblockplus.org/easylistdutch.txt' },
}
const TRACKER_TYPES = new Set(['ping', 'xhr', 'beacon', 'csp_report', 'other', 'fetch'])

let engine = null
let building = null
let timer = null
const pageHost = new Map() // webContents id -> host of the page it shows
const pageCount = new Map() // webContents id -> requests blocked on the current page
const allowedOnce = new Set() // dangerous hosts the user chose to visit anyway
const attached = new WeakSet()
const listeners = { blocked: new Set(), page: new Set(), warn: new Set() }

const cfg = () => store.settings.data.shields
const engineFile = () => path.join(app.getPath('userData'), 'shields-engine.bin')

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function selectedUrls() {
  const c = cfg()
  const urls = []
  for (const [id, list] of Object.entries(LISTS)) if (c.lists[id]) urls.push(...list.urls)
  for (const id of c.regional || []) if (REGIONAL[id]) urls.push(REGIONAL[id].url)
  return urls
}

const listsKey = () => selectedUrls().join('|')

async function build() {
  // Tests pass a small filter list and never touch the network.
  if (process.env.PIXEL_TEST_FILTERS) {
    return ElectronBlocker.parse(fs.readFileSync(process.env.PIXEL_TEST_FILTERS, 'utf8'), { loadCosmeticFilters: true, loadNetworkFilters: true })
  }
  return ElectronBlocker.fromLists(fetch, selectedUrls(), { loadCosmeticFilters: true, loadNetworkFilters: true, enableCompression: true })
}

function saveCache(e) {
  try {
    fs.writeFileSync(engineFile(), e.serialize())
    fs.writeFileSync(`${engineFile()}.json`, JSON.stringify({ key: listsKey(), at: Date.now() }))
  } catch {}
}

function loadCache() {
  try {
    const meta = JSON.parse(fs.readFileSync(`${engineFile()}.json`, 'utf8'))
    if (meta.key !== listsKey()) return null
    return { engine: ElectronBlocker.deserialize(fs.readFileSync(engineFile())), at: meta.at }
  } catch {
    return null
  }
}

/** Download the chosen lists and swap in a fresh engine. */
function update() {
  if (building) return building
  building = build()
    .then((e) => {
      engine = e
      if (!process.env.PIXEL_TEST_FILTERS) saveCache(e)
      cfg().lastUpdate = Date.now()
      store.settings.save()
      return true
    })
    .catch((err) => {
      console.error('[shields] could not update the filter lists:', err.message)
      return false
    })
    .finally(() => (building = null))
  return building
}

async function start() {
  phishing.start()
  if (!process.env.PIXEL_TEST_FILTERS) {
    const cached = loadCache()
    if (cached) engine = cached.engine
    if (!cached || Date.now() - cached.at > UPDATE_EVERY_MS) {
      // With a cached engine, browsing doesn't wait for the download.
      if (cached) update()
      else await update()
    }
  } else await update()
  clearInterval(timer)
  timer = setInterval(() => update(), UPDATE_EVERY_MS)
}

const siteDown = (host) => !!host && (cfg().siteOff[host] || cfg().siteOff[host.replace(/^www\./, '')])
const activeFor = (wcId) => cfg().enabled && !!engine && !siteDown(pageHost.get(wcId))

function countBlocked(wcId, type) {
  pageCount.set(wcId, (pageCount.get(wcId) || 0) + 1)
  const kind = TRACKER_TYPES.has(type) ? 'trackers' : 'ads'
  cfg().totals[kind] = (cfg().totals[kind] || 0) + 1
  store.settings.save()
  for (const fn of listeners.blocked) fn(wcId, pageCount.get(wcId), kind)
}

function onBeforeRequest(details, callback) {
  const wcId = details.webContentsId
  if (details.resourceType === 'mainFrame') {
    const host = hostOf(details.url)
    if (wcId != null) {
      pageHost.set(wcId, host)
      pageCount.set(wcId, 0)
      for (const fn of listeners.page) fn(wcId, 0)
    }
    if (/^https?:/.test(details.url) && phishing.isDangerous(details.url) && !allowedOnce.has(host)) {
      callback({ cancel: true })
      for (const fn of listeners.warn) fn(wcId, details.url)
      return
    }
    return callback({})
  }
  if (wcId == null || !activeFor(wcId)) return callback({})
  const request = fromElectronDetails(details)
  if (engine.config.guessRequestTypeFromUrl === true && request.type === 'other') request.guessTypeOfRequest()
  const { redirect, match } = engine.match(request)
  if (redirect) {
    callback({ redirectURL: redirect.dataUrl })
    countBlocked(wcId, request.type)
  } else if (match) {
    callback({ cancel: true })
    countBlocked(wcId, request.type)
  } else callback({})
}

function onHeadersReceived(details, callback) {
  if (details.webContentsId == null || !activeFor(details.webContentsId)) return callback({})
  engine.onHeadersReceived(details, callback)
}

let ipcReady = false
function registerIpc() {
  if (ipcReady) return
  ipcReady = true
  // Cosmetic filters + scriptlets (hiding ad slots, YouTube ad skipping).
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
    const wcId = event.sender.id
    if (!activeFor(wcId) || siteDown(hostOf(event.sender.getURL()))) return
    return engine.onInjectCosmeticFilters(event, url, msg)
  })
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', () => !!engine?.config.enableMutationObserver)
}

/** Turn Shields on for a session (each window profile and private window). */
function attach(ses) {
  if (attached.has(ses)) return
  attached.add(ses)
  registerIpc()
  ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD_PATH })
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, onBeforeRequest)
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, onHeadersReceived)
}

function setSiteDown(host, down) {
  host = String(host || '').replace(/^www\./, '')
  if (!host) return
  if (down) cfg().siteOff[host] = true
  else delete cfg().siteOff[host]
  saveSynced()
}

function saveSynced() {
  cfg().updatedAt = Date.now()
  store.settings.save()
  store.putRecord('settings', 'shields', { siteOff: cfg().siteOff, lists: cfg().lists, regional: cfg().regional, enabled: cfg().enabled })
}

/** Shields choices made on another device. */
function applyRemote() {
  const rec = store.records.data.settings.shields
  if (!rec || rec.deleted || rec.deviceId === store.settings.data.deviceId || rec.updatedAt <= (cfg().updatedAt || 0)) return false
  const before = listsKey()
  const d = rec.data || {}
  if (d.siteOff) cfg().siteOff = d.siteOff
  if (d.lists) cfg().lists = { ...cfg().lists, ...d.lists }
  if (Array.isArray(d.regional)) cfg().regional = d.regional
  if (typeof d.enabled === 'boolean') cfg().enabled = d.enabled
  cfg().updatedAt = rec.updatedAt
  store.settings.save()
  if (listsKey() !== before) update()
  return true
}

/** Change list choices; rebuilds the engine when the lists changed. */
function setOptions({ enabled, lists, regional } = {}) {
  const before = listsKey()
  if (typeof enabled === 'boolean') cfg().enabled = enabled
  if (lists) for (const [k, v] of Object.entries(lists)) if (LISTS[k]) cfg().lists[k] = !!v
  if (Array.isArray(regional)) cfg().regional = regional.filter((id) => REGIONAL[id])
  saveSynced()
  if (listsKey() !== before) update()
}

function publicState() {
  const c = cfg()
  return {
    enabled: c.enabled,
    lists: Object.entries(LISTS).map(([id, l]) => ({ id, label: l.label, on: !!c.lists[id] })),
    regional: Object.entries(REGIONAL).map(([id, l]) => ({ id, label: l.label, on: (c.regional || []).includes(id) })),
    siteOff: Object.keys(c.siteOff),
    totals: c.totals,
    lastUpdate: c.lastUpdate,
    updating: !!building,
    phishingHosts: phishing.count(),
    phishingOn: store.settings.data.phishing.enabled,
  }
}

function resetTotals() {
  cfg().totals = { ads: 0, trackers: 0 }
  store.settings.save()
}

module.exports = {
  start,
  update,
  attach,
  setSiteDown,
  siteDown,
  setOptions,
  applyRemote,
  publicState,
  resetTotals,
  hostOf,
  pageCount: (wcId) => pageCount.get(wcId) || 0,
  allowOnce: (host) => allowedOnce.add(host),
  forget: (wcId) => {
    pageHost.delete(wcId)
    pageCount.delete(wcId)
  },
  onBlocked: (fn) => listeners.blocked.add(fn),
  onPage: (fn) => listeners.page.add(fn),
  onWarn: (fn) => listeners.warn.add(fn),
  LISTS,
  REGIONAL,
}
