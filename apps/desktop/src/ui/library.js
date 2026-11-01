// Library window: bookmarks manager (folders, search, rename, move, delete)
// and history (search, by day, delete, clear by time range).
const $ = (id) => document.getElementById(id)
const api = window.pixelLibrary
const make = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props)
  n.append(...kids)
  return n
}
const DEFAULT = 'Bookmarks'
let section = 'bookmarks'
let folder = DEFAULT
let data = { bookmarks: [], folders: [DEFAULT] }

const letterOf = (title, url) => {
  let host = ''
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {}
  return (title || host || '?').trim().charAt(0).toUpperCase()
}

const SECTIONS = ['bookmarks', 'history', 'packages', 'notes', 'reading', 'watchers']
function show(sec) {
  section = SECTIONS.includes(sec) ? sec : 'bookmarks'
  for (const id of SECTIONS) $(id).hidden = section !== id
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('on', a.dataset.sec === section)
  $('find').placeholder = { history: 'Search history', packages: 'Search packages', notes: 'Search notes', reading: 'Search reading list', watchers: 'Search watched pages' }[section] || 'Search bookmarks'
  render()
}

// ---------- bookmarks ----------

async function loadBookmarks() {
  data = await api.bookmarks()
  if (!data.folders.includes(folder)) folder = DEFAULT
}

function renderBookmarks() {
  const q = $('find').value.trim().toLowerCase()
  $('folders').replaceChildren(
    ...data.folders.map((f) => {
      const count = data.bookmarks.filter((b) => b.folder === f).length
      const b = make('button', { className: 'folder' + (f === folder && !q ? ' on' : ''), onclick: () => ((folder = f), ($('find').value = ''), render()) }, make('span', { textContent: f.toUpperCase() }), make('span', { textContent: String(count) }))
      return b
    })
  )
  $('folder-title').textContent = q ? 'SEARCH' : folder.toUpperCase()
  $('folder-rename').hidden = !!q || folder === DEFAULT
  $('folder-delete').hidden = !!q || folder === DEFAULT
  const shown = data.bookmarks.filter((b) => (q ? `${b.title} ${b.url}`.toLowerCase().includes(q) : b.folder === folder))
  if (!shown.length) {
    $('bm-list').replaceChildren(make('li', { className: 'muted', textContent: q ? 'No bookmarks match.' : 'No bookmarks in this folder yet.' }))
    return
  }
  $('bm-list').replaceChildren(
    ...shown.map((b) => {
      const title = make('a', { className: 't', textContent: b.title || b.url, title: 'Open (middle-click: new tab)', href: '#' })
      title.onclick = (e) => (e.preventDefault(), api.open(b.url, false))
      title.onauxclick = (e) => e.button === 1 && (e.preventDefault(), api.open(b.url, true))
      const text = make('div', { className: 'text' }, title, make('span', { className: 'u', textContent: b.url }))
      const move = make('select', { title: 'Move to folder' }, ...data.folders.map((f) => make('option', { value: f, textContent: f, selected: f === b.folder })))
      move.setAttribute('aria-label', 'Folder')
      move.onchange = async () => (await api.updateBookmark(b.id, { folder: move.value }), refresh())
      const rename = make('button', {
        className: 'px',
        textContent: 'RENAME',
        onclick: () => {
          const input = make('input', { className: 'edit', value: b.title || '' })
          input.setAttribute('aria-label', 'Bookmark name')
          const done = async () => (await api.updateBookmark(b.id, { title: input.value }), refresh())
          input.onkeydown = (e) => (e.key === 'Enter' ? done() : e.key === 'Escape' ? render() : null)
          input.onblur = done
          text.replaceChildren(input)
          input.focus()
          input.select()
        },
      })
      const del = make('button', { className: 'px', textContent: 'DELETE', onclick: async () => (await api.removeBookmark(b.id), refresh()) })
      return make('li', { className: 'item' }, make('span', { className: 'letter', textContent: letterOf(b.title, b.url) }), text, make('div', { className: 'acts' }, move, rename, del))
    })
  )
}

