// Bookmark importers: the "Export bookmarks" HTML file every browser makes
// (Netscape format) and Chrome/Brave/Edge's own Bookmarks JSON file.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' }
const decode = (s) =>
  String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e) => {
    if (ENTITIES[e.toLowerCase()] !== undefined) return ENTITIES[e.toLowerCase()]
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return m
  })
const strip = (s) => decode(String(s || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
const okUrl = (u) => /^https?:\/\//i.test(u)
// Top-level containers every browser adds; their contents go in the default folder.
const ROOTS = /^(bookmarks|bookmarks bar|bookmarks toolbar|bookmarks menu|other bookmarks|mobile bookmarks|favorites|favourites bar|favorites bar|toolbar)$/i

const folderName = (stack) => {
  const parts = stack.filter((f) => f && !ROOTS.test(f))
  return parts.length ? parts.join(' / ').slice(0, 60) : 'Bookmarks'
}

/** Netscape bookmark HTML → [{ url, title, folder, addedAt }]. */
export function parseBookmarksHtml(html) {
  const out = []
  const stack = []
  let pending = null // folder name waiting for its <DL>
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>|<a\s([^>]*)>([\s\S]*?)<\/a>|<dl[^>]*>|<\/dl>/gi
  let m
  while ((m = re.exec(String(html || '')))) {
    const tag = m[0].slice(0, 3).toLowerCase()
    if (m[1] !== undefined) pending = strip(m[1])
    else if (m[2] !== undefined) {
      const href = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(m[2])
      const url = decode(href ? href[1] ?? href[2] : '').trim()
      if (!okUrl(url)) continue
      const added = /add_date\s*=\s*"(\d+)"/i.exec(m[2])
      out.push({ url, title: strip(m[3]) || url, folder: folderName(stack), addedAt: added ? Number(added[1]) * 1000 : 0 })
    } else if (tag === '<dl') {
      stack.push(pending)
      pending = null
    } else stack.pop()
  }
  return dedupe(out)
}

/** Chrome/Brave/Edge "Bookmarks" profile file (JSON) → [{ url, title, folder, addedAt }]. */
export function parseChromeBookmarksJson(text) {
  const data = typeof text === 'string' ? JSON.parse(text) : text
  const out = []
  // Chrome stores times as microseconds since 1601-01-01.
  const chromeTime = (t) => (t ? Math.max(0, Math.round(Number(t) / 1000 - 11644473600000)) : 0)
  const walk = (node, stack) => {
    if (!node) return
    if (node.type === 'url' && okUrl(node.url)) out.push({ url: node.url, title: node.name || node.url, folder: folderName(stack), addedAt: chromeTime(node.date_added) })
    for (const child of node.children || []) walk(child, node.type === 'folder' ? [...stack, node.name] : stack)
  }
  for (const root of Object.values(data?.roots || {})) if (root && typeof root === 'object') walk(root, [])
  return dedupe(out)
}

function dedupe(list) {
  const seen = new Set()
  return list.filter((b) => (seen.has(b.url) ? false : seen.add(b.url)))
}
