// Bit Password Manager: logins, addresses and payment cards.
//
// Every secret lives in the iOS Keychain / Android Keystore (expo-secure-store),
// one item per entry. The app state only keeps an index (site + username, card
// last 4 digits) so lists render without unlocking anything.
//
// Sync is opt-in. With "Sync passwords" on, logins and addresses are written as
// 'passwords' / 'addresses' records, which sync-core encrypts end to end before
// upload. Once a record has been pushed (or arrived from another device) its
// secret is moved into SecureStore and stripped from the local record, so it
// doesn't sit in AsyncStorage. Card numbers are only synced with "Sync cards".
// Call startPasswordSync() once at app start.

import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import { getState, update, putRecord, onStoreChange } from './store'

const LOGIN = (id) => `pw_${id}`
const ADDR = (id) => `addr_${id}`
const CARD = (id) => `card_${id}`

export function originOf(url) {
  try {
    const m = String(url).match(/^(https?:\/\/[^/?#]+)/i)
    return m ? m[1].toLowerCase() : ''
  } catch {
    return ''
  }
}

async function readJson(key) {
  try {
    const raw = await SecureStore.getItemAsync(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const writeJson = (key, value) => SecureStore.setItemAsync(key, JSON.stringify(value))

// ---------- logins ----------

/** Index only (no passwords): [{ id, origin, username, updatedAt }]. */
export function loginIndex() {
  return getState().passwordIndex || []
}

/** Every login with its password. Unlock first (see unlock()). */
export async function listLogins() {
  const out = []
  for (const i of loginIndex()) {
    const v = await readJson(LOGIN(i.id))
    if (v) out.push({ id: i.id, origin: v.origin, username: v.username, password: v.password, updatedAt: v.updatedAt })
  }
  return out
}

/** Saved logins for the site of this URL. */
export async function findLogins(url) {
  const origin = originOf(url)
  if (!origin) return []
  const out = []
  for (const i of loginIndex().filter((x) => x.origin === origin)) {
    const v = await readJson(LOGIN(i.id))
    if (v) out.push({ id: i.id, origin: v.origin, username: v.username, password: v.password })
  }
  return out
}

/** True if this exact login is already saved (used before offering to save). */
export async function hasLogin({ url, username, password }) {
  const hits = await findLogins(url)
  return hits.some((h) => h.username === (username || '') && h.password === password)
}

async function storeLogin(id, data, { sync = true } = {}) {
  const updatedAt = data.updatedAt || Date.now()
  const entry = { origin: data.origin, username: data.username || '', password: data.password || '', updatedAt }
  await writeJson(LOGIN(id), entry)
  update((s) => {
    s.passwordIndex = [...(s.passwordIndex || []).filter((x) => x.id !== id), { id, origin: entry.origin, username: entry.username, updatedAt }]
  })
  if (sync && getState().syncPasswords) putRecord('passwords', id, entry)
}

/** Save a login; updates the existing one for the same site + username. */
export async function saveLogin({ url, origin, username = '', password }) {
  const o = origin || originOf(url)
  if (!o || !password) return null
  const existing = loginIndex().find((x) => x.origin === o && x.username === username)
  const id = existing?.id || Crypto.randomUUID()
  await storeLogin(id, { origin: o, username, password })
  return id
}

export async function updateLogin(id, patch) {
  const cur = await readJson(LOGIN(id))
  if (!cur) return
  const next = { ...cur, ...patch, updatedAt: Date.now() }
  if (patch.url) next.origin = originOf(patch.url) || cur.origin
  delete next.url
  await storeLogin(id, next)
}

export async function deleteLogin(id) {
  await SecureStore.deleteItemAsync(LOGIN(id)).catch(() => {})
  update((s) => (s.passwordIndex = (s.passwordIndex || []).filter((x) => x.id !== id)))
  if (getState().syncPasswords || getState().records.passwords?.[id]) putRecord('passwords', id, null, { deleted: true })
}

// ---------- addresses ----------

export function addressIndex() {
  return getState().addressIndex || []
}

export async function listAddresses() {
  const out = []
  for (const i of addressIndex()) {
    const v = await readJson(ADDR(i.id))
    if (v) out.push({ id: i.id, ...v })
  }
  return out
}

async function storeAddress(id, data, { sync = true } = {}) {
  const updatedAt = data.updatedAt || Date.now()
  const entry = { ...data, updatedAt }
  delete entry.id
  await writeJson(ADDR(id), entry)
  const label = [entry.name, entry.street, entry.city].filter(Boolean).join(', ') || 'Address'
  update((s) => (s.addressIndex = [...(s.addressIndex || []).filter((x) => x.id !== id), { id, label, updatedAt }]))
  if (sync && getState().syncPasswords) putRecord('addresses', id, entry)
}

/** Fields: name, street, city, region, postal, country, phone, email. Pass id to edit. */
export async function saveAddress(address) {
  const id = address.id || Crypto.randomUUID()
  await storeAddress(id, address)
  return id
}

export async function deleteAddress(id) {
  await SecureStore.deleteItemAsync(ADDR(id)).catch(() => {})
  update((s) => (s.addressIndex = (s.addressIndex || []).filter((x) => x.id !== id)))
  if (getState().records.addresses?.[id]) putRecord('addresses', id, null, { deleted: true })
}

// ---------- payment cards ----------

export function cardIndex() {
  return getState().cardIndex || []
}

export async function listCards() {
  const out = []
  for (const i of cardIndex()) {
    const v = await readJson(CARD(i.id))
    if (v) out.push({ id: i.id, ...v })
  }
  return out
}

async function storeCard(id, data, { sync = true } = {}) {
  const number = String(data.number || '').replace(/\D/g, '')
  const updatedAt = data.updatedAt || Date.now()
  const entry = { holder: data.holder || '', number, exp: data.exp || '', nickname: data.nickname || '', updatedAt }
  await writeJson(CARD(id), entry)
  const meta = { id, holder: entry.holder, last4: number.slice(-4), exp: entry.exp, updatedAt }
  update((s) => (s.cardIndex = [...(s.cardIndex || []).filter((x) => x.id !== id), meta]))
  // The full card number only leaves this phone if the user opted in.
  if (sync && getState().syncCards) putRecord('cards', id, entry)
}

/** Fields: holder, number, exp (MM/YY), nickname. Pass id to edit. */
export async function saveCard(card) {
  const id = card.id || Crypto.randomUUID()
  await storeCard(id, card)
  return id
}

export async function deleteCard(id) {
  await SecureStore.deleteItemAsync(CARD(id)).catch(() => {})
  update((s) => (s.cardIndex = (s.cardIndex || []).filter((x) => x.id !== id)))
  if (getState().records.cards?.[id]) putRecord('cards', id, null, { deleted: true })
}

// ---------- sync ----------

/** Push everything saved so far (used when the user turns sync on). */
export async function pushAllForSync() {
  const s = getState()
  if (s.syncPasswords) {
    for (const l of await listLogins()) putRecord('passwords', l.id, { origin: l.origin, username: l.username, password: l.password, updatedAt: l.updatedAt })
    for (const a of await listAddresses()) {
      const { id, ...rest } = a
      putRecord('addresses', id, rest)
    }
  }
  if (s.syncCards) for (const c of await listCards()) {
    const { id, ...rest } = c
    putRecord('cards', id, rest)
  }
}

const COLLECTIONS = {
  passwords: { secret: 'password', index: () => loginIndex(), key: LOGIN, store: storeLogin, remove: (id) => SecureStore.deleteItemAsync(LOGIN(id)), field: 'passwordIndex' },
  addresses: { secret: 'street', index: () => addressIndex(), key: ADDR, store: storeAddress, remove: (id) => SecureStore.deleteItemAsync(ADDR(id)), field: 'addressIndex' },
  cards: { secret: 'number', index: () => cardIndex(), key: CARD, store: storeCard, remove: (id) => SecureStore.deleteItemAsync(CARD(id)), field: 'cardIndex' },
}

let applying = false

/**
 * Move synced secrets into SecureStore and strip them from the local records.
 * Safe to call any time; startPasswordSync() calls it after every store change.
 */
export async function applyRemotePasswords() {
  if (applying) return
  applying = true
  try {
    const s = getState()
    for (const [collection, c] of Object.entries(COLLECTIONS)) {
      const recs = s.records[collection] || {}
      for (const r of Object.values(recs)) {
        const known = c.index().find((x) => x.id === r.id)
        if (r.deleted) {
          if (known && r.deviceId !== s.deviceId && r.updatedAt >= (known.updatedAt || 0)) {
            await c.remove(r.id).catch(() => {})
            update((st) => (st[c.field] = (st[c.field] || []).filter((x) => x.id !== r.id)))
          }
          continue
        }
        if (!r.data || r.data.stripped) continue
        const fromElsewhere = r.deviceId !== s.deviceId
        if (fromElsewhere && (!known || r.updatedAt > (known.updatedAt || 0))) await c.store(r.id, { ...r.data, updatedAt: r.updatedAt }, { sync: false })
        // Strip once the server has it (pushed by us, or pulled from it).
        if (fromElsewhere || r.updatedAt <= (s.sync.lastPushedAt || 0)) {
          update((st) => {
            const cur = st.records[collection][r.id]
            if (cur && cur.updatedAt === r.updatedAt && cur.data) cur.data = { stripped: true }
          })
        }
      }
    }
  } finally {
    applying = false
  }
}

let started = false
let timer = null

export function startPasswordSync() {
  if (started) return
  started = true
  onStoreChange(() => {
    clearTimeout(timer)
    timer = setTimeout(() => applyRemotePasswords().catch(() => {}), 300)
  })
  applyRemotePasswords().catch(() => {})
}

// ---------- unlock ----------

/** Ask for fingerprint/face/PIN before showing passwords. Resolves true if allowed. */
export async function unlock(reason = 'Unlock Bit Password Manager') {
  try {
    const LocalAuth = require('expo-local-authentication')
    const hasHw = await LocalAuth.hasHardwareAsync()
    const enrolled = hasHw && (await LocalAuth.isEnrolledAsync())
    if (!enrolled) {
      // No biometrics: fall back to the device PIN/pattern if one is set.
      const level = await LocalAuth.getEnrolledLevelAsync?.()
      if (!level) return true
    }
    const res = await LocalAuth.authenticateAsync({ promptMessage: reason, disableDeviceFallback: false })
    return !!res.success
  } catch {
    return false
  }
}

// ---------- page scripts ----------

/**
 * Injected into every page. When a form with a password field is submitted,
 * posts { __bitLogin: { url, username, password } } to the app, which offers to save it.
 */
export const CAPTURE_LOGIN_JS = `(function(){
  if (window.__bitLoginHook) return; window.__bitLoginHook = true;
  function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }
  function grab(form){
    try {
      var root = form || document;
      var pw = Array.prototype.filter.call(root.querySelectorAll('input[type=password]'), function(e){ return e.value && visible(e); })[0];
      if (!pw) return;
      var inputs = Array.prototype.slice.call(root.querySelectorAll('input'));
      var user = '';
      for (var i = inputs.indexOf(pw) - 1; i >= 0; i--) {
        var t = (inputs[i].type || 'text').toLowerCase();
        if ((t === 'text' || t === 'email' || t === 'tel') && inputs[i].value) { user = inputs[i].value; break; }
      }
      if (!user) { var u = root.querySelector('input[autocomplete=username],input[type=email],input[name*=user i],input[name*=email i]'); if (u) user = u.value || ''; }
      var key = location.host + '|' + user + '|' + pw.value;
      if (window.__bitLastLogin === key) return; window.__bitLastLogin = key;
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ __bitLogin: { url: location.href, username: user, password: pw.value } }));
    } catch (e) {}
  }
  document.addEventListener('submit', function(e){ grab(e.target); }, true);
  document.addEventListener('click', function(e){
    var b = e.target && e.target.closest && e.target.closest('button,input[type=submit],[role=button]');
    if (!b) return;
    var f = b.form || b.closest('form');
    if (f ? f.querySelector('input[type=password]') : document.querySelector('input[type=password]')) setTimeout(function(){ grab(f); }, 0);
  }, true);
  document.addEventListener('keydown', function(e){
    if (e.key === 'Enter' && e.target && e.target.form && e.target.form.querySelector('input[type=password]')) grab(e.target.form);
  }, true);
})(); true;`

/** JS that fills a saved login into the page's login form. */
export function autofillJS(username, password) {
  return `(function(){
  try {
    var U = ${JSON.stringify(String(username || ''))}, P = ${JSON.stringify(String(password || ''))};
    function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }
    function set(el, v){
      var proto = Object.getPrototypeOf(el); var d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d && d.set) d.set.call(el, v); else el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    var pw = Array.prototype.filter.call(document.querySelectorAll('input[type=password]'), visible)[0];
    var inputs = Array.prototype.slice.call(document.querySelectorAll('input')).filter(visible);
    var user = null;
    if (pw) {
      for (var i = inputs.indexOf(pw) - 1; i >= 0; i--) {
        var t = (inputs[i].type || 'text').toLowerCase();
        if (t === 'text' || t === 'email' || t === 'tel') { user = inputs[i]; break; }
      }
    }
    if (!user) user = document.querySelector('input[autocomplete=username],input[type=email]');
    if (user && U) set(user, U);
    if (pw) set(pw, P);
  } catch (e) {}
})(); true;`
}
