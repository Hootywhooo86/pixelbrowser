// Pixel shell renderer: draws tabs + toolbar from state pushed by main.js.
const $ = (id) => document.getElementById(id)
const tabsEl = $('tabs')
const address = $('address')
let state = { tabs: [], activeId: null }

if (new URLSearchParams(location.search).get('private') === '1') {
  document.body.classList.add('private')
  $('private').hidden = true
  $('store').hidden = true
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
