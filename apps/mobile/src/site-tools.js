// Per-site tools:
//  - Forget a site when I close it (cookies and storage wiped for that site only)
//  - Block an element (hide an annoying part of a page for good)
//  - Add to home screen
// All of it stays on the phone.

import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { siteOf } from '@pixelbrowser/shields-core'
import { getState, update, useStore } from './store'
import { getSite, hostKey } from './site-settings'

const native = Platform.OS === 'android' ? requireOptionalNativeModule('BitShields') : null

const hostOf = (url) => {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : ''
  } catch {
    return ''
  }
}

/** The site a page belongs to ("shop.example.co.uk" -> "example.co.uk"). */
export const siteKeyOf = (url) => {
  const h = hostOf(url)
  return h ? siteOf(h) : ''
}

// ---------- forget when closed ----------

export const forgetSupported = () => !!native?.forgetSite

/** Is "forget when I close it" on for this page's site? */
export function forgetsOnClose(url) {
  const host = hostOf(url)
  if (!host) return false
  return !!(getSite(host).forget || getSite(siteOf(host)).forget)
}

/**
 * Remember that a forget-on-close site was visited (persisted, so it's still
 * wiped next time if the app is swiped away before the tab is closed).
 */
export function noteVisit(url) {
  if (!forgetsOnClose(url)) return
  const host = hostOf(url)
  const site = siteOf(host)
  const cur = getState().forgetVisited?.[site] || []
  if (cur.includes(host)) return
  update((s) => (s.forgetVisited = { ...(s.forgetVisited || {}), [site]: [...cur, host].slice(-20) }))
}

/** Wipes one site's cookies and storage now. Returns the number of cookies removed, or -1. */
export function forgetSiteNow(urlOrHost) {
  const host = /^[a-z]+:/i.test(urlOrHost) ? hostOf(urlOrHost) : String(urlOrHost || '').toLowerCase()
  if (!host || !native?.forgetSite) return -1
  const site = siteOf(host)
  const hosts = [...new Set([host, ...(getState().forgetVisited?.[site] || [])])]
  let n = -1
  try {
    n = native.forgetSite(hosts, site)
  } catch {}
  update((s) => {
    const next = { ...(s.forgetVisited || {}) }
    delete next[site]
    s.forgetVisited = next
  })
  return n
}

/** Page script that clears the page's own storage (run just before a forgotten tab closes). */
export const CLEAR_PAGE_STORAGE_JS = `(function(){try{localStorage.clear()}catch(e){}try{sessionStorage.clear()}catch(e){}
try{indexedDB.databases&&indexedDB.databases().then(function(l){l.forEach(function(d){d.name&&indexedDB.deleteDatabase(d.name)})})}catch(e){}
try{caches&&caches.keys().then(function(k){k.forEach(function(n){caches.delete(n)})})}catch(e){}
try{navigator.serviceWorker&&navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister()})})}catch(e){}
})();true;`

/**
 * After tabs close (or at start-up): forget every visited forget-on-close site
 * that no remaining tab is showing. `openUrls` = URLs still open.
 */
export function forgetClosedSites(openUrls) {
  const open = new Set(openUrls.map(siteKeyOf).filter(Boolean))
  const gone = []
  for (const site of Object.keys(getState().forgetVisited || {})) {
    if (open.has(site)) continue
    forgetSiteNow(site)
    gone.push(site)
  }
  return gone
}

/** Sites with "forget when closed" turned on (for Settings). */
export function useForgetSites() {
  return useStore((s) =>
    Object.keys(s.siteSettings || {})
      .filter((h) => s.siteSettings[h]?.forget)
      .sort()
      .join('\n')
  )
    .split('\n')
    .filter(Boolean)
}

// ---------- block an element ----------

/** Hidden elements for a page: CSS selectors saved for its host. */
export function hiddenFor(url) {
  const host = hostKey(url)
  return (host && getState().hiddenElements?.[host]) || []
}

export function addHidden(url, selector) {
  const host = hostKey(url)
  if (!host || !selector) return
  update((s) => {
    const cur = (s.hiddenElements || {})[host] || []
    if (!cur.includes(selector)) s.hiddenElements = { ...(s.hiddenElements || {}), [host]: [...cur, selector].slice(-100) }
  })
}

export function removeHidden(host, selector) {
  update((s) => {
    const cur = ((s.hiddenElements || {})[host] || []).filter((x) => selector != null && x !== selector)
    const next = { ...(s.hiddenElements || {}) }
    if (cur.length) next[host] = cur
    else delete next[host]
    s.hiddenElements = next
  })
}

export function useHidden(url) {
  const host = hostKey(url)
  return useStore((s) => (host && s.hiddenElements?.[host]) || null) || []
}

/** CSS (as a page script) that keeps this site's hidden elements hidden, or ''. */
export function hiddenElementsJS(url) {
  const list = hiddenFor(url)
  if (!list.length) return ''
  const css = list.map((sel) => `${sel}{display:none!important}`).join('\n')
  return `(function(){try{var id='bit-hidden-els';var s=document.getElementById(id);if(!s){s=document.createElement('style');s.id=id;(document.head||document.documentElement).appendChild(s)}s.textContent=${JSON.stringify(css)}}catch(e){}})();true;`
}

/**
 * The element picker: tap the part of the page you want gone. It's outlined in
 * pink; WIDER picks the box around it; HIDE IT saves it. Posts
 * { __bitPick: { selector, count } } or { __bitPick: null } (cancelled).
 */
