// Builds the JavaScript Bit Shields runs inside web pages.
//
//   buildPageScript()  Runs at document start in every page and frame, so it
//                      must stay small: generic hiding CSS (top frame), the
//                      uBlock Origin scriptlets for a few sites that need
//                      them before the page's own scripts run (YouTube), and
//                      the YouTube backup layer.
//   buildSiteScript()  Everything specific to one site (its hiding CSS and
//                      scriptlets). The app injects it as soon as a page
//                      starts loading.
//
// Scriptlet code is included as real functions, not strings to eval, so it
// works on sites with a strict Content Security Policy or Trusted Types
// (YouTube has both).

import { YOUTUBE_JS } from './youtube.js'

/** Sites whose scriptlets ride in the document-start script. */
export const EARLY_SITES = ['youtube.com', 'youtube-nocookie.com', 'youtubekids.com']

const SHARE_SAFE_SELF = "if (typeof safeSelf === 'function') { if (scriptletGlobals.safeSelf) { safeSelf.safe = scriptletGlobals.safeSelf; } else { scriptletGlobals.safeSelf = safeSelf(); } }"

/** name/alias -> scriptlet from uBO's resources.json (`scriptlets` array). */
export function indexScriptlets(library = []) {
  const byName = new Map()
  for (const s of library) for (const n of [s.name, ...(s.aliases || [])]) byName.set(n, s)
  return byName
}

/** Resolves a +js name the way uBO does: "set" -> "set-constant.js". */
export function resolveScriptlet(byName, name) {
  if (!name || name.endsWith('.fn')) return null
  return byName.get(name) || byName.get(`${name}.js`) || null
}

const fnName = (body) => /^\s*function\s+([A-Za-z0-9_$]+)/.exec(body)?.[1] || null

