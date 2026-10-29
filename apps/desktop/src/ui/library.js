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

function show(sec) {
  section = sec === 'history' ? 'history' : 'bookmarks'
  $('bookmarks').hidden = section !== 'bookmarks'
  $('history').hidden = section !== 'history'
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('on', a.dataset.sec === section)
  $('find').placeholder = section === 'history' ? 'Search history' : 'Search bookmarks'
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

// ---------- wiring ----------

async function refresh() {
  await loadBookmarks()
  render()
}
function render() {
  if (section === 'history') renderHistory()
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
