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


// ---------- updates ----------

function renderUpdate() {
  const u = state.update || {}
  const text = {
    unsupported: 'Updates work in the installed app (not when running from source).',
    checking: 'Checking for updates…',
    'up-to-date': 'You have the newest version.',
    downloading: `Downloading version ${u.version}… ${u.percent || 0}%`,
    ready: `Version ${u.version} is ready to install.`,
    error: `Couldn't check for updates: ${u.error}`,
  }[u.state] || ''
  $('update-status').textContent = `Bit Browser ${u.current || ''}. ${text}`.trim()
  $('update-auto').checked = !!u.auto
  $('update-install').hidden = u.state !== 'ready'
}
$('update-check').onclick = async () => applyState(await api.update.check())
$('update-auto').onchange = async () => applyState(await api.update.setAuto($('update-auto').checked))
$('update-install').onclick = () => api.update.install()

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
  renderUpdate()
  renderShields()
  renderSecurity()
  renderAppearance()
  renderMedia()
  renderSpaces()
  renderFamily()
  renderPasswords()
  renderSites()
  renderNewTab()
  renderDownloads()
  renderBusiness()
  renderCrash()
}

const set = async (patch) => applyState(await api.set(patch))
function make(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props)
  n.append(...kids)
  return n
}
const fmt = (n) => Number(n || 0).toLocaleString()

// ---------- Shields ----------

function checkbox(label, on, onchange) {
  const input = make('input', { type: 'checkbox', checked: on, onchange: () => onchange(input.checked) })
  return make('label', { className: 'check' }, input, ' ' + label)
}

function renderShields() {
  const sh = state.shields
  if (!sh) return
  $('shields-switch').classList.toggle('on', sh.enabled)
  $('shields-switch').setAttribute('aria-checked', String(sh.enabled))
  $('shields-switch').querySelector('.lbl').textContent = sh.enabled ? 'ON' : 'OFF'
  $('shields-state').textContent = sh.enabled ? 'Blocking ads, trackers and YouTube ads.' : 'Shields are off everywhere.'
  $('stat-ads').textContent = fmt(sh.totals.ads)
  $('stat-trackers').textContent = fmt(sh.totals.trackers)
  $('lists').replaceChildren(...sh.lists.map((l) => checkbox(l.label, l.on, (on) => set({ shields: { lists: { [l.id]: on } } }))))
  $('regional').replaceChildren(
    ...sh.regional.map((l) =>
      checkbox(l.label, l.on, (on) => {
        const ids = sh.regional.filter((x) => (x.id === l.id ? on : x.on)).map((x) => x.id)
        set({ shields: { regional: ids } })
      })
    )
  )
  $('lists-status').textContent = sh.updating ? 'Updating…' : sh.lastUpdate ? `Updated ${new Date(sh.lastUpdate).toLocaleString()}. Updates every day.` : ''
  if (sh.siteOff.length) {
    $('site-off').replaceChildren(
      ...sh.siteOff.map((host) => make('div', { className: 'siteoff' }, make('span', { textContent: host }), make('button', { className: 'px', textContent: 'SHIELDS UP', onclick: () => upSite(host) })))
    )
  } else $('site-off').textContent = 'None. Use the shield in the toolbar to turn Shields down for a site.'
  $('phishing-on').checked = state.phishing.enabled
  $('phishing-status').textContent = state.phishing.enabled
    ? state.phishing.hosts
      ? `${fmt(state.phishing.hosts)} dangerous sites on the list, checked on this device. Updated ${state.phishing.lastUpdate ? new Date(state.phishing.lastUpdate).toLocaleString() : 'just now'}.`
      : 'Downloading the list…'
    : 'Off.'
}
async function upSite(host) {
  applyState(await api.set({ siteUp: host }))
}
$('shields-switch').onclick = () => set({ shields: { enabled: !state.shields.enabled } })
$('lists-update').onclick = async () => {
  $('lists-status').textContent = 'Updating…'
  await set({ updateLists: true })
}
$('phishing-on').onchange = () => set({ phishing: { enabled: $('phishing-on').checked } })

// ---------- security ----------

