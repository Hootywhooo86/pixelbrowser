// Bit Password Manager on the computer: logins, addresses and payment cards.
//
// Every entry is encrypted with the OS keychain (Electron safeStorage) in
// pixel-vault.json; a plain index (site + username, card last 4) lists them
// without decrypting. Sync matches the phone (apps/mobile/src/passwords.js):
// opt-in. With "Sync passwords" on, logins and addresses go out as
// 'passwords' / 'addresses' records (end-to-end encrypted by sync-core); card
// numbers only with "Sync cards". Once a record has been pushed, or has
// arrived from another device, its secret moves into the vault and the copy in
// pixel-records.json is stripped.

const crypto = require('node:crypto')
const { safeStorage } = require('electron')
const store = require('./store')

const file = new store.JsonFile('pixel-vault.json', { logins: {}, addresses: {}, cards: {}, index: { logins: {}, addresses: {}, cards: {} } })
for (const k of ['logins', 'addresses', 'cards']) {
  file.data[k] = file.data[k] || {}
  file.data.index = file.data.index || {}
  file.data.index[k] = file.data.index[k] || {}
}

const opts = () => store.settings.data.vault

function seal(obj) {
  const plain = JSON.stringify(obj)
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain) : Buffer.from(plain, 'utf8')
  return buf.toString('base64')
}

function open(value) {
  if (!value) return null
  try {
    const buf = Buffer.from(value, 'base64')
    return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8'))
  } catch {
    return null
  }
}

function save() {
  file.flush()
}

function originOf(url) {
  const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i)
  return m ? m[1].toLowerCase() : ''
}

// ---------- logins ----------

/** Index only (no passwords): [{ id, origin, username, updatedAt }]. */
function loginIndex() {
  return Object.entries(file.data.index.logins).map(([id, v]) => ({ id, ...v }))
}

function getLogin(id) {
  const v = open(file.data.logins[id])
  return v ? { id, origin: v.origin, username: v.username || '', password: v.password || '', updatedAt: v.updatedAt } : null
}

function findLogins(url) {
  const origin = originOf(url)
  if (!origin) return []
  return loginIndex()
    .filter((x) => x.origin === origin)
    .map((x) => getLogin(x.id))
    .filter(Boolean)
}

function hasLogin({ url, username = '', password }) {
  return findLogins(url).some((h) => h.username === username && h.password === password)
}

function storeLogin(id, data, { sync = true } = {}) {
  const updatedAt = data.updatedAt || Date.now()
  const entry = { origin: data.origin, username: data.username || '', password: data.password || '', updatedAt }
  file.data.logins[id] = seal(entry)
  file.data.index.logins[id] = { origin: entry.origin, username: entry.username, updatedAt }
  save()
  if (sync && opts().syncPasswords) store.putRecord('passwords', id, entry)
}

/** Save a login; updates the one for the same site + username. Returns its id. */
function saveLogin({ url, origin, username = '', password }) {
  const o = origin || originOf(url)
  if (!o || !password) return null
  const existing = loginIndex().find((x) => x.origin === o && x.username === username)
  const id = existing?.id || crypto.randomUUID()
  storeLogin(id, { origin: o, username, password })
  return id
}

function updateLogin(id, patch = {}) {
  const cur = getLogin(id)
  if (!cur) return
  const next = { origin: cur.origin, username: cur.username, password: cur.password }
  if (typeof patch.username === 'string') next.username = patch.username
  if (typeof patch.password === 'string' && patch.password) next.password = patch.password
  if (typeof patch.url === 'string') next.origin = originOf(patch.url) || cur.origin
  storeLogin(id, next)
}

function deleteLogin(id) {
  delete file.data.logins[id]
  delete file.data.index.logins[id]
  save()
  if (opts().syncPasswords || store.records.data.passwords[id]) store.putRecord('passwords', id, null, { deleted: true })
}

// ---------- addresses ----------

const ADDRESS_FIELDS = ['name', 'company', 'street', 'city', 'region', 'postal', 'country', 'phone', 'email']

function listAddresses() {
  return Object.keys(file.data.addresses)
    .map((id) => {
      const v = open(file.data.addresses[id])
      return v ? { id, ...v } : null
    })
    .filter(Boolean)
}

