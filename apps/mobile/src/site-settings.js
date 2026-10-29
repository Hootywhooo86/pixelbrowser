// Per-site settings: desktop site, camera/microphone/location, text size and
// "always translate". Stored in state.siteSettings and synced to your other
// devices as the settings record 'site-settings'.
//
// Android's web view gives any site camera, microphone and location once the
// app itself has that permission, with no per-site question. So the page
// script below (permissionsJS) sits in front of getUserMedia and geolocation:
// "block" refuses, "allow" lets it through, and "ask" asks the app, which
// shows an Allow/Block prompt and can remember the answer for the site.

import { Platform } from 'react-native'
import { getState, update, putRecord, useStore } from './store'

export const PERMISSIONS = ['camera', 'microphone', 'location']
const DEFAULTS = { desktop: false, camera: 'ask', microphone: 'ask', location: 'ask', notifications: 'block', textZoom: 0, translate: false }

/** A desktop Chrome user agent, for "Desktop site". */
export const DESKTOP_UA =
  Platform.OS === 'ios'
    ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

/** The site key: host without "www.". */
export function hostKey(urlOrHost) {
  let h = String(urlOrHost || '')
  try {
    if (/^[a-z]+:/i.test(h)) h = new URL(h).hostname
  } catch {}
  return h.toLowerCase().replace(/^www\./, '')
}

/** Settings for a site (defaults filled in). Accepts a URL or a host. */
export function getSite(urlOrHost) {
  const key = hostKey(urlOrHost)
  return { ...DEFAULTS, ...((key && getState()?.siteSettings?.[key]) || {}) }
}

/** Change settings for a site; synced to your other devices. */
export function setSite(urlOrHost, patch) {
  const key = hostKey(urlOrHost)
  if (!key) return
  update((s) => {
    const cur = { ...((s.siteSettings || {})[key] || {}), ...patch }
    // Drop values that match the defaults so the record stays small.
    for (const k of Object.keys(cur)) if (cur[k] === DEFAULTS[k]) delete cur[k]
    const next = { ...(s.siteSettings || {}) }
    if (Object.keys(cur).length) next[key] = cur
    else delete next[key]
    s.siteSettings = next
    s.updatedAt = { ...s.updatedAt, siteSettings: Date.now() }
  })
  putRecord('settings', 'site-settings', getState().siteSettings)
}

/** Forget everything set for a site. */
export function resetSite(urlOrHost) {
  const key = hostKey(urlOrHost)
  update((s) => {
    const next = { ...(s.siteSettings || {}) }
    delete next[key]
    s.siteSettings = next
  })
  putRecord('settings', 'site-settings', getState().siteSettings)
}

/** React hook: the settings for a site, re-rendering when they change. */
export function useSite(urlOrHost) {
  const key = hostKey(urlOrHost)
  const raw = useStore((s) => (key && s.siteSettings?.[key]) || null)
  return { ...DEFAULTS, ...(raw || {}) }
}

/** Take site settings from another device after sync (call from applyRemoteSettings). */
export function applyRemoteSiteSettings() {
  const s = getState()
  const rec = s?.records?.settings?.['site-settings']
  if (!rec || rec.deleted || !rec.data || rec.deviceId === s.deviceId) return false
  if ((s.updatedAt?.siteSettings || 0) >= rec.updatedAt) return false
  update((st) => {
    st.siteSettings = { ...rec.data }
    st.updatedAt = { ...st.updatedAt, siteSettings: rec.updatedAt }
  })
  return true
}

/**
 * Page script (inject before content loads, in every frame) that gates
 * camera, microphone and location by the site's setting. For "ask" it posts
 * { __bitPermission: { id, kinds: ['camera'|'microphone'|'location'], host } }
 * and waits for the app to answer with permissionReplyJS(id, allow).
 */