const js = (v) => JSON.stringify(v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029').replace(/<\/script/gi, '<\\/script')

/** Lookup keys for a host: itself, its parents, and uBO "entity" forms (example.*). */
export function hostKeys(host) {
  const keys = []
  let h = String(host || '').toLowerCase()
  while (h) {
    keys.push(h)
    const i = h.indexOf('.')
    if (i < 0) break
    h = h.slice(i + 1)
  }
  const parts = String(host || '').toLowerCase().split('.')
  for (let i = 0; i < parts.length - 1; i++) for (let k = i + 1; k < parts.length; k++) keys.push(`${parts.slice(i, k).join('.')}.*`)
  return keys
}

/**
 * Keeps only scriptlet calls whose code exists in the library, and returns
 * the map plus the code it needs (with dependencies).
 */
export function prepareScriptlets(scriptlets = {}, library = []) {
  const byName = indexScriptlets(library)
  const used = new Map() // canonical name -> scriptlet
  const map = {}
  for (const [host, calls] of Object.entries(scriptlets)) {
    const keep = []
    for (const key of calls) {
      const args = key.split('\u0000')
      const s = resolveScriptlet(byName, args[0])
      if (!s || !fnName(s.body)) continue
      used.set(s.name, s)
      keep.push([s.name, ...args.slice(1)])
    }
    if (keep.length) map[host] = keep
  }
  const code = new Map()
  const queue = [...used.values()]
  while (queue.length) {
    const s = queue.pop()
    if (code.has(s.name)) continue
    code.set(s.name, s.body)
    for (const d of s.dependencies || []) {
      const dep = byName.get(d)
      if (dep && !code.has(dep.name)) queue.push(dep)
    }
  }
  const entry = {}
  for (const s of used.values()) entry[s.name] = fnName(s.body)
  return { map, code: [...code.values()], entry }
}

function canonicalKey(byName, key) {
  if (key === '*') return '*'
  const args = key.split('\u0000')
  const s = resolveScriptlet(byName, args[0])
  return [s ? s.name : args[0], ...args.slice(1)].join('\u0000')
}

/** The scriptlet calls that apply to `host` (exceptions removed), as "name\0args" keys. */
export function siteScriptlets(compiled, host) {
  const keys = hostKeys(host)
  const skip = new Set()
  for (const k of keys) for (const x of compiled?.scriptletExceptions?.[k] || []) skip.add(x)
  if (skip.has('*')) return { calls: [], skip }
  const calls = []
  for (const k of keys) for (const c of compiled?.scriptlets?.[k] || []) if (!skip.has(c) && !calls.includes(c)) calls.push(c)
  return { calls, skip }
}

/**
 * JS that runs scriptlet calls. `byHost` maps a host (or '' for "always") to
 * { calls, skip } from siteScriptlets(); the page runs the entries whose host
 * matches its own. Scriptlet code is included once. '' if nothing applies.
 */
function scriptletCode(byHost, library) {
  if (!library.length) return ''
  const byName = indexScriptlets(library)
  const all = []
  const perHost = {}
  for (const [h, { calls, skip = new Set() }] of Object.entries(byHost)) {
    const canonSkip = new Set([...skip].map((k) => canonicalKey(byName, k)))
    const { map } = prepareScriptlets({ x: calls }, library)
    const list = (map.x || []).filter((c) => !canonSkip.has(c.join('\u0000')))
    if (!list.length) continue
    perHost[h] = list
    for (const c of calls) if (!all.includes(c)) all.push(c)
  }
  if (!Object.keys(perHost).length) return ''
  const { code, entry } = prepareScriptlets({ x: all }, library)
  return `(function(){
var BY_HOST = ${js(perHost)}, best = null;
// Each entry already includes its parent domains' calls: use the most specific match.
for (var hh in BY_HOST) if ((!hh || host === hh || host.slice(-hh.length-1) === '.'+hh) && (best === null || hh.length > best.length)) best = hh;
if (best === null) return;
var CALLS = BY_HOST[best];
var scriptletGlobals = {};
${code.join('\n')}
${SHARE_SAFE_SELF}
var ENTRY = {${Object.entries(entry).map(([k, v]) => `${js(k)}:typeof ${v}==='function'?${v}:null`).join(',')}};
for (var q=0;q<CALLS.length;q++) { try { var f = ENTRY[CALLS[q][0]]; if (f) f.apply(null, CALLS[q].slice(1)) } catch(err) {} }
})();`
}

/** Script prelude: stops on sites with Shields down, sets up the blocked-count reporter. */
function prelude(siteOff) {
  return `if (window.__bitShields) return; window.__bitShields = true;
var host = String(location.hostname || '').toLowerCase();
var top = window.top === window;
var pageHost = host;
try { if (!top) pageHost = String(window.top.location.hostname || host).toLowerCase() } catch (e) {}
var SITE_OFF = ${js(siteOff)};
for (var i=0;i<SITE_OFF.length;i++) { var o=SITE_OFF[i]; if (pageHost===o || pageHost.slice(-o.length-1)==='.'+o) return }
var blocked = 0, timer = 0;
function report(n){ blocked += n||1; if (timer) return; timer = setTimeout(function(){ timer=0; try { if (top && window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({__bitBlocked: blocked})); blocked=0 } catch(e){} }, 1200) }
function addStyle(text, attr){ function go(){ var s=document.createElement('style'); s.setAttribute(attr,''); s.textContent=text; (document.head||document.documentElement).appendChild(s) } if (document.documentElement) go(); else document.addEventListener('readystatechange', go, { once: true }) }
function hideCss(list){ var ok=[]; for (var g=0; g<list.length; g++) { try { if (CSS.supports('selector('+list[g]+')')) ok.push(list[g]) } catch(e){} } var rules=''; for (var c=0;c<ok.length;c+=40) rules += ok.slice(c,c+40).join(',\\n') + '{display:none!important}\\n'; return rules }`
}

/**
 * The document-start script (same for every page). Inputs are plain data:
 *   generic, genericExceptions: selectors; cosmeticOff: { host: 'generic'|'all' }
 *   scriptlets, scriptletExceptions: compiled maps (only EARLY_SITES are used)
 *   library: uBO resources.json `scriptlets` (empty is fine: the YouTube backup still works)
 *   siteOff: hosts with Shields down
 */
export function buildPageScript({ generic = [], genericExceptions = [], cosmeticOff = {}, scriptlets = {}, scriptletExceptions = {}, library = [], siteOff = [] } = {}) {
  const except = new Set(genericExceptions)
  const css = generic.filter((s) => !except.has(s))
  // Early sites' scriptlets: resolved per exact host so exceptions apply,
  // code shared. Hosts are matched most-specific first in the page.
  const byHost = {}
  for (const k of Object.keys(scriptlets)) {
    if (k.endsWith('.*') || !EARLY_SITES.some((site) => k === site || k.endsWith(`.${site}`))) continue
    byHost[k] = siteScriptlets({ scriptlets, scriptletExceptions }, k)
  }
  return `(function(){
${prelude(siteOff)}
var OFF = ${js(cosmeticOff)};
var off = ''; var hk = host; while (hk) { if (OFF[hk]) { off = OFF[hk]; break } var d = hk.indexOf('.'); if (d < 0) break; hk = hk.slice(d+1) }
if (top && !off) addStyle(hideCss(${js(css)}), 'data-bit-shields');
${scriptletCode(byHost, library)}
${YOUTUBE_JS}
})();`
}

/** Per-site hiding selectors for `host`, minus exceptions. */
export function hostSelectors(cosmetic, host) {
  if (!cosmetic || !host) return []
  const keys = hostKeys(host)
  for (const k of keys) if (cosmetic.off?.[k] === 'all') return []
  const off = new Set()
  for (const k of keys) for (const s of cosmetic.hostExceptions?.[k] || []) off.add(s)
  const out = new Set()
  for (const k of keys) for (const s of cosmetic.hosts?.[k] || []) if (!off.has(s)) out.add(s)
  return [...out]
}

/**
 * Script with everything specific to the site at `host`: its hiding CSS and
 * its scriptlets (except early sites, already handled at document start).
 * Safe to inject more than once per page. '' if there's nothing to do.
 */
export function buildSiteScript({ compiled, library = [], host, siteOff = [] }) {
  if (!compiled || !host) return ''
  const selectors = hostSelectors(compiled.cosmetic, host)
  const early = EARLY_SITES.some((s) => host === s || host.endsWith(`.${s}`))
  const { calls, skip } = early ? { calls: [] } : siteScriptlets(compiled, host)
  const scripts = calls.length ? scriptletCode({ '': { calls, skip } }, library) : ''
  if (!selectors.length && !scripts) return ''
  return `(function(){
if (window.__bitShieldsSite) return; window.__bitShieldsSite = true;
${prelude(siteOff).replace('if (window.__bitShields) return; window.__bitShields = true;', '')}
${selectors.length ? `addStyle(hideCss(${js(selectors)}), 'data-bit-shields-site');` : ''}
${scripts}
})();true;`
}
