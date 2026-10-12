// Search engines the user can pick for the address bar. `%s` is the query.
// noAiUrl is used while the AI slider is off, where the engine offers one.
export const SEARCH_ENGINES = {
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', noAiUrl: 'https://noai.duckduckgo.com/?q=%s', home: 'https://duckduckgo.com', private: true, note: 'Private, no tracking.' },
  brave: { label: 'Brave Search', url: 'https://search.brave.com/search?q=%s', home: 'https://search.brave.com', private: true, note: 'Private, its own index.' },
  startpage: { label: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s', home: 'https://www.startpage.com', private: true, note: 'Private Google results.' },
  mojeek: { label: 'Mojeek', url: 'https://www.mojeek.com/search?q=%s', home: 'https://www.mojeek.com', private: true, note: 'Private, independent, no AI answers.' },
  qwant: { label: 'Qwant', url: 'https://www.qwant.com/?q=%s', home: 'https://www.qwant.com', private: true, note: 'Private, based in the EU.' },
  kagi: { label: 'Kagi', url: 'https://kagi.com/search?q=%s', home: 'https://kagi.com', private: true, note: 'Paid, no ads. Needs an account.' },
  ecosia: { label: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s', home: 'https://www.ecosia.org', private: false, note: 'Uses ad income to plant trees.' },
  google: { label: 'Google', url: 'https://www.google.com/search?q=%s', noAiUrl: 'https://www.google.com/search?udm=14&q=%s', home: 'https://www.google.com', private: false, note: 'Tracks searches. Shows plain web results (no AI Overviews) when AI is off.' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=%s', home: 'https://www.bing.com', private: false, note: 'Tracks searches.' },
  custom: { label: 'Custom', url: '', custom: true, note: 'Any search address with %s where the words go.' },
}

function isHttpTemplate(t) {
  return typeof t === 'string' && /^https?:\/\/[^\s]+$/i.test(t) && t.includes('%s')
}

/** Address-bar search URL for the chosen engine. */
export function searchUrlFor(engineId, query, { aiEnabled = true, customUrl = '' } = {}) {
  const e = SEARCH_ENGINES[engineId] || SEARCH_ENGINES.duckduckgo
  let tpl = e.custom ? customUrl : (!aiEnabled && e.noAiUrl) || e.url
  if (!isHttpTemplate(tpl)) tpl = SEARCH_ENGINES.duckduckgo.url
  return tpl.replace('%s', encodeURIComponent(query))
}

/** Home page for new tabs. */
export function searchHome(engineId, customUrl = '') {
  const e = SEARCH_ENGINES[engineId] || SEARCH_ENGINES.duckduckgo
  if (e.custom) {
    try {
      if (isHttpTemplate(customUrl)) return new URL(customUrl.replace('%s', '')).origin
    } catch {}
    return SEARCH_ENGINES.duckduckgo.home
  }
  return e.home
}

// Private web search for the assistant: DuckDuckGo's HTML endpoint, no
// account, no tracking. `fetchText` is supplied by the platform (Electron net
// on desktop, fetch on mobile) so it isn't subject to browser CORS rules.

export function searchUrl(query) {
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
}

export async function webSearch(query, fetchText, limit = 8) {
  const html = await fetchText(searchUrl(query))
  return parseDuckDuckGo(html).slice(0, limit)
}

export function parseDuckDuckGo(html) {
  const results = []
  const blocks = String(html).split(/class="result(?:\s|__body|")/).slice(1)
  for (const block of blocks) {
    const link = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!link) continue
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(a|div|td)>/)
    const url = unwrapDdgUrl(decodeEntities(link[1]))
    if (!url || results.some((r) => r.url === url)) continue
    results.push({ title: clean(link[2]), url, snippet: snippet ? clean(snippet[1]) : '' })
  }
  return results
}

function unwrapDdgUrl(href) {
  const m = href.match(/[?&]uddg=([^&]+)/)
  if (m) return decodeURIComponent(m[1])
  if (href.startsWith('//')) return `https:${href}`
  return href.startsWith('http') ? href : null
}

function clean(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
}

/** Heuristic: should address-bar input go to the AI instead of a URL/search? */
export function looksLikeQuestion(input) {
  const t = String(input || '').trim()
  if (!t || /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^[^\s]+\.[^\s]{2,}$/.test(t)) return false
  if (t.endsWith('?')) return true
  return /^(what|who|whom|whose|why|how|when|where|which|is|are|was|were|can|could|should|would|will|do|does|did|explain|compare|summari[sz]e|tell me|help me|write|plan|find me|recommend)\b/i.test(t) && t.split(/\s+/).length >= 3
}
