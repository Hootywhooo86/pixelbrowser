// Pixel shell renderer: draws tabs + toolbar from state pushed by main.js.
const $ = (id) => document.getElementById(id)
const tabsEl = $('tabs')
const address = $('address')
let state = { tabs: [], activeId: null }

if (new URLSearchParams(location.search).get('private') === '1') {
  document.body.classList.add('private')
  $('private').hidden = true
  $('store').hidden = true
  $('ask').hidden = true
  $('ai').hidden = true
  $('aitoggle').hidden = true
  $('space').hidden = true
}

function render() {
  tabsEl.replaceChildren(
    ...state.tabs.map((tab) => {
      const el = document.createElement('div')
      el.className = 'tab' + (tab.id === state.activeId ? ' active' : '') + (tab.loading ? ' loading' : '') + (tab.pinned ? ' pinned' : '')
      el.title = tab.pinned ? `${tab.title} (pinned)` : tab.title
      el.dataset.id = tab.id
      el.onclick = () => window.pixel.selectTab(tab.id)
      el.onauxclick = (e) => e.button === 1 && !tab.pinned && window.pixel.closeTab(tab.id)
      el.oncontextmenu = (e) => {
        e.preventDefault()
        window.pixel.tabMenu(tab.id)
      }
      // Pinned tabs: a small square with the site's first letter and a pin mark.
      if (tab.pinned) {
        const letter = document.createElement('span')
        letter.className = 'pin-letter'
        let host = ''
        try {
          host = new URL(tab.url).hostname.replace(/^www\./, '')
        } catch {}
        letter.textContent = (host || tab.title || '?').charAt(0).toUpperCase()
        const mark = document.createElement('i')
        mark.className = 'pin-mark'
        el.append(letter, mark)
        return el
      }

      const title = document.createElement('span')
      title.className = 'title'
      title.textContent = tab.title
      const close = document.createElement('button')
      close.className = 'close'
      close.textContent = 'x'
      close.title = 'Close tab'
      close.onclick = (e) => {
        e.stopPropagation()
        window.pixel.closeTab(tab.id)
      }
      el.append(title, close)
      return el
    })
  )

  const active = state.tabs.find((t) => t.id === state.activeId)
  $('back').disabled = !active?.canGoBack
  $('forward').disabled = !active?.canGoForward
  $('reload').textContent = active?.loading ? 'X' : 'R'
  $('reload').classList.toggle('loading', !!active?.loading)
  $('shield').textContent = state.shieldsDown ? 'OFF' : state.blockedCount > 999 ? '999+' : String(state.blockedCount || 0)
  $('shield').classList.toggle('down', !!state.shieldsDown)
  $('shield').title = state.shieldsDown
    ? `Bit Shields are down${state.site ? ' for ' + state.site : ''}. Click to turn them back up.`
    : `Bit Shields: ${state.blockedCount || 0} ads and trackers blocked on this page. Click for options.`
  const space = (state.spaces || []).find((x) => x.id === state.space)
  if (space) $('space').textContent = space.name.toUpperCase().slice(0, 10)
  $('tracker').hidden = !state.tracker
  if (state.tracker) $('tracker').title = `Add "${state.tracker}" to 128bittracker`
  document.body.classList.toggle('skin-chunky', state.skin === 'chunky')
  showLock(!!state.locked)
  if (active && document.activeElement !== address) address.value = active.url
  $('actions').setAttribute('tab', String(state.activeId ?? ''))
  $('ai').classList.toggle('on', !!state.sidebarOpen)
  const aiOn = state.aiEnabled !== false
  $('aitoggle').classList.toggle('on', aiOn)
  $('aitoggle').setAttribute('aria-checked', String(aiOn))
  $('aitoggle').title = aiOn ? 'AI is on. Slide off to keep everything private.' : 'AI is off: nothing is sent to any AI. Slide on to use Bitter.'
  if (!state.isPrivate) {
    $('ask').hidden = !aiOn
    $('ai').hidden = !aiOn
    address.placeholder = aiOn ? 'Search, type a URL, or ask AI a question' : 'Search or type a URL'
  }
  const ready = state.update?.state === 'ready'
  $('update').hidden = !ready
  if (ready) $('update').title = `Bit Browser ${state.update.version} is ready. Click to restart and update.`
  $('agentbadge').hidden = !state.agentActive
  document.body.classList.toggle('agent', !!state.agentActive)
  $('star').classList.toggle('on', !!state.bookmarked)
  $('star').hidden = !state.canBookmark
  $('star').title = state.bookmarked ? 'Bookmarked. Click to edit or remove (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'
  $('reader').hidden = !(state.readerable || state.inReader)
  $('reader').classList.toggle('on', !!state.inReader)
  $('reader').title = state.inReader ? 'Leave reader mode (Esc)' : 'Reader mode: just the article (Ctrl+Alt+R)'
  renderBookbar()
  renderPrompts()
}

