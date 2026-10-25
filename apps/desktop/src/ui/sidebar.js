// Bitter sidebar: chat, Ask/Agent modes, tab context, AI web apps,
// settings, memory and sync. Talks to main.js through window.pixelAI.
const $ = (id) => document.getElementById(id)
const ai = window.pixelAI
const isPrivate = new URLSearchParams(location.search).get('private') === '1'

let state = null // from sidebar:get-state
let mode = 'ask'
let busy = false
let includePage = true
let pickedTabs = new Set()
let currentAI = null // element receiving assistant text for this turn

// ---------- tiny safe markdown ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/_\(([^)]+)\)_/g, '<i>($1)</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t, u) => `<a href="#" data-url="${u}">${t}</a>`)
    .replace(/\[tab\s*#?(\d+)\]/gi, (_m, n) => `<a href="#" class="tabref" data-tab="${n}">tab ${n}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, pre, u) => `${pre}<a href="#" data-url="${u}">${u.length > 50 ? u.slice(0, 50) + '…' : u}</a>`)
}

function markdown(src) {
  const out = []
  const parts = esc(src).split(/```[a-z]*\n?/)
  parts.forEach((part, i) => {
    if (i % 2 === 1) return out.push(`<pre><code>${part}</code></pre>`)
    let list = null
    for (const line of part.split('\n')) {
      const ul = line.match(/^\s*[-*•]\s+(.*)/)
      const ol = line.match(/^\s*\d+[.)]\s+(.*)/)
      const h = line.match(/^#{1,4}\s+(.*)/)
      if (ul || ol) {
        const tag = ul ? 'ul' : 'ol'
        if (list !== tag) {
          if (list) out.push(`</${list}>`)
          out.push(`<${tag}>`)
          list = tag
        }
        out.push(`<li>${inline((ul || ol)[1])}</li>`)
        continue
      }
      if (list) {
        out.push(`</${list}>`)
        list = null
      }
      if (h) out.push(`<h4>${inline(h[1])}</h4>`)
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`)
    }
    if (list) out.push(`</${list}>`)
  })
  return out.join('')
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-url], [data-url].src')
  if (a) {
    e.preventDefault()
    ai.openUrl(a.dataset.url)
  }
  const t = e.target.closest('[data-tab]')
  if (t) {
    e.preventDefault()
    ai.selectTab(Number(t.dataset.tab))
  }
})

// ---------- views ----------

function show(view) {
  for (const v of ['chat', 'apps', 'settings', 'log']) $(`${v}-view`).hidden = v !== view
  $('btn-settings').classList.toggle('hot', view === 'settings')
  $('btn-apps').classList.toggle('hot', view === 'apps')
  if (view === 'settings') renderSettings()
  if (view === 'log') renderLog()
}

$('btn-settings').onclick = () => show($('settings-view').hidden ? 'settings' : 'chat')
$('btn-apps').onclick = () => show($('apps-view').hidden ? 'apps' : 'chat')
$('btn-close').onclick = () => ai.close()
$('btn-new').onclick = () => {
  ai.newChat()
  show('chat')
}

function setAppMode(app) {
  const inApp = !!app
  $('btn-back').hidden = !inApp
  $('btn-share').hidden = !inApp
  $('appname').hidden = !inApp
  $('brand').hidden = inApp
  $('btn-apps').hidden = inApp
  $('btn-new').hidden = inApp
  $('btn-settings').hidden = inApp
  if (inApp) $('appname').textContent = (state.webApps[app]?.label || 'AI app').toUpperCase()
}

$('btn-back').onclick = () => {
  ai.closeApp()
  setAppMode(null)
  show('chat')
}
$('btn-share').onclick = () => ai.sharePage()

// ---------- chat ----------

function addMsg(cls, html) {
  $('empty').hidden = true
  const el = document.createElement('div')
  el.className = `msg ${cls}`
  el.innerHTML = html
  $('messages').appendChild(el)
  $('messages').scrollTop = $('messages').scrollHeight
  return el
}

