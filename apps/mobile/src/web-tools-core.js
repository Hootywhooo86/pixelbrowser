// Pure helpers (no React Native imports) for HTTPS upgrade, price watching,
// "what changed" diffs, history search and kids mode. Unit-tested in
// apps/mobile/test/web-tools.test.mjs.

// ---------- HTTPS upgrade ----------

const LOCAL_HOST = /^(localhost|.*\.local|.*\.localhost|.*\.lan|.*\.home|.*\.internal|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i

/** Host of a URL, lowercased, '' if it isn't a URL. */
export function hostOfUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * The https:// version of an http:// address, or null when it shouldn't be
 * upgraded (already https, local network address, or a site we learned only
 * works over http).
 */
export function upgradeUrl(url, httpOnly = new Set()) {
  const m = /^http:\/\/([^/?#]+)(.*)$/i.exec(String(url || ''))
  if (!m) return null
  const host = hostOfUrl(url)
  if (!host || LOCAL_HOST.test(host) || httpOnly.has(host) || httpOnly.has(host.replace(/^www\./, ''))) return null
  // Explicit non-default ports are usually dev servers that don't speak TLS.
  if (/:\d+$/.test(m[1]) && !/:80$/.test(m[1])) return null
  return `https://${m[1].replace(/:80$/, '')}${m[2] || '/'}`
}

/** True for load errors that mean "this site has no working https". */
export function isUpgradeFailure(description = '', code) {
  return /SSL|CERT|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|NSURLErrorSecureConnectionFailed|-1200|-1202|-1004|-1001/i.test(`${description} ${code ?? ''}`)
}

// ---------- price watching ----------

const CURRENCY = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', 'C$': 'CAD', 'CA$': 'CAD', 'A$': 'AUD' }

/** "1,299.99" / "1.299,99" / "$ 12" → number, or null. */
export function parsePriceNumber(text) {
  const raw = String(text ?? '').replace(/[^\d.,]/g, '')
  if (!raw || !/\d/.test(raw)) return null
  let n = raw
  const lastDot = n.lastIndexOf('.')
  const lastComma = n.lastIndexOf(',')
  if (lastComma > lastDot) {
    // European: 1.299,99 (or 12,50)
    n = n.replace(/\./g, '').replace(',', '.')
  } else {
    n = n.replace(/,/g, '')
  }
  const v = parseFloat(n)
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null
}

function offersFrom(node, out) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) return node.forEach((n) => offersFrom(n, out))
  const type = [].concat(node['@type'] || []).join(' ')
  if (/Offer/i.test(type)) {
    const p = node.price ?? node.lowPrice ?? node.priceSpecification?.price
    const v = parsePriceNumber(p)
    if (v) out.push({ price: v, currency: node.priceCurrency || node.priceSpecification?.priceCurrency || '' })
  }
  for (const k of ['offers', '@graph', 'mainEntity', 'itemListElement', 'hasVariant']) if (node[k]) offersFrom(node[k], out)
}

/**
 * Find the product price in a page's HTML: JSON-LD Offer, then og/product
 * meta tags, then itemprop="price", then common price elements.
 * Returns { price, currency, source } or null.
 */
export function extractPrice(html) {
  const doc = String(html || '')
  const ld = [...doc.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const m of ld) {
    try {
      const out = []
      offersFrom(JSON.parse(m[1].trim()), out)
      if (out.length) return { ...out.sort((a, b) => a.price - b.price)[0], source: 'json-ld' }
    } catch {}
  }
  const meta = (name) => {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*>`, 'i')
    const tag = re.exec(doc)?.[0]
    return tag ? /content=["']([^"']+)["']/i.exec(tag)?.[1] : null
  }
  const metaPrice = meta('product:price:amount') || meta('og:price:amount') || meta('price')
  if (parsePriceNumber(metaPrice)) {
    return { price: parsePriceNumber(metaPrice), currency: meta('product:price:currency') || meta('og:price:currency') || meta('priceCurrency') || '', source: 'meta' }
  }
  const item = /itemprop=["']price["'][^>]*?(?:content=["']([^"']+)["'][^>]*>|>([^<]+)<)/i.exec(doc)
  if (item && parsePriceNumber(item[1] || item[2])) return { price: parsePriceNumber(item[1] || item[2]), currency: '', source: 'itemprop' }
  const el = /class=["'][^"']*(?:a-price-whole|price-current|product-price|sale-price|priceToPay|current-price|price__current|price)[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*([^<]*\d[^<]*)</i.exec(doc)
  if (el && parsePriceNumber(el[1])) {
    const sym = /(C\$|CA\$|A\$|[$€£¥₹])/.exec(el[1])?.[1]
    return { price: parsePriceNumber(el[1]), currency: sym ? CURRENCY[sym] : '', source: 'element' }
  }
  return null
}

// ---------- "what changed" ----------

/** Readable text of an HTML page (no scripts, styles or tags), whitespace collapsed. */
export function pageText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** Lines added and removed between two page texts (order-insensitive, capped). */
export function diffText(before = '', after = '', max = 30) {
  const a = new Set(String(before).split('\n').filter(Boolean))
  const b = new Set(String(after).split('\n').filter(Boolean))
  const added = [...b].filter((l) => !a.has(l)).slice(0, max)
  const removed = [...a].filter((l) => !b.has(l)).slice(0, max)
  return { added, removed, changed: added.length + removed.length > 0 }
}

/** Small stable hash of text (for "has it changed" without storing whole pages). */
export function textHash(text) {
  let h = 2166136261
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

// ---------- history search ----------

const DAY = 86400000
const STOP = new Set(['the', 'a', 'an', 'that', 'this', 'i', 'saw', 'site', 'page', 'website', 'about', 'for', 'with', 'of', 'on', 'in', 'to', 'my', 'was', 'from', 'some', 'last', 'week', 'yesterday', 'today', 'ago', 'month', 'and', 'or', 'what', 'where', 'which', 'find', 'me', 'visited', 'looked', 'at'])

/** Time window from words like "yesterday", "last week", "3 days ago". [from, to] in ms, or null. */
export function dateWindow(query, now = Date.now()) {
  const q = String(query).toLowerCase()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  if (/\btoday\b/.test(q)) return [today, now]
  if (/\byesterday\b/.test(q)) return [today - DAY, today]
  const ago = /(\d+)\s+(day|week|month)s?\s+ago/.exec(q)
  if (ago) {
    const unit = { day: DAY, week: 7 * DAY, month: 30 * DAY }[ago[2]]
    const at = now - Number(ago[1]) * unit
    return [at - unit, at + unit]
  }
  if (/\b(this|past|last)\s+week\b/.test(q)) return [now - 8 * DAY, now]
  if (/\b(this|past|last)\s+month\b/.test(q)) return [now - 32 * DAY, now]
  if (/\brecently\b/.test(q)) return [now - 3 * DAY, now]
  return null
}

/** Meaningful words of a query (lowercase, no filler words, simple plural folding). */
export function queryTerms(query) {
  return String(query)
    .toLowerCase()
    .replace(/\b\d+\s+(day|week|month)s?\s+ago\b/g, ' ')
    .split(/[^a-z0-9à-ÿ.-]+/i)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((w) => w.length > 1 && !STOP.has(w))
}

const fold = (w) => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '')

/**
 * Score items { kind, title, url, text?, at } against a query. Returns the
 * matches best-first: [{ ...item, score }].
 */
export function scoreItems(items, query, { now = Date.now(), limit = 50 } = {}) {
  const terms = queryTerms(query)
  const win = dateWindow(query, now)
  if (!terms.length && !win) return []
  const out = []
  for (const it of items) {
    if (win && it.at && (it.at < win[0] || it.at > win[1])) continue
    const title = String(it.title || '').toLowerCase()
    const url = String(it.url || '').toLowerCase()
    const host = hostOfUrl(it.url || '')
    const text = String(it.text || '').toLowerCase()
    let score = terms.length ? 0 : 1
    let hits = 0
    for (const t of terms) {
      const f = fold(t)
      let hit = false
      if (host.includes(t)) (score += 6), (hit = true)
      if (title.includes(t) || (f.length > 2 && title.includes(f))) (score += 4), (hit = true)
      if (url.includes(t) || (f.length > 2 && url.includes(f))) (score += 2), (hit = true)
      if (text && (text.includes(t) || (f.length > 2 && text.includes(f)))) (score += 1), (hit = true)
      if (hit) hits++
    }
    if (terms.length && !hits) continue
    if (terms.length) score *= hits / terms.length // all words beats some words
    if (it.at) score += Math.max(0, 1 - (now - it.at) / (60 * DAY)) // a little recency
    if (it.kind === 'bookmark') score += 0.5
    out.push({ ...it, score: Math.round(score * 100) / 100 })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

// ---------- kids mode ----------

const SAFE = [
  { re: /(^|\.)google\.[a-z.]+$/, path: /^\/search/, param: ['safe', 'active'] },
  { re: /(^|\.)bing\.com$/, path: /^\/(search|images|videos)/, param: ['adlt', 'strict'] },
  { re: /(^|\.)duckduckgo\.com$/, path: /^\/($|html|lite)/, param: ['kp', '1'] },
  { re: /(^|\.)search\.yahoo\.com$/, path: /^\/search/, param: ['vm', 'r'] },
  { re: /(^|\.)search\.brave\.com$/, path: /^\/search/, param: ['safesearch', 'strict'] },
  { re: /(^|\.)ecosia\.org$/, path: /^\/search/, param: ['sfs', 'true'] },
  { re: /(^|\.)startpage\.com$/, path: /^\/(do|sp)\/search/, param: ['qadf', 'heavy'] },
]

/** The search URL with strict safe search forced on, or null if no change is needed. */
export function safeSearchUrl(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  for (const r of SAFE) {
    if (!r.re.test(host) || !r.path.test(u.pathname)) continue
    if (u.searchParams.get(r.param[0]) === r.param[1]) return null
    u.searchParams.set(r.param[0], r.param[1])
    return u.toString()
  }
  return null
}

/** Does a host match a list entry like "example.com" (subdomains included)? */
export function hostInList(host, list = []) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '')
  return list.some((e) => {
    const x = String(e || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
    return x && (h === x || h.endsWith(`.${x}`))
  })
}

/**
 * Kids mode decision for a URL. kids = { mode: 'allow'|'block', allow: [], block: [] }.
 * 'allow' = only listed sites (plus the search engines' safe search); 'block' = everything but listed sites.
 */
export function kidsAllows(url, kids = {}) {
  if (!/^https?:/i.test(String(url || ''))) return true
  const host = hostOfUrl(url)
  if (hostInList(host, ALWAYS_BLOCK)) return false
  if (kids.mode === 'allow') return hostInList(host, [...(kids.allow || []), ...KID_SAFE])
  return !hostInList(host, kids.block || [])
}

/** Sites kids mode always allows in allow-list mode (safe search engines, kids' video). */
export const KID_SAFE = ['duckduckgo.com', 'kiddle.co', 'youtubekids.com', 'pbskids.org', 'wikipedia.org', 'khanacademy.org']
/** Sites kids mode always blocks (adult and gambling basics; the block list adds to these). */
export const ALWAYS_BLOCK = ['pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'onlyfans.com', 'chaturbate.com', 'stake.com', 'bet365.com']