function renderSecurity() {
  if (!state.privacy) return
  if (document.activeElement !== $('panic-range')) $('panic-range').value = state.privacy.panicRange
  const l = state.privateLock
  $('lock-on').checked = l.enabled
  $('lock-on').disabled = !l.hasPin
  if (document.activeElement !== $('lock-min')) $('lock-min').value = l.minutes
  $('lock-status').textContent = l.hasPin ? (l.enabled ? 'Private windows are locked when you come back.' : 'PIN set. Tick the box to turn the lock on.') : 'Set a PIN first.'
  if (document.activeElement !== $('doh')) $('doh').value = state.privacy.doh
  $('doh-custom').hidden = $('doh').value !== 'custom'
  if (document.activeElement !== $('doh-custom')) $('doh-custom').value = state.privacy.dohCustom || ''
}
$('panic-go').onclick = async () => {
  if (!confirm('Close all private windows and wipe recent activity?')) return
  applyState(await api.panic($('panic-range').value))
  $('panic-done').hidden = false
  setTimeout(() => ($('panic-done').hidden = true), 2000)
}
$('lock-save').onclick = () => {
  const pin = $('lock-pin').value.trim()
  if (!/^\d{4,12}$/.test(pin)) return ($('lock-status').textContent = 'Use 4 to 12 digits.')
  $('lock-pin').value = ''
  set({ privateLock: { pin, enabled: true } })
}
$('lock-on').onchange = () => set({ privateLock: { enabled: $('lock-on').checked } })
$('lock-min').onchange = () => set({ privateLock: { minutes: $('lock-min').value } })
$('doh').onchange = () => ($('doh-custom').hidden = $('doh').value !== 'custom')
$('doh-save').onclick = () => set({ privacy: { doh: $('doh').value, dohCustom: $('doh-custom').value } })

// ---------- appearance ----------

function renderAppearance() {
  if (!state.themes) return
  const cur = state.theme
  const all = { ...state.themes, custom: { label: 'Custom', bg: cur.custom?.bg || '#0b0b16', panel: cur.custom?.panel || '#141428', accent: cur.custom?.accent || '#2dd4bf', ink: cur.custom?.ink || '#f4f1ff', orange: '#ff9f1c' } }
  $('themes').replaceChildren(
    ...Object.entries(all).map(([id, t]) => {
      const b = make('button', { className: 'theme' + (cur.id === id ? ' on' : ''), onclick: () => (id === 'custom' ? showCustom() : set({ theme: { id } })) })
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(cur.id === id))
      b.style.background = t.panel
      b.style.color = t.ink
      b.append(make('span', { textContent: t.label.toUpperCase() }), make('span', { className: 'sw' }, ...[t.bg, t.accent, t.orange, t.ink].map((c) => Object.assign(make('i'), { style: `background:${c}` }))))
      return b
    })
  )
  $('custom-theme').hidden = cur.id !== 'custom' && $('custom-theme').dataset.open !== '1'
  const c = cur.custom || {}
  for (const k of ['accent', 'bg', 'panel', 'ink']) if (document.activeElement !== $(`c-${k}`)) $(`c-${k}`).value = c[k] || all.custom[k]
  for (const r of document.querySelectorAll('input[name=skin]')) r.checked = r.value === cur.skin
  $('sounds').checked = state.sounds
}
function showCustom() {
  $('custom-theme').dataset.open = '1'
  $('custom-theme').hidden = false
}
$('custom-save').onclick = () => set({ theme: { id: 'custom', custom: { accent: $('c-accent').value, bg: $('c-bg').value, panel: $('c-panel').value, ink: $('c-ink').value } } })
for (const r of document.querySelectorAll('input[name=skin]')) r.onchange = () => set({ theme: { skin: r.value } })
$('sounds').onchange = () => set({ sounds: $('sounds').checked })

// ---------- media ----------

function renderMedia() {
  for (const r of document.querySelectorAll('input[name=startup]')) r.checked = r.value === (state.startup || 'restore')
  if (!state.autoplay) return
  for (const r of document.querySelectorAll('input[name=autoplay]')) r.checked = r.value === state.autoplay
  $('autoplay-note').textContent =
    state.autoplay !== state.autoplayRunning
      ? 'Restart Bit Browser to use the new autoplay setting.'
      : { off: 'Videos only play when you press play.', muted: 'Videos may start on their own only with the sound off (default).', on: 'Videos may start on their own, with sound.' }[state.autoplay]
}
for (const r of document.querySelectorAll('input[name=autoplay]')) r.onchange = () => set({ autoplay: r.value })
for (const r of document.querySelectorAll('input[name=startup]')) r.onchange = () => set({ startup: r.value })

