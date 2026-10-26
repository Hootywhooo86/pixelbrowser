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
      el.className = 'tab' + (tab.id === state.activeId ? ' active' : '') + (tab.loading ? ' loading' : '')
      el.title = tab.title
      el.onclick = () => window.pixel.selectTab(tab.id)
      el.onauxclick = (e) => e.button === 1 && window.pixel.closeTab(tab.id)

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
}

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
