// Password importers for the CSV files browsers and password managers export.

/** RFC 4180-ish CSV parser (quotes, doubled quotes, CRLF, newlines in quotes). */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const s = String(text || '').replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') (field += '"'), i++
        else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') row.push(field), (field = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) row.push(field), rows.push(row)
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

// Column names used by Chrome/Brave/Edge, Firefox, Safari, Bitwarden, 1Password, LastPass, Dashlane, KeePass.
const COLS = {
  url: ['url', 'login_uri', 'website', 'web site', 'origin', 'hostname', 'login url', 'address'],
  username: ['username', 'login_username', 'login', 'user', 'email', 'user name', 'login name'],
  password: ['password', 'login_password', 'pass'],
  note: ['note', 'notes', 'extra', 'comments'],
  name: ['name', 'title', 'item'],
}

/** Password CSV → { logins: [{ url, username, password, note, name }], skipped, format }. */
export function parsePasswordsCsv(text) {
  const rows = parseCsv(text)
  if (rows.length < 2) return { logins: [], skipped: 0, format: 'unknown' }
  const head = rows[0].map((h) => h.trim().toLowerCase())
  const col = (k) => head.findIndex((h) => COLS[k].includes(h))
  const idx = { url: col('url'), username: col('username'), password: col('password'), note: col('note'), name: col('name') }
  if (idx.password < 0) return { logins: [], skipped: rows.length - 1, format: 'unknown' }
  const format = head.includes('login_uri') ? 'bitwarden' : head.includes('httprealm') ? 'firefox' : head.includes('extra') && head.includes('grouping') ? 'lastpass' : head.includes('origin') ? 'chrome-old' : 'chrome'
  const logins = []
  let skipped = 0
  for (const r of rows.slice(1)) {
    const get = (i) => (i >= 0 ? String(r[i] ?? '').trim() : '')
    let url = get(idx.url)
    const password = idx.password >= 0 ? String(r[idx.password] ?? '') : ''
    if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && /^[^\s/]+\.[^\s]+/.test(url)) url = `https://${url}`
    if (!password || !/^https?:\/\//i.test(url)) {
      skipped++
      continue
    }
    logins.push({ url, username: get(idx.username), password, note: get(idx.note), name: get(idx.name) })
  }
  return { logins, skipped, format }
}