// ---------- bookmarks bar ----------

function letter(text) {
  return (String(text || '?').trim().charAt(0) || '?').toUpperCase()
}

let lastBar = ''
function renderBookbar() {
  const bar = state.bar
  const show = !!state.bookmarksBar && !!bar
  $('bookbar').hidden = !show
  if (!show) return
  const key = JSON.stringify(bar)
  if (key === lastBar) return
  lastBar = key
  const items = bar.items.map((b) => {
    const el = document.createElement('button')
    el.className = 'bm'
    el.title = `${b.title}\n${b.url}`
    const l = document.createElement('i')
    l.className = 'l'
    l.textContent = letter(b.title)
    const t = document.createElement('span')
    t.textContent = b.title || b.url
    el.append(l, t)
    el.onclick = () => window.pixel.go(b.url)
    el.onauxclick = (e) => e.button === 1 && window.pixel.newTab(b.url)
    el.oncontextmenu = (e) => {
      e.preventDefault()
      window.pixel.bookmarkMenu(b.id)
    }
    return el
  })
  const folders = bar.folders.map((f) => {
    const el = document.createElement('button')
    el.className = 'bm folder'
    el.title = `${f} folder`
    const l = document.createElement('i')
    l.className = 'l'
    l.textContent = letter(f)
    const t = document.createElement('span')
    t.textContent = f
    el.append(l, t)
    el.onclick = () => window.pixel.folderMenu(f)
    return el
  })
  if (!items.length && !folders.length) {
    const hint = document.createElement('span')
    hint.className = 'hint'
    hint.textContent = 'Bookmark pages with the star in the address bar (Ctrl+D) and they show up here.'
    $('bookbar').replaceChildren(hint)
  } else $('bookbar').replaceChildren(...items, ...folders)
}

// ---------- info bars (permission prompts, passwords, quests) ----------

let lastPrompts = ''
function renderPrompts() {
  const list = state.prompts || []
  const key = JSON.stringify(list)
  if (key === lastPrompts) return
  lastPrompts = key
  $('prompts').replaceChildren(
    ...list.map((p) => {
      const el = document.createElement('div')
      el.className = `bar kind-${p.kind}`
      el.dataset.id = p.id
      const label = document.createElement('span')
      label.className = 'barlabel'
      label.textContent = p.label || p.kind.toUpperCase()
      const text = document.createElement('span')
      text.className = 'text'
      text.textContent = p.text
      text.title = p.text
      el.append(label, text)
      for (const b of p.buttons) {
        const btn = document.createElement('button')
        btn.className = 'pxbtn' + (b.hot ? ' hot' : '')
        btn.textContent = b.label
        btn.dataset.action = b.id
        btn.onclick = () => window.pixel.answerPrompt(p.id, b.id)
        el.append(btn)
      }
      return el
    })
  )
}

// ---------- find in page ----------

function openFind(text) {
  $('findbar').hidden = false
  if (typeof text === 'string' && text) $('findq').value = text
  $('findq').focus()
  $('findq').select()
  if ($('findq').value) window.pixel.find($('findq').value, { findNext: false })
}
function closeFind() {
  if ($('findbar').hidden) return
  $('findbar').hidden = true
  $('findcount').textContent = ''
  $('findq').classList.remove('none')
  window.pixel.stopFind()
}
$('findq').addEventListener('input', () => {
  const q = $('findq').value
  if (q) window.pixel.find(q, { findNext: false })
  else {
    window.pixel.stopFind(true)
    $('findcount').textContent = ''
    $('findq').classList.remove('none')
  }
})
$('findbar').addEventListener('submit', (e) => e.preventDefault())
$('findq').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    if ($('findq').value) window.pixel.find($('findq').value, { findNext: true, forward: !e.shiftKey })
  } else if (e.key === 'Escape') closeFind()
})
$('findnext').onclick = () => $('findq').value && window.pixel.find($('findq').value, { findNext: true, forward: true })
$('findprev').onclick = () => $('findq').value && window.pixel.find($('findq').value, { findNext: true, forward: false })
$('findclose').onclick = closeFind
window.pixel.onFind((cmd) => {
  if (cmd.open) openFind(cmd.text)
  if (cmd.close) closeFind()
  if (cmd.result) {
    const r = cmd.result
    $('findcount').textContent = r.matches ? `${r.activeMatchOrdinal} of ${r.matches}` : 'No matches'
    $('findq').classList.toggle('none', !r.matches)
  }
})

// ---------- shell height (tabs sit right below the shell) ----------