const TOOL_TEXT = {
  list_tabs: () => 'checking your tabs',
  read_tab: (i) => `reading tab ${i.tab_id ?? ''}`,
  web_search: (i) => `searching: ${i.query}`,
  open_tab: (i) => `opening ${i.url}`,
  remember: (i) => `remembering: ${i.fact}`,
  forget: (i) => `forgetting: ${i.fact}`,
  look: () => 'looking at the page',
  click: (i) => `clicking #${i.ref}`,
  type: (i) => `typing "${String(i.text || '').slice(0, 40)}"`,
  select_option: (i) => `choosing ${i.value}`,
  press_key: (i) => `pressing ${i.key}`,
  scroll: (i) => `scrolling ${i.direction}`,
  navigate: (i) => `going to ${i.url}`,
  go_back: () => 'going back',
  switch_tab: (i) => `switching to tab ${i.tab_id}`,
  wait: () => 'waiting',
}
let lastTool = null

ai.onEvent((e) => {
  switch (e.type) {
    case 'reset':
      $('messages').querySelectorAll('.msg, .tool, .confirm').forEach((el) => el.remove())
      $('empty').hidden = false
      break
    case 'user':
      addMsg('user', `<span class="tag">${e.mode === 'agent' ? 'AGENT' : 'ASK'}</span>${esc(e.text)}`)
      currentAI = null
      break
    case 'status':
      $('status').hidden = false
      $('status').textContent = e.text
      break
    case 'text':
      currentAI = addMsg('ai', markdown(e.text) + sourcesHtml(e.sources))
      talk()
      break
    case 'tool': {
      $('empty').hidden = true
      lastTool = document.createElement('div')
      lastTool.className = 'tool'
      lastTool.textContent = `> ${(TOOL_TEXT[e.name] || (() => e.name))(e.input || {})}`
      $('messages').appendChild(lastTool)
      $('messages').scrollTop = $('messages').scrollHeight
      break
    }
    case 'tool_done':
      lastTool?.classList.add(e.ok ? 'done' : 'fail')
      break
    case 'confirm':
      showConfirm(e)
      break
    case 'error': {
      const el = addMsg('error', esc(e.message))
      if (e.openSettings) {
        const b = document.createElement('button')
        b.className = 'px hot'
        b.textContent = 'OPEN AI SETTINGS'
        b.onclick = () => show('settings')
        el.appendChild(document.createElement('br'))
        el.appendChild(b)
      }
      break
    }
    case 'notice':
      addMsg('notice', esc(e.text))
      break
    case 'busy':
      busy = e.busy
      setMascot(busy ? 'think' : 'idle')
      $('send').textContent = busy ? 'STOP' : 'SEND'
      $('send').classList.toggle('hot', !busy)
      if (!busy) $('status').hidden = true
      break
  }
})

function showConfirm(e) {
  $('empty').hidden = true
  const el = document.createElement('div')
  el.className = 'confirm'
  el.innerHTML = `<div class="q">${e.kind === 'read' ? 'SHARE THIS PAGE?' : 'ALLOW THIS STEP?'}</div>
    <div>${esc(e.reason)}</div>
    ${e.url ? `<div class="url">${esc(e.url)}</div>` : ''}
    <div class="row"><button class="px">ALLOW</button><button class="px">NO</button></div>`
  const [yes, no] = el.querySelectorAll('button')
  const answer = (ok) => {
    ai.confirm(e.id, ok)
    el.classList.add('answered')
    yes.disabled = no.disabled = true
    el.querySelector('.q').textContent = ok ? 'ALLOWED' : 'DECLINED'
  }
  yes.onclick = () => answer(true)
  no.onclick = () => answer(false)
  $('messages').appendChild(el)
  $('messages').scrollTop = $('messages').scrollHeight
}

// Source chips under an answer: links open in a new tab, [tab N] switches tabs.
function sourcesHtml(sources) {
  if (!sources?.length) return ''
  const chips = sources.map((s) =>
    s.type === 'tab'
      ? `<button class="src" data-tab="${s.tabId}" title="Switch to tab ${s.tabId}">TAB ${s.tabId}</button>`
      : `<button class="src" data-url="${esc(s.url)}" title="${esc(s.title)} - ${esc(s.url)}">${esc(s.host || s.title).slice(0, 28)}</button>`
  )
  return `<div class="sources"><span class="muted">SOURCES</span>${chips.join('')}</div>`
}