function storeAddress(id, data, { sync = true } = {}) {
  const updatedAt = data.updatedAt || Date.now()
  const entry = { updatedAt }
  for (const k of ADDRESS_FIELDS) if (data[k]) entry[k] = String(data[k]).slice(0, 200)
  file.data.addresses[id] = seal(entry)
  file.data.index.addresses[id] = { label: [entry.name, entry.street, entry.city].filter(Boolean).join(', ') || 'Address', updatedAt }
  save()
  if (sync && opts().syncPasswords) store.putRecord('addresses', id, entry)
}

function saveAddress(address) {
  const id = address.id || crypto.randomUUID()
  storeAddress(id, address)
  return id
}

function deleteAddress(id) {
  delete file.data.addresses[id]
  delete file.data.index.addresses[id]
  save()
  if (store.records.data.addresses[id]) store.putRecord('addresses', id, null, { deleted: true })
}

// ---------- payment cards ----------

function cardIndex() {
  return Object.entries(file.data.index.cards).map(([id, v]) => ({ id, ...v }))
}

function listCards() {
  return Object.keys(file.data.cards)
    .map((id) => {
      const v = open(file.data.cards[id])
      return v ? { id, ...v } : null
    })
    .filter(Boolean)
}

function storeCard(id, data, { sync = true } = {}) {
  const number = String(data.number || '').replace(/\D/g, '')
  const updatedAt = data.updatedAt || Date.now()
  const entry = { holder: data.holder || '', number, exp: data.exp || '', nickname: data.nickname || '', updatedAt }
  file.data.cards[id] = seal(entry)
  file.data.index.cards[id] = { holder: entry.holder, last4: number.slice(-4), exp: entry.exp, nickname: entry.nickname, updatedAt }
  save()
  // The full card number only leaves this computer if the user opted in.
  if (sync && opts().syncCards) store.putRecord('cards', id, entry)
}

function saveCard(card) {
  const id = card.id || crypto.randomUUID()
  storeCard(id, card)
  return id
}

function deleteCard(id) {
  delete file.data.cards[id]
  delete file.data.index.cards[id]
  save()
  if (store.records.data.cards[id]) store.putRecord('cards', id, null, { deleted: true })
}

// ---------- sync ----------

/** Push everything saved so far (when the user turns sync on). */
function pushAllForSync() {
  if (opts().syncPasswords) {
    for (const x of loginIndex()) {
      const l = getLogin(x.id)
      if (l) store.putRecord('passwords', l.id, { origin: l.origin, username: l.username, password: l.password, updatedAt: l.updatedAt })
    }
    for (const a of listAddresses()) {
      const { id, ...rest } = a
      store.putRecord('addresses', id, rest)
    }
  }
  if (opts().syncCards) {
    for (const c of listCards()) {
      const { id, ...rest } = c
      store.putRecord('cards', id, rest)
    }
  }
}

const COLLECTIONS = {
  passwords: { index: () => file.data.index.logins, store: storeLogin, remove: (id) => (delete file.data.logins[id], delete file.data.index.logins[id]) },
  addresses: { index: () => file.data.index.addresses, store: storeAddress, remove: (id) => (delete file.data.addresses[id], delete file.data.index.addresses[id]) },
  cards: { index: () => file.data.index.cards, store: storeCard, remove: (id) => (delete file.data.cards[id], delete file.data.index.cards[id]) },
}

/**
 * Move synced secrets into the vault and strip them from the record copies.
 * Call after every sync round.
 */
function applyRemote() {
  const me = store.settings.data.deviceId
  const pushedUpTo = store.settings.data.sync.lastPushedAt || 0
  let touched = false
  for (const [collection, c] of Object.entries(COLLECTIONS)) {
    for (const r of Object.values(store.records.data[collection] || {})) {
      const known = c.index()[r.id]
      if (r.deleted) {
        if (known && r.deviceId !== me && r.updatedAt >= (known.updatedAt || 0)) {
          c.remove(r.id)
          touched = true
        }
        continue
      }
      if (!r.data || r.data.stripped) continue
      const fromElsewhere = r.deviceId !== me
      if (fromElsewhere && (!known || r.updatedAt > (known.updatedAt || 0))) {
        c.store(r.id, { ...r.data, updatedAt: r.updatedAt }, { sync: false })
        touched = true
      }
      // Strip once the server has it (pushed by us, or pulled from it).
      if (fromElsewhere || r.updatedAt <= pushedUpTo) {
        r.data = { stripped: true }
        touched = true
      }
    }
  }
  if (touched) {
    save()
    store.records.save()
  }
}

