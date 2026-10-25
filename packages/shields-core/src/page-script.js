// Builds the JavaScript Bit Shields runs inside web pages:
//   buildPageScript()  runs at document start in every page and frame:
//                      generic hiding CSS, uBlock Origin scriptlets for the
//                      site (from a compact host map), YouTube ad skipping.
//   buildHostCss()     per-site hiding CSS, injected by the app after load.
//
// Scriptlet code is included as real functions, not strings to eval, so it
// works on sites with strict Content Security Policy or Trusted Types
// (YouTube has both).

import { YOUTUBE_JS } from './youtube.js'

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

/**
 * Keeps only scriptlet calls whose code exists in the library, and returns
 * the map plus the scriptlets it needs (with their dependencies).
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
  // Pull in dependencies (.fn helpers).
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

/** Exception keys use the same "name\0args" form; normalize names to canonical. */
export function prepareExceptions(exceptions = {}, library = []) {
  const byName = indexScriptlets(library)
  const out = {}
  for (const [host, keys] of Object.entries(exceptions)) {
    if (host === '*') continue
    out[host] = keys.map((k) => {
      if (k === '*') return '*'
      const args = k.split('\u0000')
      const s = resolveScriptlet(byName, args[0])
      return [s ? s.name : args[0], ...args.slice(1)].join('\u0000')
    })
  }
  return out
}

const js = (v) => JSON.stringify(v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029').replace(/<\/script/gi, '<\\/script')

/**
 * The document-start script. All inputs are plain data:
 *   generic: string[] selectors, genericExceptions: string[]
 *   cosmeticOff: { host: 'generic' | 'all' }
 *   scriptlets / scriptletExceptions: compiled maps
 *   library: uBO resources.json `scriptlets` (may be empty: YouTube fallback still works)
 *   siteOff: string[] hosts with Shields down
 */
export function buildPageScript({ generic = [], genericExceptions = [], cosmeticOff = {}, scriptlets = {}, scriptletExceptions = {}, library = [], siteOff = [] } = {}) {
  const { map, code, entry } = prepareScriptlets(scriptlets, library)
  const exceptions = prepareExceptions(scriptletExceptions, library)
  const except = new Set(genericExceptions)
  const css = generic.filter((s) => !except.has(s))
  return `(function(){
if (window.__bitShields) return; window.__bitShields = true;
var host = String(location.hostname || '').toLowerCase();
var top = window.top === window;
var SITE_OFF = ${js(siteOff)};
function parents(h){ var out=[]; while(h){ out.push(h); var i=h.indexOf('.'); if(i<0) break; h=h.slice(i+1) } return out }
function entities(h){ var p=h.split('.'), out=[]; for(var i=0;i<p.length-1;i++) for(var k=i+1;k<p.length;k++) out.push(p.slice(i,k).join('.')+'.*'); return out }
var hosts = parents(host);
var pageHost = host;
try { if (!top) pageHost = String(window.top.location.hostname || host).toLowerCase() } catch (e) {}
for (var i=0;i<SITE_OFF.length;i++) { var o=SITE_OFF[i]; if (pageHost===o || pageHost.slice(-o.length-1)==='.'+o) return }
var blocked = 0, timer = 0;
function report(n){ blocked += n||1; if (timer) return; timer = setTimeout(function(){ timer=0; try { if (top && window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({__bitBlocked: blocked})); blocked=0 } catch(e){} }, 1200) }
window.__bitShieldsReport = report;
var OFF = ${js(cosmeticOff)};
var off = ''; for (var j=0;j<hosts.length;j++) if (OFF[hosts[j]]) { off = OFF[hosts[j]]; break }
var GENERIC = ${js(css)};
function addStyle(text){ var s=document.createElement('style'); s.setAttribute('data-bit-shields',''); s.textContent=text; (document.head||document.documentElement).appendChild(s) }
if (top && !off && GENERIC.length) {
  var ok=[]; for (var g=0; g<GENERIC.length; g++) { var sel=GENERIC[g]; try { if (CSS.supports('selector('+sel+')')) ok.push(sel) } catch(e){} }
  var rules=''; for (var c=0;c<ok.length;c+=40) rules += ok.slice(c,c+40).join(',\\n') + '{display:none!important}\\n';
  if (document.documentElement) addStyle(rules); else document.addEventListener('readystatechange', function(){ addStyle(rules) }, { once: true });
}
var MAP = ${js(JSON.stringify(map))};
var EXC = ${js(JSON.stringify(exceptions))};
var keys = hosts.concat(entities(host));
var any = false; for (var k=0;k<keys.length;k++) if (MAP.indexOf('"'+keys[k]+'"') >= 0) { any = true; break }
if (any) {
  var map = JSON.parse(MAP), exc = JSON.parse(EXC), calls = [], seen = {}, skip = {};
  for (var e=0;e<keys.length;e++) { var ex = exc[keys[e]]; if (ex) for (var x=0;x<ex.length;x++) skip[ex[x]] = true }
  if (!skip['*']) for (var m=0;m<keys.length;m++) { var list = map[keys[m]]; if (!list) continue; for (var n=0;n<list.length;n++) { var id = list[n].join('\\u0000'); if (seen[id] || skip[id]) continue; seen[id] = true; calls.push(list[n]) } }
  if (calls.length) (function(){
    var scriptletGlobals = {};
${code.join('\n')}
    ${SHARE_SAFE_SELF}
    var ENTRY = {${Object.entries(entry).map(([k, v]) => `${js(k)}:typeof ${v}==='function'?${v}:null`).join(',')}};
    for (var q=0;q<calls.length;q++) { try { var f = ENTRY[calls[q][0]]; if (f) f.apply(null, calls[q].slice(1)) } catch(err) {} }
  })();
}
${YOUTUBE_JS}
})();`
}

/** Per-site hiding CSS for the page at `host`, minus exceptions. '' if none. */
export function hostSelectors(cosmetic, host) {
  if (!cosmetic || !host) return []
  const parts = host.split('.')
  const keys = []
  let h = host
  while (h) {
    keys.push(h)
    const i = h.indexOf('.')
    if (i < 0) break
    h = h.slice(i + 1)
  }
  for (let i = 0; i < parts.length - 1; i++) for (let k = i + 1; k < parts.length; k++) keys.push(`${parts.slice(i, k).join('.')}.*`)
  const off = new Set()
  for (const k of keys) for (const s of cosmetic.hostExceptions?.[k] || []) off.add(s)
  for (const k of keys) if (cosmetic.off?.[k] === 'all') return []
  const out = new Set()
  for (const k of keys) for (const s of cosmetic.hosts?.[k] || []) if (!off.has(s)) out.add(s)
  return [...out]
}

/** Script that adds per-site hiding CSS once per document. */
export function buildHostCss(selectors) {
  if (!selectors?.length) return ''
  return `(function(){if(window.__bitShieldsHost)return;window.__bitShieldsHost=true;var S=${js(selectors)},ok=[];for(var i=0;i<S.length;i++){try{if(CSS.supports('selector('+S[i]+')'))ok.push(S[i])}catch(e){}}if(!ok.length)return;var st=document.createElement('style');st.setAttribute('data-bit-shields-host','');st.textContent=ok.join(',\\n')+'{display:none!important}';(document.head||document.documentElement).appendChild(st)})();true;`
}
