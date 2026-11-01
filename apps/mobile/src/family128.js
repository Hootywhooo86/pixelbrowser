// 128bit family accounts: one sign-in shared by the family apps (Bit
// Browser, 128bitlife, BitCaller, 128bittracker). Bit Browser sends the
// events you chose to share (see ./events) and reads back XP, streaks and
// quests. The API is described in docs/128bit-api.md.
//
// There is no 128bit server yet: until state.family.server is set, the
// screen shows "coming soon" and nothing is sent anywhere.

import { getState, update, getSecret, setSecret } from './store'

const TOKEN = 'family128:token'

export const familyServer = () => String(getState()?.family?.server || '').replace(/\/+$/, '')
export const familyReady = () => !!familyServer()

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const base = familyServer()
  if (!base) throw new Error('128bit accounts are coming soon.')
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Client': 'bitbrowser' }
  if (auth) {
    const token = await getSecret(TOKEN)
    if (!token) throw new Error('Sign in to your 128bit account first.')
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  if (res.status === 401) {
    await setSecret(TOKEN, '')
    update((s) => (s.family = { ...s.family, connected: false }))
    throw new Error('Your 128bit sign-in expired. Sign in again.')
  }
  if (res.status === 429) throw new Error('Too many tries. Wait a minute and try again.')
  if (!res.ok) {
    let msg = ''
    try {
      msg = (await res.json()).error || ''
    } catch {}
    throw new Error(msg || `The 128bit server said ${res.status}.`)
  }
  return res.status === 204 ? {} : res.json()
}

/** Set (or clear) the 128bit server address, e.g. https://api.128bit.example. */
export function setFamilyServer(url) {
  update((s) => (s.family = { ...s.family, server: String(url || '').trim() }))
}

/** Step 1: email a sign-in code. Returns a challenge id. */
export async function startSignIn(email) {
  const e = String(email || '').trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Type your email address.')
  const j = await api('/v1/auth/start', { method: 'POST', body: { email: e, app: 'bitbrowser' }, auth: false })
  return j.challengeId
}

/** Step 2: the 6-digit code from the email. Signs in on success. */
export async function finishSignIn(challengeId, code) {
  const j = await api('/v1/auth/verify', { method: 'POST', body: { challengeId, code: String(code || '').trim(), device: { app: 'bitbrowser', id: getState().deviceId, name: getState().deviceName } }, auth: false })
  if (!j.token) throw new Error('The server did not return a sign-in.')
  await setSecret(TOKEN, j.token)
  update((s) => (s.family = { ...s.family, connected: true, account: j.account || null }))
  await syncFamily().catch(() => {})
  return j.account
}

export async function signOut() {
  await api('/v1/auth/session', { method: 'DELETE' }).catch(() => {})
  await setSecret(TOKEN, '')
  update((s) => (s.family = { ...s.family, connected: false, account: null, queue: [] }))
}

/** Send queued events (only types you chose to share), then pull XP, streak and quests. */
export async function syncFamily() {
  const f = getState()?.family || {}
  if (!f.connected || !familyReady()) return null
  const queue = f.queue || []
  if (queue.length) {
    const batch = queue.slice(0, 100)
    await api('/v1/events', { method: 'POST', body: { events: batch } })
    update((s) => (s.family = { ...s.family, queue: (s.family.queue || []).slice(batch.length) }))
  }
  const p = await api('/v1/me/progress')
  update((s) => (s.family = { ...s.family, xp: p.xp ?? s.family.xp, streak: p.streak ?? s.family.streak, level: p.level ?? null, quests: p.quests || [], badges: p.badges || [], lastSync: Date.now() }))
  return p
}