$('folder-add').onsubmit = async (e) => {
  e.preventDefault()
  const name = $('folder-name').value.trim()
  if (!name) return
  $('folder-name').value = ''
  await api.addFolder(name)
  folder = name
  refresh()
}
// (Electron has no window.prompt, so renaming happens in place.)
$('folder-rename').onclick = () => {
  const input = make('input', { className: 'edit', value: folder, maxLength: 60 })
  input.setAttribute('aria-label', 'Folder name')
  const done = async () => {
    const name = input.value.trim()
    if (name && name !== folder) {
      await api.renameFolder(folder, name)
      folder = name
    }
    refresh()
  }
  input.onkeydown = (e) => (e.key === 'Enter' ? done() : e.key === 'Escape' ? render() : null)
  input.onblur = done
  $('folder-title').replaceChildren(input)
  input.focus()
  input.select()
}
$('folder-delete').onclick = async () => {
  if (!confirm(`Delete the "${folder}" folder? Its bookmarks move to ${DEFAULT}.`)) return
  await api.removeFolder(folder)
  folder = DEFAULT
  refresh()
}

// ---------- history ----------

const dayLabel = (t) => {
  const d = new Date(t)
  const today = new Date()
  const y = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString()) return 'TODAY'
  if (d.toDateString() === y.toDateString()) return 'YESTERDAY'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()
}