export const PICKER_JS = String.raw`(function(){
if(window.__bitPicker)return;window.__bitPicker=1;
var cur=null,box=document.createElement('div'),bar=document.createElement('div');
box.style.cssText='position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #ff4fa3;background:rgba(255,79,163,.18);display:none';
bar.style.cssText='position:fixed;left:8px;right:8px;bottom:12px;z-index:2147483647;background:#14142a;border:3px solid #ff4fa3;padding:10px;font:14px monospace;color:#fff;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
bar.innerHTML='<span style="flex:1 1 100%">Tap the part of the page to hide</span>';
function btn(t,c,f){var b=document.createElement('button');b.textContent=t;b.style.cssText='font:bold 13px monospace;padding:10px 12px;border:3px solid '+c+';background:#0b0b16;color:'+c;b.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();f()},true);bar.appendChild(b);return b}
var cssEsc=window.CSS&&CSS.escape?CSS.escape:function(s){return String(s).replace(/[^a-zA-Z0-9_-]/g,'\\$&')};
function stable(c){return c&&!/\d{3,}|^(is-|has-)|active|hover|focus|open|show|visible|selected/i.test(c)&&c.length<40}
function part(el){
 if(el.id&&!/\d{3,}/.test(el.id)&&document.querySelectorAll('#'+cssEsc(el.id)).length===1)return '#'+cssEsc(el.id);
 var s=el.tagName.toLowerCase(),cls=[].slice.call(el.classList).filter(stable).slice(0,3);
 if(cls.length)s+='.'+cls.map(cssEsc).join('.');
 var p=el.parentElement;if(p){var same=[].filter.call(p.children,function(x){return x.tagName===el.tagName});if(same.length>1&&!cls.length)s+=':nth-of-type('+(same.indexOf(el)+1)+')'}
 return s}
function selector(el){var parts=[],e=el;for(var i=0;e&&e!==document.body&&e!==document.documentElement&&i<5;i++){parts.unshift(part(e));var sel=parts.join(' > ');if(parts[0][0]==='#'||document.querySelectorAll(sel).length===1)return sel;e=e.parentElement}return parts.join(' > ')}
function show(el){cur=el;var r=el.getBoundingClientRect();box.style.display='block';box.style.left=r.left+'px';box.style.top=r.top+'px';box.style.width=r.width+'px';box.style.height=r.height+'px';hide.disabled=false;wide.disabled=!el.parentElement||el.parentElement===document.body}
function done(v){document.removeEventListener('click',onTap,true);document.removeEventListener('touchstart',stop,true);box.remove();bar.remove();window.__bitPicker=0;window.ReactNativeWebView.postMessage(JSON.stringify({__bitPick:v}))}
function stop(e){if(!bar.contains(e.target))e.stopPropagation()}
function onTap(e){if(bar.contains(e.target))return;e.preventDefault();e.stopPropagation();var el=document.elementFromPoint(e.clientX,e.clientY);if(el&&el!==box)show(el)}
var hide=btn('HIDE IT','#ff4fa3',function(){if(!cur)return;var s=selector(cur);var n=document.querySelectorAll(s).length;cur.style.setProperty('display','none','important');done({selector:s,count:n})});
var wide=btn('WIDER','#2ee6c8',function(){if(cur&&cur.parentElement&&cur.parentElement!==document.body)show(cur.parentElement)});
btn('CANCEL','#9a9ab8',function(){done(null)});
hide.disabled=wide.disabled=true;
document.documentElement.appendChild(box);document.documentElement.appendChild(bar);
document.addEventListener('click',onTap,true);document.addEventListener('touchstart',stop,true);
})();true;`

// ---------- add to home screen ----------

export const homeScreenSupported = () => {
  try {
    return !!native?.pinShortcutSupported?.()
  } catch {
    return false
  }
}

/** Page script: the page's best icon (apple-touch-icon / largest icon) and app name. */
export const PAGE_ICON_SCRIPT = `(function(){
var best=null,score=-1;
document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"],link[rel="apple-touch-icon-precomposed"],link[rel="shortcut icon"]').forEach(function(l){
 if(!l.href||/\\.svg(\\?|$)/i.test(l.href)||/svg/.test(l.type||''))return;
 var s=parseInt(String(l.sizes&&l.sizes.value||'').split('x')[0])||(/apple/.test(l.rel)?180:16);
 if(s>score&&s<=512){score=s;best=l.href}});
var name=(document.querySelector('meta[name="application-name"]')||document.querySelector('meta[property="og:site_name"]')||{}).content||'';
return {icon:best||(location.origin+'/favicon.ico'),name:name}})()`

/** Puts the page on the home screen. `run(script)` runs a script in the page. */
export async function addToHomeScreen({ url, title, run }) {
  if (!native?.addToHomeScreen) return 'unsupported'
  const info = (await run(PAGE_ICON_SCRIPT).catch(() => null)) || {}
  const host = hostOf(url).replace(/^www\./, '')
  const name = String(info.name || title || host).trim().slice(0, 40) || host
  const res = await native.addToHomeScreen(url, name, info.icon || null)
  if (res === 'asked') {
    update((s) => {
      const list = (s.homeShortcuts || []).filter((u) => u !== url)
      s.homeShortcuts = [...list, url].slice(-50)
    })
  }
  return res
}

/** Is this an address the user put on the home screen? */
export const isHomeShortcut = (url) => (getState().homeShortcuts || []).includes(url)