// ---------- Spaces ----------

function renderSpaces() {
  if (!state.spaces) return
  if ($('space-list').contains(document.activeElement)) return
  $('space-list').replaceChildren(
    ...state.spaces.map((sp) => {
      const input = make('input', { value: sp.name, maxLength: 24, onchange: () => set({ space: { op: 'rename', id: sp.id, name: input.value } }) })
      input.setAttribute('aria-label', 'Space name')
      const del = make('button', {
        className: 'px',
        textContent: 'DELETE',
        disabled: state.spaces.length <= 1,
        onclick: () => confirm(`Delete the "${sp.name}" Space? Its tabs move to ${state.spaces.find((x) => x.id !== sp.id)?.name}.`) && set({ space: { op: 'delete', id: sp.id } }),
      })
      return make('div', { className: 'space-row' }, input, del)
    })
  )
}
$('space-add').onsubmit = (e) => {
  e.preventDefault()
  const name = $('space-name').value.trim()
  if (!name) return
  $('space-name').value = ''
  set({ space: { op: 'add', name } })
}

// ---------- 128bit family ----------

function renderFamily() {
  const x = state.xp
  if (!x) return
  $('xp-level').textContent = x.level
  $('xp-points').textContent = fmt(x.xp)
  $('xp-streak').textContent = x.streak || 0
  const prev = 50 * (x.level - 1) * (x.level - 1)
  const pct = Math.max(0, Math.min(1, (x.xp - prev) / Math.max(1, x.nextAt - prev)))
  $('xp-bar').style.width = `${Math.round(pct * 100)}%`
  $('xp-next').textContent = `${fmt(Math.max(0, x.nextAt - x.xp))} XP to level ${x.level + 1}. +1 XP per 10 ads or trackers blocked, +5 per stale tab tidied, +10 per day you browse.`
  $('badges').replaceChildren(...x.badges.map((b) => make('div', { className: 'badge' + (b.earned ? ' earned' : '') }, make('span', { className: 'ico', textContent: b.earned ? '*' : '?' }), make('span', { textContent: b.label }))))
  $('fl-bitcaller').checked = state.familyLinks.bitcaller
  $('fl-tracker').checked = state.familyLinks.tracker
  $('quests').replaceChildren(
    ...(state.quests || []).map((q) => {
      const bar = make('div', { className: 'bar' }, Object.assign(make('i'), { style: `width:${Math.round((100 * Math.min(q.progress, q.goal)) / q.goal)}%` }))
      return make('li', { className: q.done ? 'done' : '' }, make('span', {}, make('b', { textContent: q.done ? 'DONE ' : '' }), `${q.title} · ${fmt(q.progress)}/${fmt(q.goal)} · +${q.xp} XP`), bar)
    })
  )
}
$('fl-bitcaller').onchange = () => set({ familyLinks: { bitcaller: $('fl-bitcaller').checked } })
$('fl-tracker').onchange = () => set({ familyLinks: { tracker: $('fl-tracker').checked } })

// ---------- your data ----------

async function renderData(report) {
  report = report || (await api.dataReport())
  const deletable = new Set(['history', 'memory', 'cookies', 'cache', 'shields', 'xp'])
  $('data-table').tBodies[0].replaceChildren(
    ...report.rows.map((r) => {
      const tag = make('span', { className: 'tag ' + (r.synced && report.syncOn ? 'ok' : 'warn'), textContent: r.synced ? (report.syncOn ? 'SYNCED' : 'SYNCS IF ON') : 'THIS DEVICE' })
      const btn = deletable.has(r.id)
        ? make('button', { className: 'px', textContent: 'DELETE', onclick: async () => confirm(`Delete ${r.label.toLowerCase()}?`) && renderData(await api.deleteData(r.id)) })
        : ''
      return make('tr', {}, make('td', { textContent: r.label }), make('td', { className: 'v', textContent: r.value }), make('td', {}, tag), make('td', {}, btn))
    })
  )
}
renderData()

// ---------- search box and section nav ----------

