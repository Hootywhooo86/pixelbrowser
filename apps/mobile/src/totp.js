// Bit Authenticator: two-factor (2FA) codes inside the password manager.
//
// Each secret key lives in SecureStore (one item per entry); the app state only
// keeps an index (issuer, account) so the list renders without unlocking.
// With "Sync passwords" on, entries sync end-to-end encrypted as 'totp'
// records and follow the same strip-after-push rules as passwords.

import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import { useSyncExternalStore } from 'react'
import { totp, parseOtpauth, base32Decode, secondsLeft } from '@pixelbrowser/tools-core'
import { getState, update, putRecord, useStore } from './store'
import { registerSecretCollection } from './passwords'

const KEY = (id) => `totp_${id}`

const clean = (e) => ({
  secret: String(e.secret || '').replace(/\s/g, '').toUpperCase(),
  issuer: String(e.issuer || '').trim().slice(0, 80),
  account: String(e.account || '').trim().slice(0, 120),
  site: String(e.site || '').trim().slice(0, 200), // optional: the sign-in page it's for
  digits: Math.min(10, Math.max(6, Number(e.digits) || 6)),
  period: Math.max(1, Number(e.period) || 30),
  algorithm: String(e.algorithm || 'SHA1').toUpperCase(),
})

export function totpIndex() {
  return getState().totpIndex || []
}

export const useTotpIndex = () => useStore((s) => s.totpIndex || [])

async function storeTotp(id, data, { sync = true } = {}) {
  const entry = { ...clean(data), updatedAt: data.updatedAt || Date.now() }
  base32Decode(entry.secret) // throws on a bad key
  await SecureStore.setItemAsync(KEY(id), JSON.stringify(entry))
  const { secret, ...meta } = entry
  update((s) => (s.totpIndex = [...(s.totpIndex || []).filter((x) => x.id !== id), { id, ...meta }]))
  if (sync && getState().syncPasswords) putRecord('totp', id, entry)
  return id
}

registerSecretCollection('totp', {
  secret: 'secret',
  index: totpIndex,
  key: KEY,
  store: storeTotp,
  remove: (id) => SecureStore.deleteItemAsync(KEY(id)),
  field: 'totpIndex',
})

/** Add from an otpauth:// URI (QR code) or fields { secret, issuer, account, … }. Returns the id. */
export async function addTotp(input) {
  const entry = typeof input === 'string' ? parseOtpauth(input) : clean(input)
  base32Decode(entry.secret)
  for (const e of await listTotp()) if (e.secret === entry.secret) return e.id // already saved
  return storeTotp(Crypto.randomUUID(), entry)
}

export async function updateTotp(id, patch) {
  const cur = await readEntry(id)
  if (cur) await storeTotp(id, { ...cur, ...patch, updatedAt: Date.now() })
}

export async function deleteTotp(id) {
  await SecureStore.deleteItemAsync(KEY(id)).catch(() => {})
  update((s) => (s.totpIndex = (s.totpIndex || []).filter((x) => x.id !== id)))
  if (getState().syncPasswords || getState().records.totp?.[id]) putRecord('totp', id, null, { deleted: true })
}

async function readEntry(id) {
  try {
    const raw = await SecureStore.getItemAsync(KEY(id))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Every entry with its secret. Unlock first (passwords.js unlock()). */
export async function listTotp() {
  const out = []
  for (const i of totpIndex()) {
    const e = await readEntry(i.id)
    if (e) out.push({ id: i.id, ...e })
  }
  return out
}

/** Push everything saved so far (when "Sync passwords" is turned on). */
export async function pushTotpForSync() {
  if (!getState().syncPasswords) return
  for (const e of await listTotp()) {
    const { id, ...rest } = e
    putRecord('totp', id, rest)
  }
}

export function codeFor(entry, time = Date.now()) {
  try {
    return totp(entry.secret, { time, period: entry.period, digits: entry.digits, algorithm: entry.algorithm })
  } catch {
    return '------'
  }
}

export { secondsLeft }

// A shared once-a-second clock, so every code on screen ticks together.
let tick = Date.now()
const subs = new Set()
let timer = null
function subscribe(fn) {
  subs.add(fn)
  if (!timer) timer = setInterval(() => {
    tick = Date.now()
    for (const s of subs) s()
  }, 1000)
  return () => {
    subs.delete(fn)
    if (!subs.size && timer) clearInterval(timer), (timer = null)
  }
}
export const useNow = () => useSyncExternalStore(subscribe, () => tick)

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/** Entries that probably belong to this site (by saved site, issuer or account domain). Index only. */
export function findTotpFor(url) {
  const host = hostOf(url)
  if (!host) return []
  const name = host.split('.').slice(-2, -1)[0] || host
  return totpIndex().filter((e) => {
    if (e.site && hostOf(e.site) && (host === hostOf(e.site) || host.endsWith(`.${hostOf(e.site)}`))) return true
    const issuer = e.issuer.toLowerCase().replace(/[^a-z0-9]/g, '')
    return (issuer && (issuer === name || host.includes(issuer))) || (e.account.includes('@') && host.endsWith(e.account.split('@')[1]?.toLowerCase() || '#'))
  })
}

/** Current code for an index entry (reads its secret from SecureStore). */
export async function currentCode(id) {
  const e = await readEntry(id)
  return e ? codeFor(e) : null
}

/** Injected: types a one-time code into the page's 2FA box (or split digit boxes). */
export function otpFillJS(code) {
  return `(function(){
  try {
    var C = ${JSON.stringify(String(code || ''))};
    function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }
    function set(el, v){
      var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      if (d && d.set) d.set.call(el, v); else el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    var inputs = Array.prototype.filter.call(document.querySelectorAll('input:not([type=hidden]):not([type=password]):not([disabled])'), visible);
    var one = inputs.filter(function(i){ return (i.autocomplete || '').toLowerCase() === 'one-time-code' })[0]
      || inputs.filter(function(i){ var n = ((i.name || '') + ' ' + (i.id || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.placeholder || '')).toLowerCase();
           var ml = +i.maxLength; return /otp|2fa|totp|mfa|one.?time|verification|security code|passcode|\\bcode\\b|token/.test(n) && (ml < 0 || ml === 0 || (ml >= 6 && ml <= 10)); })[0];
    var boxes = inputs.filter(function(i){ return +i.maxLength === 1 });
    if (one) { one.focus(); set(one, C); }
    else if (boxes.length >= C.length) { for (var k = 0; k < C.length; k++) set(boxes[k], C[k]); }
    else { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ __bitOtpFilled: 0 })); return; }
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ __bitOtpFilled: 1 }));
  } catch (e) {}
})(); true;`
}
