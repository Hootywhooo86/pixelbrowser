// Tor mode: send all browsing through Tor using the Orbot app.
//
// Android WebView can route requests through a proxy, but only for the whole
// app (every tab), not one tab, so Tor mode covers normal and private tabs
// while it's on. Orbot (the Tor Project's app) runs Tor and listens on
// 127.0.0.1:9050 (SOCKS) and 127.0.0.1:8118 (HTTP). There's no fallback to a
// direct connection: if Tor stops, pages fail to load instead of leaking.
//
// Embedding Tor itself (Arti or tor-android) would add roughly 15-30 MB per
// CPU type to the app; Orbot keeps the app small and gets Tor updates from the
// Tor Project directly.

import { Platform, Linking } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { getState, update } from './store'

const native = Platform.OS === 'android' ? requireOptionalNativeModule('BitShields') : null

export const ORBOT_PLAY = 'https://play.google.com/store/apps/details?id=org.torproject.android'
export const TOR_CHECK_URL = 'https://check.torproject.org/'
const SOCKS = 9050
const HTTP = 8118

/** What Tor mode can do on this phone. */
export function torSupport() {
  if (Platform.OS !== 'android') return { ok: false, why: 'Tor mode needs Android. On iPhone, use the Orbot app’s VPN mode instead.' }
  if (!native?.proxySupported) return { ok: false, why: 'This build of Bit Browser has no Tor support.' }
  if (!native.proxySupported()) return { ok: false, why: "This phone's Android System WebView is too old for Tor mode. Update it from the Play Store." }
  return { ok: true, orbot: !!native.orbotInstalled?.() }
}

export const torOn = () => !!getState()?.torMode

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Turn Tor mode on. status(text) gets progress messages.
 * Resolves { ok: true } or { ok: false, why, needsOrbot? }.
 */
export async function enableTor(status = () => {}) {
  const sup = torSupport()
  if (!sup.ok) return { ok: false, why: sup.why }
  if (!sup.orbot) return { ok: false, needsOrbot: true, why: 'Install Orbot (free, from the Tor Project) to use Tor mode.' }
  status('Starting Tor in Orbot…')
  native.startOrbot()
  let ready = false
  for (let i = 0; i < 40 && !ready; i++) {
    ready = (await native.portOpen(SOCKS).catch(() => false)) || (await native.portOpen(HTTP).catch(() => false))
    if (!ready) {
      if (i === 6) native.openOrbot?.() // Orbot may need to be opened once to start
      await wait(1000)
    }
  }
  if (!ready) return { ok: false, why: "Orbot didn't start Tor. Open Orbot, tap START, then try again." }
  status('Connecting through Tor…')
  try {
    await native.setProxy([`socks5://127.0.0.1:${SOCKS}`, `127.0.0.1:${HTTP}`])
  } catch (e) {
    return { ok: false, why: String(e?.message || e) }
  }
  update((s) => (s.torMode = true))
  return { ok: true }
}

export async function disableTor() {
  try {
    await native?.clearProxy?.()
  } catch {}
  update((s) => (s.torMode = false))
}

/** On app start: if Tor mode was on, put the proxy back (or turn it off if Orbot isn't running). */
export async function restoreTor() {
  if (!torOn() || !native?.setProxy) return
  const up = (await native.portOpen(SOCKS).catch(() => false)) || (await native.portOpen(HTTP).catch(() => false))
  if (!up) native.startOrbot?.()
  // Keep the proxy even if Tor is still starting: pages wait rather than leak.
  try {
    await native.setProxy([`socks5://127.0.0.1:${SOCKS}`, `127.0.0.1:${HTTP}`])
  } catch {
    update((s) => (s.torMode = false))
  }
}

export const getOrbot = () => Linking.openURL(ORBOT_PLAY)