let reported = 0
new ResizeObserver(() => {
  if (document.body.classList.contains('locked')) return
  const h = Math.ceil($('shell').getBoundingClientRect().height)
  if (h && h !== reported) {
    reported = h
    window.pixel.shellHeight(h)
  }
}).observe($('shell'))

// ---------- toast ----------

let toastTimer = null
window.pixel.onToast((text) => {
  $('toast').textContent = text
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($('toast').hidden = true), 5000)
})

window.pixel.onState((next) => {
  state = next
  render()
})

$('addressform').addEventListener('submit', (e) => {
  e.preventDefault()
  window.pixel.go(address.value)
  address.blur()
})
// Shift+Enter always sends the address bar to the AI (when AI is on).
address.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey && state.aiEnabled !== false) {
    e.preventDefault()
    window.pixel.ask(address.value)
    address.blur()
  }
})
$('ask').onclick = () => {
  if (address.value.trim() && address.value !== state.tabs.find((t) => t.id === state.activeId)?.url) window.pixel.ask(address.value)
  else window.pixel.toggleSidebar()
}
$('ai').onclick = () => window.pixel.toggleSidebar()
$('settings').onclick = () => window.pixel.openSettings()
$('update').onclick = () => window.pixel.installUpdate()
$('aitoggle').onclick = () => window.pixel.setAIEnabled(state.aiEnabled === false)
address.addEventListener('focus', () => address.select())
$('newtab').onclick = () => window.pixel.newTab()
$('back').onclick = () => window.pixel.back()
$('forward').onclick = () => window.pixel.forward()
$('reload').onclick = () => {
  const active = state.tabs.find((t) => t.id === state.activeId)
  active?.loading ? window.pixel.stop() : window.pixel.reload()
}
$('store').onclick = () => window.pixel.openExtensionStore()
$('private').onclick = () => window.pixel.newPrivateWindow()

$('shield').onclick = () => window.pixel.shieldsMenu()
$('star').onclick = () => window.pixel.toggleBookmark()
$('reader').onclick = () => window.pixel.toggleReader()
$('menu').onclick = () => window.pixel.appMenu()
$('space').onclick = () => window.pixel.spaceMenu()
$('panic').onclick = () => window.pixel.panic()
$('tracker').onclick = () => window.pixel.addToTracker()

// ---------- private window lock ----------

function showLock(locked) {
  const was = !$('lock').hidden
  $('lock').hidden = !locked
  document.body.classList.toggle('locked', locked)
  if (locked && !was) setTimeout(() => $('pin').focus(), 50)
}
$('lockform').addEventListener('submit', async (e) => {
  e.preventDefault()
  const ok = await window.pixel.unlock($('pin').value)
  $('pinerr').hidden = ok
  $('pin').value = ''
})

// ---------- retro sounds (off by default; Settings → Appearance) ----------

let audio = null
function beep(notes) {
  try {
    audio = audio || new AudioContext()
    let t = audio.currentTime
    for (const [freq, dur] of notes) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'square'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.04, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.connect(gain).connect(audio.destination)
      osc.start(t)
      osc.stop(t + dur)
      t += dur
    }
  } catch {}
}
const SOUNDS = {
  tab: [[660, 0.05], [880, 0.07]],
  block: [[220, 0.04]],
  levelup: [[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.16]],
}
window.pixel.onSound((kind) => state.sounds && SOUNDS[kind] && beep(SOUNDS[kind]))

// Finished downloads: a small notice in the corner. Click to open, or show it in its folder.
if (window.pixel.onDownload) {
  let timer = null
  window.pixel.onDownload((d) => {
    if (d.state !== 'completed' && d.state !== 'interrupted') return
    let box = document.getElementById('dl-notice')
    if (!box) {
      box = document.createElement('div')
      box.id = 'dl-notice'
      box.style.cssText = 'position:fixed;right:12px;top:52px;z-index:50;display:flex;gap:8px;align-items:center;padding:8px 10px;background:var(--panel);color:var(--ink);border:3px solid var(--edge);box-shadow:4px 4px 0 #05050f;font-size:12px;max-width:420px'
      document.body.appendChild(box)
    }
    box.textContent = ''
    const label = document.createElement('span')
    label.textContent = d.state === 'completed' ? `Downloaded ${d.name}` : `Download failed: ${d.name}`
    label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1'
    box.appendChild(label)
    if (d.state === 'completed') {
      for (const [text, fn] of [['OPEN', () => window.pixel.openDownload(d.id)], ['SHOW', () => window.pixel.showDownload(d.id)]]) {
        const b = document.createElement('button')
        b.className = 'pxbtn'
        b.textContent = text
        b.onclick = () => (fn(), box.remove())
        box.appendChild(b)
      }
    }
    clearTimeout(timer)
    timer = setTimeout(() => box.remove(), 8000)
  })
}