$('find').addEventListener('input', () => {
  const q = $('find').value.trim().toLowerCase()
  let any = false
  for (const sec of document.querySelectorAll('main section')) {
    const hit = !q || sec.textContent.toLowerCase().includes(q) || (sec.dataset.keys || '').includes(q)
    sec.hidden = !hit
    any = any || hit
  }
  $('no-match').hidden = any
})
function goto(id) {
  const sec = document.getElementById(id)
  if (!sec) return
  $('find').value = ''
  for (const s2 of document.querySelectorAll('main section')) s2.hidden = false
  sec.scrollIntoView({ block: 'start' })
}
api.onGoto(goto)
if (location.hash) setTimeout(() => goto(location.hash.slice(1)), 50)

api.onState((next) => applyState(next))
api.get().then(applyState)

// ---------- default browser ----------

function renderDefault(d) {
  $('default-status').textContent = d.isDefault
    ? 'Bit Browser is your default browser. Links from other apps open here.'
    : d.platform === 'win32'
      ? 'Not the default yet. After you click, Windows opens Default apps: pick Bit Browser as your web browser there.'
      : 'Not the default yet. Links from other apps open in another browser.'
  $('make-default').hidden = d.isDefault
}
api.defaultBrowser().then(renderDefault)
$('make-default').onclick = async () => renderDefault(await api.makeDefault())

// ---------- passwords & autofill ----------

const revealed = {} // id -> secret shown until the next render of that row
async function reveal(kind, id) {
  let pin = ''
  if (state.vaultLocked) {
    pin = window.__pinInput?.value || ''
    if (!pin) {
      $('pw-lock-note').textContent = 'Type your PIN in the box above the list to show passwords.'
      $('pw-pin')?.focus()
      return null
    }
  } else if (!confirm('Show this saved secret on screen?')) return null
  const r = await api.vaultReveal(kind, id, pin)
  if (r.error) {
    $('pw-lock-note').textContent = r.error
    return null
  }
  return r
}