export function permissionsJS(site) {
  const cfg = JSON.stringify({ camera: site.camera, microphone: site.microphone, location: site.location })
  return String.raw`(function(){
  if (window.__bitPerm) return; window.__bitPerm = true;
  var cfg = ${cfg}, waiting = {}, n = 0, granted = {};
  function post(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)) } catch (e) {} }
  window.__bitPermReply = function(id, allow){ var w = waiting[id]; if (!w) return; delete waiting[id]; if (allow) w.kinds.forEach(function(k){ granted[k] = true }); w.done(!!allow) };
  function decide(kinds, cb){
    var blocked = kinds.some(function(k){ return cfg[k] === 'block' });
    if (blocked) return cb(false);
    var ask = kinds.filter(function(k){ return cfg[k] !== 'allow' && !granted[k] });
    if (!ask.length) return cb(true);
    var id = 'p' + (++n) + Date.now();
    waiting[id] = { kinds: ask, done: cb };
    post({ __bitPermission: { id: id, kinds: ask, host: location.hostname } });
  }
  function denied(){ var e; try { e = new DOMException('Permission denied by Bit Browser', 'NotAllowedError') } catch (x) { e = new Error('Permission denied'); e.name = 'NotAllowedError' } return e }
  var md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    var gum = md.getUserMedia.bind(md);
    md.getUserMedia = function(c){
      c = c || {}; var kinds = []; if (c.video) kinds.push('camera'); if (c.audio) kinds.push('microphone');
      if (!kinds.length) return gum(c);
      return new Promise(function(res, rej){ decide(kinds, function(ok){ ok ? gum(c).then(res, rej) : rej(denied()) }) });
    };
  }
  var geo = navigator.geolocation;
  if (geo) {
    var get = geo.getCurrentPosition.bind(geo), watch = geo.watchPosition.bind(geo);
    var err = { code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
    geo.getCurrentPosition = function(ok, bad, o){ decide(['location'], function(y){ y ? get(ok, bad, o) : bad && bad(err) }) };
    var ids = {}, wn = 0;
    geo.watchPosition = function(ok, bad, o){ var my = ++wn; decide(['location'], function(y){ if (y) ids[my] = watch(ok, bad, o); else bad && bad(err) }); return my };
    var clr = geo.clearWatch.bind(geo);
    geo.clearWatch = function(id){ if (ids[id] !== undefined) clr(ids[id]); delete ids[id] };
  }
})();true;`
}

/** Answer a { __bitPermission } request from the page. */
export function permissionReplyJS(id, allow) {
  return `window.__bitPermReply && window.__bitPermReply(${JSON.stringify(String(id))}, ${allow ? 'true' : 'false'});true;`
}

/**
 * Pull to refresh on Android (react-native-webview only supports
 * pullToRefreshEnabled on iOS). Pulling down past the top of the page shows a
 * small pixel arrow; letting go past the line posts { __bitPullRefresh: true }.
 */
export const PULL_REFRESH_JS = String.raw`(function(){
  if (window.__bitPull || window.top !== window) return; window.__bitPull = true;
  var startY = null, pulled = 0, tip = null, LIMIT = 90;
  function ensure(){
    if (tip) return tip;
    tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;left:50%;top:0;z-index:2147483647;width:40px;height:40px;margin-left:-20px;background:#141428;border:3px solid #2dd4bf;color:#2dd4bf;font:bold 20px monospace;display:flex;align-items:center;justify-content:center;transform:translateY(-60px);pointer-events:none;box-shadow:3px 3px 0 #05050f';
    tip.textContent = '↓';
    (document.body || document.documentElement).appendChild(tip);
    return tip;
  }
  function atTop(){ return (window.scrollY || document.documentElement.scrollTop || 0) <= 0 }
  addEventListener('touchstart', function(e){ startY = e.touches.length === 1 && atTop() ? e.touches[0].clientY : null; pulled = 0 }, { passive: true });
  addEventListener('touchmove', function(e){
    if (startY === null) return;
    if (!atTop()) { startY = null; return }
    pulled = Math.max(0, e.touches[0].clientY - startY);
    if (pulled < 10) return;
    var t = ensure(), d = Math.min(pulled, LIMIT * 1.4);
    t.style.transform = 'translateY(' + (d * 0.7 - 50) + 'px)';
    t.style.borderColor = pulled > LIMIT ? '#ff9f1c' : '#2dd4bf';
    t.style.color = t.style.borderColor;
    t.textContent = pulled > LIMIT ? '↻' : '↓';
  }, { passive: true });
  addEventListener('touchend', function(){
    if (startY !== null && pulled > LIMIT) try { window.ReactNativeWebView.postMessage(JSON.stringify({ __bitPullRefresh: true })) } catch (e) {}
    startY = null; pulled = 0;
    if (tip) tip.style.transform = 'translateY(-60px)';
  }, { passive: true });
})();true;`
