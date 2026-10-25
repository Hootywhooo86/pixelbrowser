// Turns Adblock Plus / uBlock Origin filter lists into compact, JSON-friendly
// data for the phone:
//   network   host sets for request blocking (||host^ rules only; path and
//             regex rules are skipped to keep matching fast on a phone)
//   cosmetic  CSS selectors to hide, generic and per site
//   scriptlets  uBlock Origin +js(...) calls per site (YouTube needs these)
//
// compileLists() yields to the event loop every few thousand lines so it can
// run on the phone's JS thread without freezing the UI.

const GENERIC_CAP = 6000 // generic selectors injected on every page
const SEPARATOR = /(#@?\$\?#|#@?\$#|#@?\?#|#@?%#|#@?#\^?)/
const DOMAIN_LIST = /^[a-z0-9.,~*_:\-[\]]*$/i
const HOST = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)+$/
// uBlock procedural/extended selectors a plain stylesheet can't express.
const PROCEDURAL = /:(has-text|-abp-|xpath|matches-css|matches-path|matches-attr|matches-prop|matches-media|upward|watch-attr|min-text-length|others|remove|remove-attr|remove-class|style|shadow)\b|:-abp-/
// Options that make a ||host^ rule unsafe to apply as a plain host block.
const SKIP_OPTIONS = new Set([
  'domain', 'from', 'to', 'denyallow', 'redirect', 'redirect-rule', 'rewrite', 'removeparam', 'queryprune', 'csp', 'replace',
  'header', 'permissions', 'urltransform', 'uritransform', 'method', 'popup', 'popunder', 'first-party', '1p', 'strict1p',
  'strict-first-party', 'badfilter', 'cname', 'match-case', 'ipaddress', 'urlskip',
])
const TYPE_OPTIONS = new Set([
  'script', 'image', 'stylesheet', 'css', 'xmlhttprequest', 'xhr', 'subdocument', 'frame', 'ping', 'beacon', 'media', 'object',
  'font', 'websocket', 'other', 'all', 'important', 'object-subrequest', 'webrtc', 'genericblock', 'inline-script', 'inline-font',
])

/** Evaluates uBlock `!#if` preprocessor conditions for a mobile WebView. */
function condition(expr) {
  const env = { env_mobile: true, env_chromium: true, ext_ublock: true, adguard: false, ext_abp: false, env_firefox: false, env_safari: false }
  const tokens = expr.match(/!|&&|\|\||\(|\)|[a-z_0-9]+/gi) || []
  let i = 0
  const primary = () => {
    const t = tokens[i++]
    if (t === '!') return !primary()
    if (t === '(') {
      const v = or()
      i++ // )
      return v
    }
    return !!env[t]
  }
  const and = () => {
    let v = primary()
    while (tokens[i] === '&&') {
      i++
      v = primary() && v
    }
    return v
  }
  const or = () => {
    let v = and()
    while (tokens[i] === '||') {
      i++
      v = and() || v
    }
    return v
  }
  return or()
}

/** Splits `+js(name, a, b)` arguments; `\,` is a literal comma, quotes group. */
export function parseScriptletArgs(inner) {
  const args = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === '\\' && inner[i + 1] === ',') {
      cur += ','
      i++
    } else if (quote) {
      if (c === quote && inner[i - 1] !== '\\') quote = ''
      else cur += c
    } else if ((c === '"' || c === "'") && cur.trim() === '') {
      quote = c
      cur = ''
    } else if (c === ',') {
      args.push(cur.trim())
      cur = ''
    } else cur += c
  }
  args.push(cur.trim())
  return args
}

const add = (map, key, value) => {
  const list = map[key] || (map[key] = [])
  if (!list.includes(value)) list.push(value)
}

function splitDomains(prefix) {
  const yes = []
  const no = []
  for (let d of prefix.split(',')) {
    d = d.trim().toLowerCase()
    if (!d) continue
    if (d.startsWith('~')) no.push(d.slice(1))
    else yes.push(d)
  }
  return { yes, no }
}

