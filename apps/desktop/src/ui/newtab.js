// The pixel new tab page. main.js fills it in with window.__ntp(data) once
// the page has loaded; the search box and EDIT link go to a made-up
// address that main.js catches (the page has no other way to talk to it).
const $ = (id) => document.getElementById(id)
const fmt = (n) => Number(n || 0).toLocaleString()
const make = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props)
  n.append(...kids)
  return n
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

window.__ntp = (d) => {
  $('tiles').replaceChildren(
    ...(d.shortcuts || []).map((s) => {
      const name = s.title || hostOf(s.url)
      return make('a', { className: 'tile', href: s.url, title: s.url }, make('span', { className: 'letter', textContent: (name || '?').charAt(0).toUpperCase() }), make('span', { className: 'name', textContent: name }))
    })
  )
  $('blocked').textContent = fmt(d.blocked)
  $('level').textContent = d.xp?.level || 1
  $('xp').textContent = fmt(d.xp?.xp)
  $('streak').textContent = d.xp?.streak || 0
  $('quests').replaceChildren(
    ...(d.quests || []).map((q) =>
      make(
        'li',
        { className: q.done ? 'done' : '' },
        make('span', { className: 'title', textContent: `${q.title} (+${q.xp} XP)` }),
        make('span', { className: 'muted', textContent: `${fmt(q.progress)} / ${fmt(q.goal)}` }),
        make('div', { className: 'bar' }, Object.assign(make('i'), { style: `width:${Math.round((100 * Math.min(q.progress, q.goal)) / q.goal)}%` }))
      )
    )
  )
  if (d.pinned?.length) $('pinned').replaceChildren(...d.pinned.map((t) => make('li', {}, make('a', { href: t.url, textContent: t.title || t.url }))))
  if (d.remote?.length) {
    $('remote').replaceChildren(
      ...d.remote.flatMap((dev) => [make('li', { className: 'device', textContent: dev.deviceName }), ...dev.tabs.slice(0, 8).map((t) => make('li', {}, make('a', { href: t.url, textContent: t.title || t.url })))])
    )
  }
}

$('search').addEventListener('submit', (e) => {
  e.preventDefault()
  const q = $('q').value.trim()
  if (q) location.href = 'https://newtab.bitbrowser.invalid/go?q=' + encodeURIComponent(q)
})