async function renderHistory() {
  if ($('hist-words').checked && $('find').value.trim()) return renderHistoryWords()
  const list = await api.history($('find').value)
  if (!list.length) {
    $('hist').replaceChildren(make('p', { className: 'muted', textContent: $('find').value ? 'No history matches.' : 'No history yet. Private windows never save any.' }))
    return
  }
  const out = []
  let day = ''
  for (const h of list) {
    const label = dayLabel(h.visitedAt)
    if (label !== day) {
      day = label
      out.push(make('div', { className: 'day', textContent: label }))
    }
    const title = make('a', { className: 't', textContent: h.title || h.url, href: '#' })
    title.onclick = (e) => (e.preventDefault(), api.open(h.url, false))
    title.onauxclick = (e) => e.button === 1 && (e.preventDefault(), api.open(h.url, true))
    const del = make('button', { className: 'px', textContent: 'X', title: 'Delete from history', onclick: async () => (await api.removeHistory(h.id), renderHistory()) })
    del.setAttribute('aria-label', 'Delete from history')
    out.push(
      make(
        'div',
        { className: 'item' },
        make('span', { className: 'time', textContent: new Date(h.visitedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }),
        make('div', { className: 'text' }, title, make('span', { className: 'u', textContent: h.url })),
        make('div', { className: 'acts' }, del)
      )
    )
  }
  $('hist').replaceChildren(make('div', { className: 'hist' }, ...out))
}

$('clear-go').onclick = async () => {
  const range = $('clear-range').value
  const label = $('clear-range').selectedOptions[0].textContent.toLowerCase()
  if (!confirm(`Clear history from the ${label === 'all time' ? 'beginning' : label}?${$('clear-site').checked ? ' This also signs you out of websites.' : ''}`)) return
  const n = await api.clearHistory(range, $('clear-site').checked)
  $('clear-done').hidden = false
  $('clear-done').textContent = `Cleared ${n} pages.`
  setTimeout(() => ($('clear-done').hidden = true), 2500)
  renderHistory()
}

// ---------- 0.5: plain-words history search ----------

const v05 = (...a) => api.v05(...a)
const q = () => $('find').value.trim().toLowerCase()
const matches = (...fields) => !q() || fields.join(' ').toLowerCase().includes(q())
const ago = (t) => (t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never')
const openLink = (url, text) => {
  const a = make('a', { className: 't', textContent: text || url, href: '#' })
  a.onclick = (e) => (e.preventDefault(), api.open(url, false))
  a.onauxclick = (e) => e.button === 1 && (e.preventDefault(), api.open(url, true))
  return a
}
$('hist-words').onchange = () => renderHistory()

async function renderHistoryWords() {
  const list = await v05('history-words', $('find').value)
  if (!list.length) return $('hist').replaceChildren(make('p', { className: 'muted', textContent: 'Nothing matches those words. Try fewer or different words.' }))
  $('hist').replaceChildren(
    make('div', { className: 'hist' }, ...list.map((h) => make('div', { className: 'item' },
      make('span', { className: 'time', textContent: h.kind === 'history' ? 'PAGE' : h.kind.toUpperCase() }),
      make('div', { className: 'text' }, h.url ? openLink(h.url, h.title) : make('span', { className: 't', textContent: h.title }), make('span', { className: 'u', textContent: `${h.url || ''}  ·  ${ago(h.at)}` })),
      make('div', { className: 'acts' }))))
  )
}

// ---------- packages ----------

async function renderPackages() {
  const list = (await v05('packages')).filter((p) => matches(p.number, p.label, p.carrierName))
  if (!list.length) return $('pkg-list').replaceChildren(make('li', { className: 'muted', textContent: q() ? 'No packages match.' : 'No packages yet.' }))
  $('pkg-list').replaceChildren(...list.map((p) => {
    const done = make('button', { className: 'px', textContent: p.delivered ? 'DELIVERED' : 'MARK DELIVERED', onclick: async () => (await v05('package-update', p.id, { delivered: !p.delivered }), renderPackages()) })
    const del = make('button', { className: 'px', textContent: 'DELETE', onclick: async () => (await v05('package-remove', p.id), renderPackages()) })
    const track = make('button', { className: 'px hot', textContent: 'TRACK', onclick: () => api.open(p.url, true) })
    return make('li', { className: 'item' + (p.delivered ? ' dim' : '') }, make('span', { className: 'letter', textContent: (p.carrierName || '?').charAt(0) }),
      make('div', { className: 'text' }, make('span', { className: 't', textContent: `${p.carrierName} ${p.number}` }), make('span', { className: 'u', textContent: `${p.label || ''}${p.label ? '  ·  ' : ''}added ${ago(p.addedAt)}` })),
      make('div', { className: 'acts' }, track, done, del))
  }))
}
$('pkg-add').onsubmit = async (e) => {
  e.preventDefault()
  const id = await v05('package-add', $('pkg-number').value, $('pkg-label').value)
  $('pkg-msg').textContent = id ? 'Added.' : 'Paste a tracking number.'
  $('pkg-number').value = ''
  $('pkg-label').value = ''
  renderPackages()
}

// ---------- notes ----------

async function renderNotes() {
  const list = (await v05('notes')).filter((n) => matches(n.text, n.title, n.url))
  if (!list.length) return $('note-list').replaceChildren(make('li', { className: 'muted', textContent: q() ? 'No notes match.' : 'No notes yet.' }))
  $('note-list').replaceChildren(...list.map((n) => {
    const body = make('div', { className: 'text' }, make('span', { className: 'note', textContent: n.text || '(page)' }), n.url ? openLink(n.url, n.title || n.url) : make('span'), make('span', { className: 'u', textContent: `${(n.space || 'personal').toUpperCase()}  ·  ${ago(n.updatedAt)}` }))
    const edit = make('button', { className: 'px', textContent: 'EDIT', onclick: () => {
      const ta = make('textarea', { className: 'edit', value: n.text || '', rows: 4 })
      const save = async () => (await v05('note-update', n.id, { text: ta.value }), renderNotes())
      ta.onblur = save
      ta.onkeydown = (k) => k.key === 'Escape' && renderNotes()
      body.replaceChildren(ta)
      ta.focus()
    } })
    const del = make('button', { className: 'px', textContent: 'DELETE', onclick: async () => (await v05('note-remove', n.id), renderNotes()) })
    return make('li', { className: 'item' }, make('span', { className: 'letter', textContent: 'N' }), body, make('div', { className: 'acts' }, edit, del))
  }))
}
$('note-add').onsubmit = async (e) => {
  e.preventDefault()
  if (!$('note-text').value.trim()) return
  await v05('note-add', $('note-text').value)
  $('note-text').value = ''
  renderNotes()
}

// ---------- read later ----------

async function renderReading() {
  const list = (await v05('reading')).filter((r) => ($('read-show').checked || !r.read) && matches(r.title, r.url))
  if (!list.length) return $('read-list').replaceChildren(make('li', { className: 'muted', textContent: q() ? 'Nothing matches.' : 'Nothing saved to read later.' }))
  $('read-list').replaceChildren(...list.map((r) => {
    const title = make('a', { className: 't', textContent: r.title || r.url, href: '#' })
    title.onclick = (e) => (e.preventDefault(), v05('reading-open', r.id).then(renderReading))
    const mark = make('button', { className: 'px', textContent: r.read ? 'UNREAD' : 'MARK READ', onclick: async () => (await v05('reading-mark', r.id, !r.read), renderReading()) })
    const del = make('button', { className: 'px', textContent: 'DELETE', onclick: async () => (await v05('reading-remove', r.id), renderReading()) })
    return make('li', { className: 'item' + (r.read ? ' dim' : '') }, make('span', { className: 'letter', textContent: r.offline ? 'R' : 'L' }),
      make('div', { className: 'text' }, title, make('span', { className: 'u', textContent: `${r.offline ? 'OFFLINE  ·  ' : ''}${r.words ? `${Math.max(1, Math.round(r.words / 230))} min read  ·  ` : ''}${r.url}` })),
      make('div', { className: 'acts' }, mark, del))
  }))
}
$('read-show').onchange = () => renderReading()

// ---------- watchers ----------

async function renderWatchers() {
  const list = (await v05('watchers')).filter((w) => matches(w.title, w.url))
  if (!list.length) return $('watch-list').replaceChildren(make('li', { className: 'muted', textContent: 'Not watching any pages yet.' }))
  $('watch-list').replaceChildren(...list.map((w) => {
    const status = w.kind === 'price' ? (w.lastPrice ? `Price ${w.lastPrice}${w.currency ? ' ' + w.currency : ''}${w.history?.length > 1 ? `  ·  lowest ${Math.min(...w.history.map((h) => h.price))}` : ''}` : 'No price yet') : w.lastChange ? `Changed ${ago(w.lastChange)}` : 'No changes yet'
    const every = make('select', { title: 'How often to check' }, ...[[1, 'Every hour'], [6, 'Every 6 hours'], [24, 'Every day'], [168, 'Every week']].map(([h, t]) => make('option', { value: String(h), textContent: t, selected: Number(w.everyHours) === h })))
    every.onchange = () => v05('watcher-update', w.id, { everyHours: Number(every.value) })
    const run = make('button', { className: 'px', textContent: 'CHECK NOW', onclick: async () => { run.textContent = '…'; const r = await v05('watcher-run', w.id).catch((err) => ({ summary: err.message })); run.textContent = 'CHECK NOW'; msg.textContent = r.summary; renderWatchers() } })
    const del = make('button', { className: 'px', textContent: 'DELETE', onclick: async () => (await v05('watcher-remove', w.id), renderWatchers()) })
    const msg = make('span', { className: 'u', textContent: `${w.kind === 'price' ? 'PRICE' : 'CHANGES'}  ·  ${status}  ·  checked ${ago(w.lastRun)}${w.lastError ? `  ·  ${w.lastError}` : ''}` })
    return make('li', { className: 'item' }, make('span', { className: 'letter', textContent: w.kind === 'price' ? '$' : 'W' }), make('div', { className: 'text' }, openLink(w.url, w.title), msg), make('div', { className: 'acts' }, every, run, del))
  }))
}

// ---------- wiring ----------

async function refresh() {
  await loadBookmarks()
  render()
}
function render() {
  const fn = { history: renderHistory, packages: renderPackages, notes: renderNotes, reading: renderReading, watchers: renderWatchers }[section]
  if (fn) fn()
  else renderBookmarks()
}
let findTimer = null
$('find').addEventListener('input', () => {
  clearTimeout(findTimer)
  findTimer = setTimeout(render, 120)
})
for (const a of document.querySelectorAll('#nav a')) {
  a.onclick = (e) => {
    e.preventDefault()
    show(a.dataset.sec)
  }
}
api.onGoto((sec) => show(sec))
api.onChanged(() => refresh())
loadBookmarks().then(() => show(location.hash.slice(1) || 'bookmarks'))