export function createCompiler() {
  const block = new Set()
  const block3p = new Set()
  const allow = new Set()
  const pageAllow = new Set() // @@||host^$document: no blocking on that site
  const trackers = new Set() // blocked hosts that came from tracker lists (for the counts)
  const cosmeticOff = {} // host -> 'generic' | 'all'
  const generic = []
  const genericSeen = new Set()
  const genericExceptions = new Set()
  const hosts = {}
  const hostExceptions = {}
  const scriptlets = {}
  const scriptletExceptions = {}
  const stats = { lines: 0, network: 0, cosmetic: 0, scriptlets: 0, skipped: 0 }

  function network(line, kind) {
    let exception = false
    if (line.startsWith('@@')) {
      exception = true
      line = line.slice(2)
    }
    if (line.startsWith('/') ) return stats.skipped++ // regex or path rule
    let pattern = line
    let options = []
    const dollar = line.lastIndexOf('$')
    if (dollar > 0) {
      pattern = line.slice(0, dollar)
      options = line.slice(dollar + 1).toLowerCase().split(',').map((o) => o.trim()).filter(Boolean)
    }
    const m = /^\|\|([a-z0-9._-]+)\^?\|?$/i.exec(pattern)
    if (!m || !HOST.test(m[1])) return stats.skipped++
    const host = m[1].toLowerCase()
    let thirdParty = false
    let documentLevel = false
    for (const raw of options) {
      const name = raw.replace(/^~/, '').split('=')[0]
      if (name === 'third-party' || name === '3p') {
        if (raw.startsWith('~')) return stats.skipped++ // ~third-party = first-party only
        thirdParty = true
      } else if (name === 'document' || name === 'doc') documentLevel = true
      else if (exception && (name === 'elemhide' || name === 'ehide')) {
        cosmeticOff[host] = 'all'
        return stats.network++
      } else if (exception && (name === 'generichide' || name === 'ghide')) {
        if (cosmeticOff[host] !== 'all') cosmeticOff[host] = 'generic'
        return stats.network++
      } else if (SKIP_OPTIONS.has(name)) return stats.skipped++
      else if (!TYPE_OPTIONS.has(name)) return stats.skipped++
    }
    stats.network++
    if (exception) {
      if (documentLevel) pageAllow.add(host)
      else allow.add(host)
    } else {
      if (thirdParty) block3p.add(host)
      else block.add(host)
      if (kind === 'trackers') trackers.add(host)
    }
  }

  function cosmetic(prefix, sep, body) {
    if (!DOMAIN_LIST.test(prefix)) return false
    const exception = sep.includes('@')
    if (sep !== '##' && sep !== '#@#') {
      stats.skipped++
      return true
    }
    const { yes, no } = splitDomains(prefix)
    if (body.startsWith('+js(') && body.endsWith(')')) {
      const args = parseScriptletArgs(body.slice(4, -1))
      if (!args[0] && !exception) return (stats.skipped++, true)
      if (exception) {
        for (const d of yes.length ? yes : ['*']) add(scriptletExceptions, d, args[0] ? args.join('\u0000') : '*')
        return true
      }
      if (!yes.length) return (stats.skipped++, true) // generic scriptlets aren't allowed
      const key = args.join('\u0000')
      for (const d of yes) add(scriptlets, d, key)
      for (const d of no) add(scriptletExceptions, d, key)
      stats.scriptlets++
      return true
    }
    if (PROCEDURAL.test(body) || body.startsWith('+js') || body.length > 500) return (stats.skipped++, true)
    stats.cosmetic++
    if (exception) {
      if (!yes.length) genericExceptions.add(body)
      for (const d of yes) add(hostExceptions, d, body)
      return true
    }
    if (!yes.length) {
      if (no.length) return (stats.skipped++, true) // "everywhere except" rules are rare; skip
      if (!genericSeen.has(body) && generic.length < GENERIC_CAP) {
        genericSeen.add(body)
        generic.push(body)
      }
      return true
    }
    for (const d of yes) add(hosts, d, body)
    for (const d of no) add(hostExceptions, d, body)
    return true
  }

  function line(raw, trusted, kind) {
    stats.lines++
    const text = raw.trim()
    if (!text || text.startsWith('!') || text.startsWith('[')) return
    const sep = SEPARATOR.exec(text)
    if (sep) {
      const prefix = text.slice(0, sep.index)
      const body = text.slice(sep.index + sep[0].length).trim()
      if (body.startsWith('+js(') && /^\+js\(\s*trusted-/.test(body) && !trusted) return void stats.skipped++
      if (cosmetic(prefix, sep[0], body)) return
    }
    network(text, kind)
  }

  function result() {
    // A host blocked outright doesn't also need a third-party-only entry.
    for (const h of block3p) if (block.has(h)) block3p.delete(h)
    return {
      version: 1,
      network: { block: [...block], block3p: [...block3p], allow: [...allow], pageAllow: [...pageAllow], trackers: [...trackers] },
      cosmetic: { generic, genericExceptions: [...genericExceptions], hosts, hostExceptions, off: cosmeticOff },
      scriptlets,
      scriptletExceptions,
      stats,
    }
  }

  return { line, result }
}

/** Splits list text into lines, dropping `!#if` blocks that don't apply. */
export function preprocess(text) {
  const out = []
  const stack = [] // whether each open block is active
  const active = () => stack.every(Boolean)
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (raw.startsWith('!#if ')) stack.push(condition(raw.slice(5)))
    else if (raw.startsWith('!#else')) stack.push(!stack.pop())
    else if (raw.startsWith('!#endif')) stack.pop()
    else if (active() && !raw.startsWith('!#include')) out.push(raw)
  }
  return out
}

/**
 * Compiles lists: [{ text, trusted, kind }] (kind 'trackers' marks tracker lists). Async so the phone can stay responsive;
 * `yieldEvery` lines it awaits `pause()` (defaults to a setTimeout(0)).
 */
export async function compileLists(lists, { yieldEvery = 4000, pause = () => new Promise((r) => setTimeout(r, 0)) } = {}) {
  const c = createCompiler()
  let n = 0
  for (const list of lists) {
    for (const l of preprocess(list.text)) {
      c.line(l, !!list.trusted, list.kind)
      if (++n % yieldEvery === 0) await pause()
    }
  }
  return c.result()
}

/** Same as compileLists, synchronously (tests, desktop, build scripts). */
export function compileListsSync(lists) {
  const c = createCompiler()
  for (const list of lists) for (const l of preprocess(list.text)) c.line(l, !!list.trusted, list.kind)
  return c.result()
}