function setOptions(patch = {}) {
  const o = opts()
  const wasP = o.syncPasswords
  const wasC = o.syncCards
  if (typeof patch.offerToSave === 'boolean') o.offerToSave = patch.offerToSave
  if (typeof patch.syncPasswords === 'boolean') o.syncPasswords = patch.syncPasswords
  if (typeof patch.syncCards === 'boolean') o.syncCards = patch.syncCards
  if (typeof patch.unblock === 'string') o.never = (o.never || []).filter((x) => x !== patch.unblock)
  store.settings.save()
  if ((!wasP && o.syncPasswords) || (!wasC && o.syncCards)) pushAllForSync()
}

function neverFor(url) {
  const o = originOf(url)
  if (!o) return
  const v = opts()
  v.never = [...new Set([...(v.never || []), o])].slice(-500)
  store.settings.save()
}

const isNever = (url) => (opts().never || []).includes(originOf(url))

/** Counts for Settings and the data dashboard (no secrets). */
function summary() {
  return {
    logins: loginIndex()
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username))
      .map((x) => ({ id: x.id, origin: x.origin, username: x.username })),
    addresses: Object.entries(file.data.index.addresses).map(([id, v]) => ({ id, label: v.label })),
    cards: cardIndex().map((c) => ({ id: c.id, holder: c.holder, last4: c.last4, exp: c.exp, nickname: c.nickname })),
    options: { offerToSave: opts().offerToSave, syncPasswords: opts().syncPasswords, syncCards: opts().syncCards, never: opts().never || [] },
  }
}

function wipe() {
  for (const id of Object.keys(file.data.logins)) deleteLogin(id)
  for (const id of Object.keys(file.data.addresses)) deleteAddress(id)
  for (const id of Object.keys(file.data.cards)) deleteCard(id)
}

// ---------- page scripts ----------
// Tabs have no preload, so the page script talks back through console
// messages that main.js reads (wc 'console-message'). Only the username and
// password travel that way; the site is taken from the tab's own URL.

const CAPTURE_LOGIN_JS = `(function(){
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
      if (!user) { try { user = sessionStorage.getItem('__bitUser') || '' } catch (e) {} }
      var key = location.host + '|' + user + '|' + pw.value;
      if (window.__bitLastLogin === key) return; window.__bitLastLogin = key;
      console.debug('__bitLogin:' + JSON.stringify({ username: user, password: pw.value }));
    } catch (e) {}
  }
  document.addEventListener('change', function(e){
    var el = e.target; if (!el || el.tagName !== 'INPUT' || !el.value) return;
    var t = (el.type || 'text').toLowerCase(), ac = (el.autocomplete || '').toLowerCase(), n = (el.name || el.id || '').toLowerCase();
    if (t === 'email' || ac === 'username' || ac === 'email' || /user|email|login|identifier/.test(n)) { try { sessionStorage.setItem('__bitUser', el.value) } catch (x) {} }
  }, true);
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
  var asked = typeof WeakSet === 'function' ? new WeakSet() : null;
  function check(){
    try {
      var pw = Array.prototype.filter.call(document.querySelectorAll('input[type=password]'), function(e){ return !e.value && visible(e); })[0];
      if (!pw || !asked || asked.has(pw)) return; asked.add(pw);
      console.debug('__bitNeedFill');
    } catch (e) {}
  }
  check();
  try { new MutationObserver(function(){ clearTimeout(window.__bitFillT); window.__bitFillT = setTimeout(check, 400) }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'style', 'class', 'hidden'] }) } catch (e) {}
})();`

/** JS that fills a saved login into the page's login form. */
function autofillJS(username, password) {
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
    return !!(pw || user);
  } catch (e) { return false }
})()`
}

module.exports = {
  originOf,
  loginIndex,
  getLogin,
  findLogins,
  hasLogin,
  saveLogin,
  updateLogin,
  deleteLogin,
  listAddresses,
  saveAddress,
  deleteAddress,
  listCards,
  saveCard,
  deleteCard,
  pushAllForSync,
  applyRemote,
  setOptions,
  neverFor,
  isNever,
  summary,
  wipe,
  CAPTURE_LOGIN_JS,
  autofillJS,
  ADDRESS_FIELDS,
}
