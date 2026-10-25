// On-device storage for the phone app. Same record model as desktop so the
// two sync cleanly. Secrets (API keys, sync code) live in the iOS Keychain /
// Android Keystore via expo-secure-store.

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import { useSyncExternalStore } from 'react'

const KEY = 'pixel-state-v1'
const HISTORY_LIMIT = 1500

let state = null
let version = 0
let saveTimer = null
const listeners = new Set()
const changeListeners = new Set()

function defaults() {
  return {
    deviceId: Crypto.randomUUID(),
    deviceName: 'Phone',
    ai: { provider: 'anthropic', providers: {} },
    keysPresent: {},
    memoryEnabled: true,
    aiEnabled: true, // the AI slider; off = nothing is sent to any AI (per device, never synced)
    searchEngine: 'duckduckgo',
    checkUpdates: true,
    customSearchUrl: '',
    sync: { server: '', enabled: false, cursor: 0, lastPushedAt: 0, lastSyncAt: 0, syncKeys: false, error: '' },
    updatedAt: { ai: 0, search: 0 },
    records: { memory: {}, history: {}, tabs: {}, settings: {}, passwords: {}, addresses: {}, cards: {} },
    // Settings screen (v0.2)
    homepage: '', // '' = the search engine's home page
    tabLayout: 'grid',
    closeTabsOnExit: false,
    fullscreenVideo: true,
    rotateFullscreen: true,
    ntpShowSynced: true,
    textZoom: 100,
    // Bit Password Manager: secrets live in SecureStore; these indexes hold no secrets.
    offerToSavePasswords: true,
    syncPasswords: false,
    syncCards: false,
    passwordIndex: [], // [{ id, origin, username, updatedAt }]
    addressIndex: [], // [{ id, label, updatedAt }]
    cardIndex: [], // [{ id, holder, last4, exp, updatedAt }]
    // 128bit family: everything off until the user connects and opts in.
    family: { connected: false, account: null, xp: 0, streak: 0, share: {}, queue: [] },
    // v0.3
    shields: {
      enabled: true,
      lists: { easylist: true, easyprivacy: true, ublock: true, ublockQuick: true, peterlowe: true, annoyances: false, cookies: false },
      regional: [], // extra regional list ids
      siteOff: {}, // host -> true when Shields are down for that site (synced)
      totals: { ads: 0, trackers: 0, pages: 0 },
      lastUpdate: 0,
    },
    autoplay: 'muted', // 'off' | 'muted' | 'on'
    theme: 'bit', // theme id from src/themes.js, or 'custom'
    customTheme: null, // { accent, bg, panel, ink }
    tabSkin: 'classic',
    sounds: false, // retro sound effects, off by default
    spending: { capDay: 0, capMonth: 0, spent: {} }, // dollars; 0 = no cap; spent: 'YYYY-MM-DD' -> dollars
    agentLog: [], // [{ id, at, site, kind, text }] newest last, capped
    spaces: [
      { id: 'personal', name: 'Personal' },
      { id: 'work', name: 'Work' },
      { id: '128bit', name: '128bit' },
    ],
    activeSpace: 'personal',
    privateLock: false, // fingerprint/face to open private tabs
    phishing: { enabled: true, lastUpdate: 0 },
    xp: { total: 0, streak: 0, lastDay: '', badges: {}, counters: {} },
    familyLinks: { bitcaller: true, tracker: true },
  }
}

export async function loadStore() {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const saved = raw ? JSON.parse(raw) : {}
    const base = defaults()
    state = { ...base, ...saved, family: { ...base.family, ...saved.family }, sync: { ...base.sync, ...saved.sync }, updatedAt: { ...base.updatedAt, ...saved.updatedAt }, records: { ...base.records, ...saved.records } }
  } catch {
    state = defaults()
  }
  save()
  return state
}

export function getState() {
  return state
}

/** Change state with a mutating function; re-renders subscribers and saves. */
export function update(fn) {
  fn(state)
  version += 1
  for (const l of listeners) l()
  save()
}

function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {}), 400)
}

const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Call fn after every store change; returns an unsubscribe function. */
export const onStoreChange = subscribe

/** React hook: re-render when the store changes. */
export function useStore(selector = (s) => s) {
  useSyncExternalStore(subscribe, () => version)
  return selector(state)
}

// ---------- secrets ----------

const secretKey = (name) => name.replace(/[^A-Za-z0-9._-]/g, '_')

export async function getSecret(name) {
  return (await SecureStore.getItemAsync(secretKey(name))) || ''
}

export async function setSecret(name, value) {
  if (value) await SecureStore.setItemAsync(secretKey(name), value)
  else await SecureStore.deleteItemAsync(secretKey(name))
  if (name.startsWith('apiKey:')) update((s) => (s.keysPresent[name.slice(7)] = !!value))
}

// ---------- synced records ----------

export function onLocalChange(fn) {
  changeListeners.add(fn)
}

export function putRecord(collection, id, data, { deleted = false } = {}) {
  update((s) => {
    s.records[collection][id] = { id, updatedAt: Date.now(), deviceId: s.deviceId, deleted, data: deleted ? null : data }
  })
  for (const fn of changeListeners) fn(collection)
}

export function liveRecords(collection) {
  return Object.values(state.records[collection] || {}).filter((r) => !r.deleted)
}

// Memory is kept per Space (Personal, Work, 128bit…). Record data stays a
// plain string so older versions can still read it; the Space is in the id:
// '<space>:<uuid>', or a bare uuid for Personal (and every older entry).
const memSpace = (r) => (String(r.id).includes(':') ? String(r.id).split(':')[0] : 'personal')
const memText = (r) => (typeof r.data === 'string' ? r.data : '')

export const memory = {
  items: (space = state.activeSpace || 'personal') =>
    liveRecords('memory')
      .filter((r) => memSpace(r) === space)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .map(memText)
      .filter(Boolean),
  add(text, space = state.activeSpace || 'personal') {
    const clean = String(text || '').trim().slice(0, 500)
    if (!clean || memory.items(space).includes(clean)) return
    const id = space === 'personal' ? Crypto.randomUUID() : `${space}:${Crypto.randomUUID()}`
    putRecord('memory', id, clean)
  },
  remove(text, space = state.activeSpace || 'personal') {
    const hit = liveRecords('memory').find((r) => memText(r) === text && memSpace(r) === space)
    if (!hit) return false
    putRecord('memory', hit.id, null, { deleted: true })
    return true
  },
}

/** Pick the address-bar search engine (synced to your other devices). */
export function setSearchEngine(engine, customUrl = '') {
  update((s) => {
    s.searchEngine = engine
    s.customSearchUrl = String(customUrl || '').trim().slice(0, 500)
    s.updatedAt.search = Date.now()
  })
  putRecord('settings', 'search', { engine, customUrl: state.customSearchUrl })
}

export async function addHistory(url, title) {
  if (!/^https?:/.test(url)) return
  const id = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, url)).slice(0, 24)
  putRecord('history', id, { url, title: title || url, visitedAt: Date.now() })
  const all = Object.values(state.records.history)
  if (all.length > HISTORY_LIMIT * 1.2) {
    all.sort((a, b) => b.updatedAt - a.updatedAt)
    update((s) => (s.records.history = Object.fromEntries(all.slice(0, HISTORY_LIMIT).map((r) => [r.id, r]))))
  }
}