function send(text, extra = {}) {
  const input = (text ?? $('input').value).trim()
  if (!input) return
  const tabIds = pickedTabs.size ? [...pickedTabs] : undefined
  ai.ask({ input, mode, tabIds, includePage, ...extra })
  $('input').value = ''
}

// ---------- quick actions ----------

const isYouTubeWatch = (url) => {
  try {
    const u = new URL(url)
    const host = u.host.replace(/^(www|m|music)\./, '')
    if (host === 'youtu.be') return u.pathname.length > 1
    return host === 'youtube.com' && ((u.pathname === '/watch' && u.searchParams.has('v')) || u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/live/'))
  } catch {
    return false
  }
}

$('q-page').onclick = () => !busy && send('Summarize this page in 5 short bullet points, then one line on why it matters.', { mode: 'ask', includePage: true, tabIds: undefined })
$('q-video').onclick = () => !busy && send('Summarize this video: the main points in order, with rough timestamps if the captions show them, then a one-line takeaway.', { mode: 'ask', includePage: false, tabIds: undefined, video: true })

// ---------- mascot ----------

const FRAMES = { idle: ['idle1', 'idle2'], think: ['think1', 'think2'], talk: ['talk1', 'talk2'] }
const TIMING = { idle: [2600, 160], think: [380, 380], talk: [180, 180] }
let mascotState = 'idle'
let mascotTimer = null
let talkTimer = null
function setMascot(next) {
  if (next === mascotState && mascotTimer) return
  mascotState = next
  clearTimeout(mascotTimer)
  let i = 0
  const tick = () => {
    $('mascot').src = `img/bitter-${FRAMES[mascotState][i]}-64.png`
    mascotTimer = setTimeout(() => {
      i = (i + 1) % 2
      tick()
    }, TIMING[mascotState][i])
  }
  tick()
}
function talk() {
  setMascot('talk')
  clearTimeout(talkTimer)
  talkTimer = setTimeout(() => setMascot(busy ? 'think' : 'idle'), 1600)
}
$('mascot').addEventListener('error', () => {
  $('mascot').hidden = true
  $('mark').hidden = false
  clearTimeout(mascotTimer)
})
setMascot('idle')

// ---------- agent activity log ----------

$('btn-log').onclick = () => show('log')
$('log-back').onclick = () => show('chat')
$('log-clear').onclick = async () => {
  await ai.clearLog()
  renderLog()
}

async function renderLog() {
  const entries = await ai.log()
  const list = $('log-list')
  if (!entries.length) {
    list.innerHTML = '<li class="muted">Nothing yet. Steps appear here when Bitter works in Agent mode.</li>'
    return
  }
  list.replaceChildren(
    ...entries.map((e) => {
      const li = document.createElement('li')
      li.className = e.kind === 'confirm' ? 'confirm-log' : ''
      const when = document.createElement('span')
      when.className = 'when'
      when.textContent = new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      const text = document.createElement('span')
      text.className = 'what'
      text.textContent = e.text
      li.append(when, text)
      if (e.site) {
        const site = document.createElement('span')
        site.className = 'site'
        try {
          site.textContent = new URL(e.site).host
        } catch {
          site.textContent = e.site
        }
        li.append(site)
      }
      return li
    })
  )
}

$('send').onclick = () => (busy ? ai.stop() : send())
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (!busy) send()
  }
})

document.querySelectorAll('.suggestions button').forEach((b) => {
  b.onclick = async () => {
    if (b.dataset.alltabs) {
      const tabs = await ai.tabs()
      pickedTabs = new Set(tabs.map((t) => t.id))
      await renderContext()
    }
    send(b.dataset.q)
  }
})

document.querySelectorAll('.modes button').forEach((b) => {
  b.onclick = () => {
    mode = b.dataset.mode
    document.querySelectorAll('.modes button').forEach((x) => x.classList.toggle('on', x === b))
    $('input').placeholder = mode === 'agent' ? 'Tell Bitter what to do on this page…' : 'Ask about this page…'
    $('suggest-ask').hidden = mode === 'agent'
    $('suggest-agent').hidden = mode !== 'agent'
  }
})

