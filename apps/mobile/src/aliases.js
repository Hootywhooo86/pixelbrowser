// "Hide my email": sign up for sites with a throwaway address that forwards
// to your real inbox, through SimpleLogin or addy.io with your own API key.
// The key is kept in the phone's secure storage; the provider choice in
// state.aliases = { provider: 'simplelogin' | 'addy', baseUrl }.

import { getState, update, getSecret, setSecret } from './store'

export const ALIAS_PROVIDERS = {
  simplelogin: { label: 'SimpleLogin', baseUrl: 'https://app.simplelogin.io', keyHelp: 'SimpleLogin → Settings → API Keys → Create', signup: 'https://simplelogin.io' },
  addy: { label: 'addy.io', baseUrl: 'https://app.addy.io', keyHelp: 'addy.io → Settings → API → Generate new token', signup: 'https://addy.io' },
}

const keyName = (p) => `alias:${p}`

export function aliasSettings() {
  const a = getState()?.aliases || {}
  const provider = ALIAS_PROVIDERS[a.provider] ? a.provider : null
  return { provider, baseUrl: (a.baseUrl || (provider && ALIAS_PROVIDERS[provider].baseUrl) || '').replace(/\/+$/, '') }
}

/** Connected = a provider and its API key are saved. */
export async function isConnected() {
  const { provider } = aliasSettings()
  return !!(provider && (await getSecret(keyName(provider))))
}

/** Save the provider and key; checks the key with the provider first. */
export async function connectAliases(provider, apiKey, baseUrl = '') {
  if (!ALIAS_PROVIDERS[provider]) throw new Error('Pick SimpleLogin or addy.io.')
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('Paste your API key.')
  const base = (baseUrl || ALIAS_PROVIDERS[provider].baseUrl).replace(/\/+$/, '')
  await listAliasesWith(provider, key, base) // throws with a clear message if the key is wrong
  await setSecret(keyName(provider), key)
  update((s) => (s.aliases = { provider, baseUrl: base }))
}

export async function disconnectAliases() {
  const { provider } = aliasSettings()
  if (provider) await setSecret(keyName(provider), '')
  update((s) => (s.aliases = {}))
}

async function call(provider, key, base, path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
  if (provider === 'simplelogin') headers.Authentication = key
  else {
    headers.Authorization = `Bearer ${key}`
    headers['X-Requested-With'] = 'XMLHttpRequest'
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  if (res.status === 401 || res.status === 403) throw new Error(`${ALIAS_PROVIDERS[provider].label} didn't accept that API key.`)
  if (!res.ok) throw new Error(`${ALIAS_PROVIDERS[provider].label} said ${res.status}. Try again in a moment.`)
  return res.json()
}

async function listAliasesWith(provider, key, base) {
  if (provider === 'simplelogin') {
    const j = await call(provider, key, base, '/api/v2/aliases?page_id=0')
    return (j.aliases || []).map((a) => ({ id: String(a.id), email: a.email, note: a.note || '', active: a.enabled !== false }))
  }
  const j = await call(provider, key, base, '/api/v1/aliases?page[size]=50')
  return (j.data || []).map((a) => ({ id: String(a.id), email: a.email, note: a.description || '', active: a.active !== false }))
}

async function creds() {
  const { provider, baseUrl } = aliasSettings()
  const key = provider && (await getSecret(keyName(provider)))
  if (!key) throw new Error('Connect SimpleLogin or addy.io first (Settings → Passwords and autofill → Hide my email).')
  return { provider, key, base: baseUrl }
}

/** Your aliases, newest first. */
export async function listAliases() {
  const { provider, key, base } = await creds()
  return listAliasesWith(provider, key, base)
}

/** Make a new alias; `note` is usually the site it's for. Returns the email address. */
export async function createAlias(note = '') {
  const { provider, key, base } = await creds()
  if (provider === 'simplelogin') {
    const j = await call(provider, key, base, '/api/alias/random/new?mode=word', { method: 'POST', body: { note } })
    if (!j.alias) throw new Error('SimpleLogin did not return an alias.')
    return j.alias
  }
  const j = await call(provider, key, base, '/api/v1/aliases', { method: 'POST', body: { description: note, format: 'random_words' } })
  if (!j.data?.email) throw new Error('addy.io did not return an alias.')
  return j.data.email
}

/** Page script: put an email address into the focused (or first visible) email field. */
export function fillAliasJS(email) {
  return `(function(){
  try {
    var E = ${JSON.stringify(String(email || ''))};
    function vis(el){ return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)) }
    var a = document.activeElement;
    var el = a && a.tagName === 'INPUT' && /email|text/i.test(a.type || 'text') ? a : null;
    if (!el) el = Array.prototype.filter.call(document.querySelectorAll('input[type=email],input[autocomplete=email],input[name*=email i],input[id*=email i]'), vis)[0];
    if (!el) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ __bitAlias: { filled: false } })); return; }
    var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (d && d.set) d.set.call(el, E); else el.value = E;
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ __bitAlias: { filled: true } }));
  } catch (e) {}
})(); true;`
}
