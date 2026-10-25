// Pull the sources out of an answer so the UI can show them as chips:
// markdown links [title](https://…) and tab markers [tab 3].

export function parseCitations(text) {
  const out = []
  const seen = new Set()
  const s = String(text || '')
  for (const m of s.matchAll(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g)) {
    const url = m[2]
    if (seen.has(url)) continue
    seen.add(url)
    let host = ''
    try {
      host = new URL(url).host.replace(/^www\./, '')
    } catch {}
    out.push({ type: 'link', url, title: m[1].trim(), host })
  }
  for (const m of s.matchAll(/\[tab\s*#?(\d+)\]/gi)) {
    const key = `tab:${m[1]}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ type: 'tab', tabId: Number(m[1]) })
  }
  return out
}