// Which tabs go along with the question.
async function renderContext() {
  const tabs = await ai.tabs()
  updateVideoButton(tabs)
  for (const id of pickedTabs) if (!tabs.some((t) => t.id === id)) pickedTabs.delete(id)
  const row = $('context-row')
  row.replaceChildren()
  if (pickedTabs.size) {
    const chip = document.createElement('button')
    chip.className = 'chip on'
    chip.textContent = `${pickedTabs.size} TAB${pickedTabs.size > 1 ? 'S' : ''} ×`
    chip.title = 'Clear chosen tabs'
    chip.onclick = () => {
      pickedTabs.clear()
      renderContext()
    }
    row.appendChild(chip)
  } else {
    const active = tabs.find((t) => t.active)
    const chip = document.createElement('button')
    chip.className = `chip${includePage ? ' on' : ''}`
    chip.textContent = includePage ? `THIS TAB: ${(active?.title || 'New tab').slice(0, 28)}` : 'NO PAGE'
    chip.title = 'Click to turn sending this page on or off'
    chip.onclick = () => {
      includePage = !includePage
      renderContext()
    }
    row.appendChild(chip)
  }
  const add = document.createElement('button')
  add.className = 'chip'
  add.textContent = '+ TABS'
  add.title = 'Choose which tabs Bitter can read'
  add.onclick = () => {
    $('tabpicker').hidden = !$('tabpicker').hidden
    renderPicker(tabs)
  }
  row.appendChild(add)
}

function renderPicker(tabs) {
  const box = $('tabpicker')
  box.replaceChildren(
    ...tabs.map((t) => {
      const label = document.createElement('label')
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = pickedTabs.has(t.id)
      cb.onchange = () => {
        cb.checked ? pickedTabs.add(t.id) : pickedTabs.delete(t.id)
        renderContext()
      }
      const span = document.createElement('span')
      span.textContent = t.title
      label.append(cb, span)
      return label
    })
  )
}

// ---------- apps ----------

function renderApps() {
  $('app-grid').replaceChildren(
    ...Object.entries(state.webApps).map(([id, app]) => {
      const b = document.createElement('button')
      b.className = 'px'
      b.textContent = app.label.toUpperCase()
      b.onclick = () => openApp(id, app.url)
      return b
    })
  )
}

function openApp(id, url) {
  ai.openApp(id, url)
  setAppMode(id)
}

