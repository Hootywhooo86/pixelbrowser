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
  $('shield').textContent = state.blockedCount > 999 ? '999+' : String(state.blockedCount || 0)
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
