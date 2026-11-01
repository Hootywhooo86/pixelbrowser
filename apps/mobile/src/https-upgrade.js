// HTTPS upgrade: http:// addresses are tried over https:// first. If the
// secure version fails (no certificate, connection refused…), the site is
// remembered as http-only and loaded over http, marked "not secure".
// Setting: state.httpsUpgrade (on unless set to false). Learned hosts live
// in state.httpOnlyHosts on this device only.

import { getState, update } from './store'
import { upgradeUrl as upgradeCore, isUpgradeFailure, hostOfUrl } from './web-tools-core'

export { isUpgradeFailure }

const httpOnly = () => new Set(getState()?.httpOnlyHosts || [])
const pending = new Map() // tabId -> { https, http } while an upgraded load is in flight

export const httpsUpgradeOn = () => getState()?.httpsUpgrade !== false

/** https:// version of an http:// URL, or null to load it as is. */
export function upgradeUrl(url) {
  if (!httpsUpgradeOn()) return null
  return upgradeCore(url, httpOnly())
}

/** Remember that a site only works over http. */
export function onUpgradeFailed(urlOrHost) {
  const host = /^[a-z]+:/i.test(String(urlOrHost)) ? hostOfUrl(urlOrHost) : String(urlOrHost).toLowerCase()
  if (!host) return
  update((s) => {
    const list = new Set(s.httpOnlyHosts || [])
    list.add(host.replace(/^www\./, ''))
    s.httpOnlyHosts = [...list].slice(-500)
  })
}

/** Track an upgraded load so a failure can fall back to http. */
export function noteUpgrade(tabId, httpUrl, httpsUrl) {
  pending.set(tabId, { http: httpUrl, https: httpsUrl })
}

/**
 * Call from the WebView's onError. Returns the http:// URL to load instead
 * when the failure was our upgrade, else null.
 */
export function fallbackFor(tabId, failedUrl, description, code) {
  const p = pending.get(tabId)
  if (!p) return null
  const sameHost = hostOfUrl(failedUrl || p.https) === hostOfUrl(p.https)
  if (!sameHost || !isUpgradeFailure(description, code)) return null
  pending.delete(tabId)
  onUpgradeFailed(p.http)
  return p.http
}

/** Call from onLoadEnd: the upgraded page loaded (or the user moved on). */
export function clearUpgrade(tabId) {
  pending.delete(tabId)
}

/** Forget learned http-only sites (Settings → Shields & privacy). */
export function resetHttpOnly() {
  update((s) => (s.httpOnlyHosts = []))
}
