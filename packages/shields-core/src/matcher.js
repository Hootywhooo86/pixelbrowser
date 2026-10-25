// Fast request matching against compiled network host sets.

/** Hostname of a URL, lowercased, without port or credentials. '' if none. */
export function hostOf(url) {
  const s = String(url || '')
  const start = s.indexOf('://')
  if (start < 0) return ''
  let end = s.length
  for (let i = start + 3; i < s.length; i++) {
    const c = s[i]
    if (c === '/' || c === '?' || c === '#') {
      end = i
      break
    }
  }
  let host = s.slice(start + 3, end)
  const at = host.lastIndexOf('@')
  if (at >= 0) host = host.slice(at + 1)
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1).toLowerCase()
  const colon = host.indexOf(':')
  if (colon >= 0) host = host.slice(0, colon)
  return host.toLowerCase().replace(/\.$/, '')
}

/** host, then each parent domain: a.b.example.com -> b.example.com -> example.com -> com */
export function* parents(host) {
  let h = host
  while (h) {
    yield h
    const dot = h.indexOf('.')
    if (dot < 0) return
    h = h.slice(dot + 1)
  }
}

/** Rough "same site" check without the public suffix list (good enough for $third-party). */
export function siteOf(host) {
  const parts = String(host || '').split('.')
  if (parts.length <= 2) return host
  const tld = parts[parts.length - 1]
  const sld = parts[parts.length - 2]
  const take = tld.length === 2 && sld.length <= 3 ? 3 : 2 // example.co.uk
  return parts.slice(-take).join('.')
}

export function findIn(set, host) {
  for (const h of parents(host)) if (set.has(h)) return h
  return null
}

/** Builds a matcher from compiled `network` data (arrays or Sets). */
export function createMatcher(network) {
  const toSet = (x) => (x instanceof Set ? x : new Set(x || []))
  const block = toSet(network?.block)
  const block3p = toSet(network?.block3p)
  const allow = toSet(network?.allow)
  const pageAllow = toSet(network?.pageAllow)
  const paths = network?.paths || {}
  return {
    size: block.size + block3p.size,
    /** True if a request to `url` from a page at `pageUrl` should be blocked. */
    isBlocked(url, pageUrl) {
      const host = hostOf(url)
      if (!host) return false
      const pageHost = hostOf(pageUrl)
      if (pageHost && findIn(pageAllow, pageHost)) return false
      const third = !pageHost || siteOf(host) !== siteOf(pageHost)
      let hit = findIn(block, host)
      if (!hit && block3p.size && third) hit = findIn(block3p, host)
      if (!hit) hit = pathHit(paths, host, url, third)
      if (!hit) return false
      return !findIn(allow, host)
    },
  }
}

/** ||host/path rules: the rule host if one of its path patterns matches `url`. */
export function pathHit(paths, host, url, thirdParty) {
  let rest = null
  for (const h of parents(host)) {
    const rules = paths[h]
    if (!rules) continue
    if (rest === null) {
      const s = String(url)
      const start = s.indexOf(host, s.indexOf('://') + 3)
      rest = s.slice(start + host.length).toLowerCase()
    }
    for (const r of rules) {
      if (r.t && !thirdParty) continue
      let at = 0
      let ok = true
      for (const part of r.p) {
        const i = rest.indexOf(part, at)
        if (i < 0) {
          ok = false
          break
        }
        at = i + part.length
      }
      if (ok) return h
    }
  }
  return null
}

/** Lines of a hosts file or plain domain list -> unique lowercase hosts. */
export function parseHostsList(text) {
  const out = new Set()
  for (let line of String(text || '').split(/\r?\n/)) {
    const hash = line.indexOf('#')
    if (hash >= 0) line = line.slice(0, hash)
    line = line.trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    let host = parts.length > 1 && /^(0\.0\.0\.0|127\.0\.0\.1|::1?|::)$/.test(parts[0]) ? parts[1] : parts[0]
    host = host.toLowerCase().replace(/^\|\|/, '').replace(/\^$/, '').replace(/\.$/, '')
    if (!host || host === 'localhost' || host === '0.0.0.0' || !host.includes('.') || /[^a-z0-9._-]/.test(host)) continue
    out.add(host)
  }
  return [...out]
}