$('custom-app').onsubmit = (e) => {
  e.preventDefault()
  let url = $('custom-app-url').value.trim()
  if (!url) return
  if (!/^https?:\/\//.test(url)) url = `https://${url}`
  state.webApps.custom = { label: new URL(url).hostname, url }
  openApp('custom', url)
}

// ---------- settings ----------

function renderProviderLabel() {
  const p = state.providers[state.provider]
  $('provider-label').textContent = `${p.label.split(' (')[0]} · ${p.model || '?'}`
}

function renderSettings() {
  const sel = $('provider')
  if (!sel.options.length) {
    for (const [id, p] of Object.entries(state.providers)) sel.add(new Option(p.label, id))
  }
  sel.value = state.provider
  fillProvider(state.provider)

  const sp = state.spending || {}
  if (document.activeElement !== $('cap-day')) $('cap-day').value = sp.capDay || 0
  if (document.activeElement !== $('cap-month')) $('cap-month').value = sp.capMonth || 0
  $('spent').textContent = `About $${(sp.today || 0).toFixed(2)} today, $${(sp.month || 0).toFixed(2)} this month.`

  $('memory-on').checked = state.memoryEnabled
  $('memory-list').replaceChildren(
    ...state.memory.map((m) => {
      const li = document.createElement('li')
      const span = document.createElement('span')
      span.textContent = m
      const x = document.createElement('button')
      x.className = 'px'
      x.textContent = 'X'
      x.title = 'Forget this'
      x.onclick = async () => applyState(await ai.memory.remove(m))
      li.append(span, x)
      return li
    })
  )
  if (!state.memory.length) $('memory-list').innerHTML = '<li class="muted">Nothing remembered yet.</li>'
}

function fillProvider(id) {
  const p = state.providers[id]
  $('model').value = p.model || ''
  $('model-list').replaceChildren(...(p.models || []).map((m) => new Option(m)))
  $('baseurl-wrap').hidden = p.kind === 'anthropic'
  $('baseurl').value = p.baseUrl || ''
  $('key-wrap').hidden = !!p.noKey
  $('apikey').value = ''
  $('apikey').placeholder = p.hasKey ? 'Saved (type to replace)' : p.keyOptional ? 'Optional' : 'Paste your API key'
  $('key-link').hidden = !p.keyUrl
  $('key-link').onclick = (e) => {
    e.preventDefault()
    ai.openUrl(p.keyUrl)
  }
}

$('provider').onchange = () => fillProvider($('provider').value)

$('save-ai').onclick = async () => {
  const values = { provider: $('provider').value, model: $('model').value, baseUrl: $('baseurl').value }
  if ($('apikey').value) values.apiKey = $('apikey').value
  applyState(await ai.saveSettings(values))
  $('ai-saved').hidden = false
  setTimeout(() => ($('ai-saved').hidden = true), 1500)
}

$('memory-on').onchange = async () => applyState(await ai.memory.setEnabled($('memory-on').checked))
$('memory-add').onsubmit = async (e) => {
  e.preventDefault()
  const text = $('memory-input').value.trim()
  if (!text) return
  $('memory-input').value = ''
  applyState(await ai.memory.add(text))
}

$('open-settings').onclick = () => ai.openSettings()

$('save-caps').onclick = async () => {
  const spending = await ai.setSpending({ capDay: $('cap-day').value, capMonth: $('cap-month').value })
  applyState({ spending })
  $('spent').textContent = 'Saved. ' + $('spent').textContent.replace(/^Saved\. /, '')
}

// ---------- AI on/off slider ----------

function renderEnabled() {
  const on = state.aiEnabled !== false
  $('ai-switch').classList.toggle('on', on)
  $('ai-switch').setAttribute('aria-checked', String(on))
  $('ai-switch').title = on ? 'AI is on. Slide off to keep everything private.' : 'AI is off: nothing is sent to any AI.'
  if (!on) setAppMode(null)
  for (const id of ['btn-apps', 'btn-new', 'btn-settings']) $(id).hidden = !on || !!state.app
  if (!on) {
    for (const v of ['chat', 'apps', 'settings', 'log']) $(`${v}-view`).hidden = true
    $('off-view').hidden = false
  } else if (!$('off-view').hidden) {
    $('off-view').hidden = true
    show('chat')
  }
}

async function setEnabled(on) {
  applyState(await ai.setEnabled(on))
}
$('ai-switch').onclick = () => setEnabled(state.aiEnabled === false)
$('off-on').onclick = () => setEnabled(true)

// ---------- state ----------

function applyState(next) {
  state = { ...state, ...next }
  renderEnabled()
  renderProviderLabel()
  renderSpace()
  if (!$('settings-view').hidden) renderSettings()
}

ai.onState((next) => applyState(next))

async function init() {
  state = await ai.getState()
  if (isPrivate || state.isPrivate) {
    document.body.classList.add('private')
    $('composer').hidden = true
    $('empty').innerHTML = '<p class="hello">Bitter is off in private windows, so nothing you do here leaves this device.</p>'
  }
  renderProviderLabel()
  renderApps()
  await renderContext()
  if (state.app) setAppMode(state.app)
  renderEnabled()
  if (state.aiEnabled === false) return
  const p = state.providers[state.provider]
  if (!p.hasKey && !p.noKey && !p.keyOptional && !isPrivate) show('settings')
}

function updateVideoButton(tabs) {
  const active = tabs.find((t) => t.active)
  $('q-video').hidden = !(active && isYouTubeWatch(active.url))
}
// The active tab can change while the sidebar isn't focused.
setInterval(async () => {
  if (document.hidden || $('chat-view').hidden) return
  updateVideoButton(await ai.tabs().catch(() => []))
}, 2000)

function renderSpace() {
  const sp = state.space && state.space !== 'personal' ? state.space : ''
  $('space-label').textContent = sp ? `· ${sp.toUpperCase()}` : ''
  $('space-label').title = sp ? `Space: ${sp}. Bitter's memory here is separate from your other Spaces.` : ''
}

window.addEventListener('focus', () => renderContext())
init()
