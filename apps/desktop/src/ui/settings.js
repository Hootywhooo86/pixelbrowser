// Settings window: search engine, AI slider, sync, clear data.
const $ = (id) => document.getElementById(id)
const api = window.pixelSettings
let state = null

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-url]')
  if (a) {
    e.preventDefault()
    api.openUrl(a.dataset.url)
  }
})

// ---------- search engine ----------

function renderEngines() {
  const box = $('engines')
  box.replaceChildren(
    ...Object.entries(state.engines).map(([id, e]) => {
      const b = document.createElement('button')
      b.className = 'engine' + (state.searchEngine === id ? ' on' : '')
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(state.searchEngine === id))
      const tag = e.custom ? '' : e.private ? '<span class="tag ok">PRIVATE</span>' : '<span class="tag warn">TRACKS YOU</span>'
      b.innerHTML = '<span class="name"></span>' + tag + '<span class="note"></span>'
      b.querySelector('.name').textContent = e.label
      b.querySelector('.note').textContent = e.note || ''
      b.onclick = async () => {
        if (id === 'custom') {
          state.searchEngine = 'custom'
          renderEngines()
          $('custom-url').focus()
          return
        }
        applyState(await api.setSearch(id, ''))
      }
      return b
    })
  )
  $('custom-search').hidden = state.searchEngine !== 'custom'
  if (document.activeElement !== $('custom-url')) $('custom-url').value = state.customSearchUrl || ''
}

$('custom-search').onsubmit = async (e) => {
  e.preventDefault()
  const url = $('custom-url').value.trim()
  if (!/^https?:\/\/\S+$/.test(url) || !url.includes('%s')) {
    $('custom-saved').hidden = false
    $('custom-saved').textContent = 'Use a full https:// address with %s in it.'
    return
  }
  applyState(await api.setSearch('custom', url))
  $('custom-saved').hidden = false
  $('custom-saved').textContent = 'Saved.'
  setTimeout(() => ($('custom-saved').hidden = true), 1500)
}

// ---------- AI slider ----------

function renderAI() {
  const on = state.aiEnabled !== false
  $('ai-switch').classList.toggle('on', on)
  $('ai-switch').setAttribute('aria-checked', String(on))
  $('ai-state').textContent = on ? 'AI is on.' : 'AI is off: private mode.'
}
$('ai-switch').onclick = async () => applyState(await api.setAI(state.aiEnabled === false))

// ---------- sync ----------

function renderSync() {
  const s = state.sync
  $('sync-off').hidden = s.enabled
  $('sync-on').hidden = !s.enabled
  if (!$('sync-server').value) $('sync-server').value = s.server || ''
  $('sync-status').textContent = s.lastSyncAt ? `Synced ${new Date(s.lastSyncAt).toLocaleString()} with ${s.server}` : `Syncing with ${s.server}…`
  $('device-name').value = s.deviceName || ''
  $('sync-keys').checked = s.syncKeys
  $('sync-error').hidden = !s.error
  $('sync-error').textContent = s.error ? `Sync problem: ${s.error}` : ''

  const box = $('remote-tabs')
  if (!state.remoteTabs?.length) {
    box.textContent = 'Nothing yet.'
    return
  }
  box.replaceChildren(
    ...state.remoteTabs.flatMap((d) => {
      const head = document.createElement('div')
      head.className = 'device'
      head.textContent = d.deviceName
      const links = d.tabs.map((t) => {
        const a = document.createElement('a')
        a.href = '#'
        a.dataset.url = t.url
        a.textContent = t.title || t.url
        return a
      })
      return [head, ...links]
    })
  )
}

async function syncAction(fn) {
  $('sync-error').hidden = true
  try {
    await fn()
  } catch (err) {
    $('sync-error').hidden = false
    $('sync-error').textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  }
  applyState(await api.get())
}

function showCode(result) {
  if (!result) return
  $('sync-code-box').hidden = false
  $('sync-qr').src = result.qr
  $('sync-words').textContent = result.code
}

$('sync-create').onclick = () =>
  syncAction(async () => {
    const server = $('sync-server').value.trim()
    if (!server) throw new Error('Enter a sync server address first.')
    showCode(await api.sync.create(server))
  })
$('sync-join-show').onclick = () => ($('sync-join').hidden = !$('sync-join').hidden)
$('sync-join-go').onclick = () =>
  syncAction(async () => {
    const server = $('sync-server').value.trim()
    if (!server) throw new Error('Enter the same sync server address as your other device.')
    await api.sync.join(server, $('sync-code').value)
    $('sync-code').value = ''
  })
$('sync-now').onclick = () => syncAction(() => api.sync.now())
$('sync-show').onclick = () => syncAction(async () => showCode(await api.sync.showCode()))
$('sync-leave').onclick = () =>
  syncAction(async () => {
    const wipe = confirm('Stop syncing this device?\n\nOK = also delete the encrypted copy from the server (all devices stop syncing).\nCancel = just this device.')
    await api.sync.leave({ wipe })
    $('sync-code-box').hidden = true
  })
$('sync-keys').onchange = () => syncAction(() => api.sync.setOptions({ syncKeys: $('sync-keys').checked }))
$('device-name').onchange = () => syncAction(() => api.sync.setOptions({ deviceName: $('device-name').value }))


// ---------- clear data ----------

$('clear-go').onclick = async () => {
  const history = $('clear-history').checked
  const siteData = $('clear-site').checked
  if (!history && !siteData) return
  await api.clearData({ history, siteData })
  $('clear-done').hidden = false
  setTimeout(() => ($('clear-done').hidden = true), 2000)
}

// ---------- state ----------

function applyState(next) {
  state = { ...state, ...next }
  renderEngines()
  renderAI()
  renderSync()
}

api.onState((next) => applyState(next))
api.get().then(applyState)
