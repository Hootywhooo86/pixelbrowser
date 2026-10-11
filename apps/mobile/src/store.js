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
    sync: { server: '', enabled: false, cursor: 0, lastPushedAt: 0, lastSyncAt: 0, syncKeys: false, error: '' },
    updatedAt: { ai: 0 },
    records: { memory: {}, history: {}, tabs: {}, settings: {} },
  }
}

export async function loadStore() {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const saved = raw ? JSON.parse(raw) : {}
    const base = defaults()
    state = { ...base, ...saved, sync: { ...base.sync, ...saved.sync }, records: { ...base.records, ...saved.records } }
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

export const memory = {
  items: () => liveRecords('memory').sort((a, b) => a.updatedAt - b.updatedAt).map((r) => r.data),
  add(text) {
    const clean = String(text || '').trim().slice(0, 500)
    if (!clean || memory.items().includes(clean)) return
    putRecord('memory', Crypto.randomUUID(), clean)
  },
  remove(text) {
    const hit = liveRecords('memory').find((r) => r.data === text)
    if (!hit) return false
    putRecord('memory', hit.id, null, { deleted: true })
    return true
  },
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