function renderPasswords() {
  const v = state.vault
  if (!v) return
  $('pw-offer').checked = v.options.offerToSave
  $('pw-sync').checked = v.options.syncPasswords
  $('pw-sync-cards').checked = v.options.syncCards
  if (state.vaultLocked && !$('pw-pin')) {
    const pin = make('input', { id: 'pw-pin', type: 'password', placeholder: 'PIN to show passwords', inputMode: 'numeric', autocomplete: 'off' })
    pin.setAttribute('aria-label', 'PIN')
    window.__pinInput = pin
    $('pw-search').parentElement.prepend(pin)
  }
  if (!$('pw-lock-note').textContent) $('pw-lock-note').textContent = state.vaultLocked ? 'Showing a password needs your PIN (Settings → Security).' : 'Tip: set a PIN under Security so showing passwords needs it.'
  const q = $('pw-search').value.trim().toLowerCase()
  const logins = v.logins.filter((l) => !q || `${l.origin} ${l.username}`.toLowerCase().includes(q))
  if (!$('pw-list').contains(document.activeElement)) {
    $('pw-list').replaceChildren(
      ...(logins.length
        ? logins.map((l) => {
            const secret = make('span', { className: 'secret', textContent: revealed[l.id] ? revealed[l.id] : '••••••••' })
            const show = make('button', {
              className: 'px',
              textContent: revealed[l.id] ? 'HIDE' : 'SHOW',
              onclick: async () => {
                if (revealed[l.id]) delete revealed[l.id]
                else {
                  const r = await reveal('login', l.id)
                  if (r) revealed[l.id] = r.password
                }
                renderPasswords()
              },
            })
            const edit = make('button', {
              className: 'px',
              textContent: 'EDIT',
              onclick: () => {
                const user = make('input', { value: l.username, placeholder: 'Username' })
                const pass = make('input', { type: 'password', placeholder: 'New password (leave empty to keep)', autocomplete: 'new-password' })
                const save = make('button', { className: 'px hot', textContent: 'SAVE', onclick: async () => applyState(await api.vaultSave('login', { id: l.id, username: user.value, password: pass.value })) })
                row.replaceChildren(make('div', { className: 'main' }, make('b', { textContent: l.origin }), user, pass), save)
                user.focus()
              },
            })
            const del = make('button', { className: 'px', textContent: 'DELETE', onclick: async () => confirm(`Delete the saved login for ${l.username || l.origin}?`) && applyState(await api.vaultDelete('login', l.id)) })
            const row = make('div', { className: 'vrow' }, make('div', { className: 'main' }, make('b', { textContent: l.origin.replace(/^https?:\/\//, '') }), make('span', { textContent: l.username || '(no username)' }), secret), show, edit, del)
            return row
          })
        : [make('p', { className: 'muted', textContent: q ? 'No logins match.' : 'No saved logins yet.' })])
    )
  }
  const never = v.options.never || []
  if (never.length) $('pw-never').replaceChildren(...never.map((o) => make('div', { className: 'siteoff' }, make('span', { textContent: o }), make('button', { className: 'px', textContent: 'REMOVE', onclick: () => set({ vault: { unblock: o } }) }))))
  else $('pw-never').textContent = 'No sites.'
  $('addr-list').replaceChildren(
    ...(v.addresses.length
      ? v.addresses.map((a) => make('div', { className: 'vrow' }, make('div', { className: 'main' }, make('b', { textContent: a.label })), make('button', { className: 'px', textContent: 'DELETE', onclick: async () => confirm('Delete this address?') && applyState(await api.vaultDelete('address', a.id)) })))
      : [make('p', { className: 'muted', textContent: 'No addresses yet.' })])
  )
  $('card-list').replaceChildren(
    ...(v.cards.length
      ? v.cards.map((c) => {
          const num = make('span', { className: 'secret', textContent: revealed[c.id] || `•••• ${c.last4}` })
          const show = make('button', {
            className: 'px',
            textContent: revealed[c.id] ? 'HIDE' : 'SHOW',
            onclick: async () => {
              if (revealed[c.id]) delete revealed[c.id]
              else {
                const r = await reveal('card', c.id)
                if (r) revealed[c.id] = r.number.replace(/(\d{4})(?=\d)/g, '$1 ')
              }
              renderPasswords()
            },
          })
          return make('div', { className: 'vrow' }, make('div', { className: 'main' }, make('b', { textContent: c.nickname || c.holder || 'Card' }), make('span', { textContent: `${c.holder} · exp ${c.exp}` }), num), show, make('button', { className: 'px', textContent: 'DELETE', onclick: async () => confirm('Delete this card?') && applyState(await api.vaultDelete('card', c.id)) }))
        })
      : [make('p', { className: 'muted', textContent: 'No cards yet.' })])
  )
}
$('pw-search').addEventListener('input', () => renderPasswords())
$('pw-offer').onchange = () => set({ vault: { offerToSave: $('pw-offer').checked } })
$('pw-sync').onchange = () => set({ vault: { syncPasswords: $('pw-sync').checked } })
$('pw-sync-cards').onchange = () => set({ vault: { syncCards: $('pw-sync-cards').checked } })
$('pw-add').onsubmit = async (e) => {
  e.preventDefault()
  const url = $('pw-url').value.trim()
  if (!/^https?:\/\//.test(url) || !$('pw-pass').value) return ($('pw-lock-note').textContent = 'Use a full https:// address and a password.')
  applyState(await api.vaultSave('login', { url, username: $('pw-user').value.trim(), password: $('pw-pass').value }))
  for (const id of ['pw-url', 'pw-user', 'pw-pass']) $(id).value = ''
}
function formData(form) {
  const out = {}
  for (const i of form.querySelectorAll('input[data-k]')) out[i.dataset.k] = i.value.trim()
  return out
}
$('addr-add').onsubmit = async (e) => {
  e.preventDefault()
  const d = formData($('addr-add'))
  if (!Object.values(d).some(Boolean)) return
  applyState(await api.vaultSave('address', d))
  for (const i of $('addr-add').querySelectorAll('input')) i.value = ''
}
$('card-add').onsubmit = async (e) => {
  e.preventDefault()
  const d = formData($('card-add'))
  if (d.number.replace(/\D/g, '').length < 12) return alert('Type the full card number.')
  applyState(await api.vaultSave('card', d))
  for (const i of $('card-add').querySelectorAll('input')) i.value = ''
}

// ---------- site settings ----------

function renderSites() {
  const perms = state.sitePerms || {}
  const hosts = Object.keys(perms).sort()
  $('sites-none').hidden = hosts.length > 0
  $('sites-table').hidden = !hosts.length
  $('sites-table').tBodies[0].replaceChildren(
    ...hosts.map((host) => {
      const cell = (kind) => {
        const sel = make('select', {}, ...['ask', 'allow', 'block'].map((v) => make('option', { value: v, textContent: v.toUpperCase(), selected: (perms[host][kind] || 'ask') === v })))
        sel.setAttribute('aria-label', `${host} ${kind}`)
        sel.onchange = () => set({ sitePerm: { host, kind, value: sel.value } })
        return make('td', {}, sel)
      }
      return make('tr', {}, make('td', { textContent: host, title: host }), cell('camera'), cell('microphone'), cell('location'), cell('notifications'), make('td', {}, make('button', { className: 'px', textContent: 'RESET', onclick: () => set({ siteReset: host }) })))
    })
  )
}

// ---------- new tab page & bookmarks bar ----------

function renderNewTab() {
  for (const r of document.querySelectorAll('input[name=ntp]')) r.checked = r.value === (state.newTabPage || 'bit')
  $('bm-bar').checked = !!state.bookmarksBar
  const list = state.ntpShortcuts || []
  if ($('sc-list').contains(document.activeElement)) return
  $('sc-list').replaceChildren(
    ...list.map((sc, i) =>
      make(
        'div',
        { className: 'vrow' },
        make('div', { className: 'main' }, make('b', { textContent: sc.title || sc.url }), make('span', { textContent: sc.url })),
        make('button', { className: 'px', textContent: 'UP', disabled: i === 0, onclick: () => set({ ntpShortcuts: list.map((x, j) => (j === i - 1 ? list[i] : j === i ? list[i - 1] : x)) }) }),
        make('button', { className: 'px', textContent: 'REMOVE', onclick: () => set({ ntpShortcuts: list.filter((_, j) => j !== i) }) })
      )
    )
  )
}
for (const r of document.querySelectorAll('input[name=ntp]')) r.onchange = () => set({ newTabPage: r.value })
$('bm-bar').onchange = () => set({ bookmarksBar: $('bm-bar').checked })
$('sc-add').onsubmit = (e) => {
  e.preventDefault()
  let url = $('sc-url').value.trim()
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`
  if (!/^https?:\/\/\S+\.\S+/.test(url)) return
  set({ ntpShortcuts: [...(state.ntpShortcuts || []), { title: $('sc-title').value.trim(), url }] })
  $('sc-title').value = ''
  $('sc-url').value = ''
}
$('sc-reset').onclick = () => set({ ntpShortcuts: null })

// ---------- downloads ----------

function renderDownloads() {
  const d = state.downloads
  if (!d) return
  $('dl-folder').textContent = d.folderShown
  $('dl-default').hidden = !d.folder
  $('dl-ask').checked = d.ask
  $('dl-print').checked = d.autoPrintLabels
}
$('dl-pick').onclick = async () => applyState(await api.pickDownloadFolder())
$('dl-default').onclick = () => set({ downloads: { folder: '' } })
$('dl-ask').onchange = () => set({ downloads: { ask: $('dl-ask').checked } })
$('dl-print').onchange = () => set({ downloads: { autoPrintLabels: $('dl-print').checked } })

// ---------- business details ----------

function renderBusiness() {
  if ($('biz').contains(document.activeElement)) return
  const b = state.business || {}
  for (const i of $('biz').querySelectorAll('input[data-k]')) i.value = b[i.dataset.k] || ''
}
$('biz').onsubmit = async (e) => {
  e.preventDefault()
  document.activeElement?.blur()
  await set({ business: formData($('biz')) })
  $('biz-saved').hidden = false
  setTimeout(() => ($('biz-saved').hidden = true), 1500)
}

// ---------- crash reports ----------

async function renderCrash() {
  $('crash-on').checked = !!state.crashReports
  $('crash-status').textContent = state.crashReports ? `${state.crashCount || 0} entries` : ''
  $('crash-view').hidden = !state.crashReports || !state.crashCount
  if (state.crashReports && state.crashCount) {
    const log = await api.crashLog()
    $('crash-view').textContent = log.report
  }
}
$('crash-on').onchange = () => set({ crashReports: $('crash-on').checked })
$('crash-copy').onclick = async () => ($('crash-status').textContent = (await api.crashCopy()) ? 'Copied. Paste it into an email or a GitHub issue.' : 'The log is empty.')
$('crash-clear').onclick = async () => {
  await api.deleteData('crash')
  applyState(await api.get())
}
