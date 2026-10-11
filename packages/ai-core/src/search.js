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
