// Bit Browser 0.5 on the computer: the "forever browser" features that sit
// beside main.js — imports and encrypted backups, 2FA codes, the password
// security check, packages, notes, read later, watchers (scheduled Bitter
// tasks and price drops), the command palette, split view, tab groups,
// media tools, chat with a PDF, HTTPS upgrade, cookie-banner rejection,
// fingerprinting protection, Tor private windows, email aliases, kids mode,
// family sharing and the 128bit account screen.
//
// main.js calls init() with the pieces of itself these need, and calls the
// hooks (onTabCreated, onPageLoaded, beforeNavigate…) from PixelWindow.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const crypto = require('node:crypto')
const { app, BrowserWindow, ipcMain, dialog, Menu, Notification, clipboard, session, shell } = require('electron')
const store = require('./store')
const vault = require('./vault')
const bookmarks = require('./bookmarks')
const quests = require('./quests')
const tools = require('./tools')
const web = require('./web-tools')
const { notes, packages, readLater, watchers, onChange: onListChange } = require('./collections')
const { AUTOCONSENT_JS, fingerprintForHost } = require('./privacy-scripts')

const ctx = {} // filled by init(): windows, openLibrary, openSettings, focusedWindow, realUrl, openWindow, broadcastSettingsSoon, notifyLibrary, spaceList, EXTRACT_ARTICLE_JS, readerPage, paletteFor, isNtp
const s = () => store.settings.data
const hostOf = (url) => web.hostOfUrl(url).replace(/^www\./, '')

// ---------- privacy: page scripts, HTTPS upgrade ----------

const siteOff = (host) => s().privacy5.siteOff[host] || {}

/** What the tab preload runs in a page (sync IPC from tab-preload.js). */
function pageConfig(url) {
  const host = hostOf(url)
  const p = s().privacy5
  return {
    fingerprint: p.fingerprint && !siteOff(host).fingerprint ? fingerprintForHost(host) : '',
    autoconsent: p.cookieBanners && !siteOff(host).cookieBanners ? AUTOCONSENT_JS : '',
  }
}

function setSitePrivacy(host, key, on) {
  const off = { ...siteOff(host) }
  if (on) delete off[key]
  else off[key] = true
  if (Object.keys(off).length) s().privacy5.siteOff[host] = off
  else delete s().privacy5.siteOff[host]
  store.settings.save()
}

const httpOnlySet = () => new Set(Object.keys(s().httpOnly || {}))

/** The address to load: HTTPS-upgraded and, in kids mode, with safe search on. */
function rewrite(url) {
  let out = url
  if (s().privacy5.httpsUpgrade) out = web.upgradeUrl(out, httpOnlySet()) || out
  if (s().kids.enabled && s().kids.safeSearch) out = web.safeSearchUrl(out) || out
  return out
}

/** A link click to http:// or a search: upgrade it / force safe search. Returns the new URL or null. */
function navigationRewrite(url) {
  const next = rewrite(url)
  return next !== url ? next : null
}

/** An upgraded load failed: remember the site is http-only and load it over http. */
function onFailLoad(tab, { errorCode, errorDescription, validatedURL, isMainFrame }) {
  if (!isMainFrame || !tab.upgradedFrom) return false
  const httpsUrl = tab.upgradedFrom.replace(/^http:/, 'https:')
  if (String(validatedURL).split('#')[0] !== httpsUrl.split('#')[0] || !web.isUpgradeFailure(errorDescription, errorCode)) return false
  s().httpOnly[web.hostOfUrl(httpsUrl)] = Date.now()
  store.settings.save()
  const back = tab.upgradedFrom
  tab.upgradedFrom = null
  tab.view.webContents.loadURL(back).catch(() => {})
  return true
}

// ---------- kids mode ----------

function kidsBlocked(url) {
  const k = s().kids
  return k.enabled && !web.kidsAllows(url, k)
}

function kidsBlockPage(url) {
  const host = web.hostOfUrl(url)
  const html = `<!doctype html><meta charset="utf-8"><title>Blocked</title><body style="background:#0b0b16;color:#f4f1ff;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;border:4px solid #ff5d8f;padding:32px;box-shadow:6px 6px 0 #05050f;max-width:420px"><div style="font:bold 28px monospace;color:#ff5d8f">KIDS MODE</div><p>${host.replace(/[<>&"]/g, '')} isn't on the list of sites you can visit.</p><p style="color:#9a97b8">Ask a grown-up to add it in Settings → Kids mode.</p></div>`
  return `data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`
}

function kidsDay() {
  return new Date().toISOString().slice(0, 10)
}

/** Count a minute of browsing; lock windows when today's time is used up. */
function kidsTick() {
  const k = s().kids
  if (!k.enabled || !k.minutesPerDay) return
  if (k.day !== kidsDay()) {
    k.day = kidsDay()
    k.usedToday = 0
  }
  const focused = BrowserWindow.getFocusedWindow()
  if (!focused || !ctx.windows.has(focused.id)) return
  k.usedToday += 1
  store.settings.save()
  if (k.usedToday >= k.minutesPerDay) for (const pw of ctx.windows.values()) if (!pw.locked) pw.setLocked(true, 'kids')
}

function hashPin(pin, salt = crypto.randomBytes(8).toString('hex')) {
  return `${salt}:${crypto.pbkdf2Sync(String(pin), salt, 120000, 32, 'sha256').toString('hex')}`
}
function checkKidsPin(pin) {
  const [salt, hash] = String(s().kids.pin || '').split(':')
  if (!salt || !hash) return false
  const got = Buffer.from(hashPin(pin, salt).split(':')[1], 'hex')
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'))
}
const kidsOn = () => !!s().kids.enabled

// ---------- the hidden helper window (PDF text, QR codes) ----------

let helperWin = null
let helperReady = null
function helper() {
  if (helperWin && !helperWin.isDestroyed()) return helperReady
  helperWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, offscreen: false } })
  helperReady = helperWin.loadFile(path.join(__dirname, 'ui', 'helper.html')).then(() => helperWin)
  helperWin.on('closed', () => (helperWin = null))
  return helperReady
}
async function helperCall(fn, arg) {
  const w = await helper()
  return w.webContents.executeJavaScript(`window.${fn}(${JSON.stringify(arg)})`)
}

/** Text of the PDF a tab shows (file:// or web, with the tab's cookies). */
async function pdfTextOf(pw, tab) {
  const url = ctx.realUrl(tab)
  let bytes
  if (url.startsWith('file:')) bytes = fs.readFileSync(new URL(url))
  else {
    const res = await pw.ses.fetch(url)
    if (!res.ok) throw new Error(`The PDF couldn't be read (${res.status}).`)
    bytes = Buffer.from(await res.arrayBuffer())
  }
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error("This tab isn't showing a PDF.")
  return helperCall('pdfText', bytes.toString('base64'))
}

const looksLikePdf = (url) => /\.pdf([?#]|$)/i.test(url || '')

async function askAboutPdf(pw) {
  const tab = pw.activeTab()
  if (!tab) return
  if (pw.isPrivate || !s().aiEnabled) return pw.toast('Turn on AI to ask Bitter about a PDF.')
  try {
    pw.toast('Reading the PDF…')
    const { pages, text } = await pdfTextOf(pw, tab)
    if (!text.trim()) return pw.toast("This PDF has no text Bitter can read (it may be a scan).")
    const name = decodeURIComponent(ctx.realUrl(tab).split(/[?#]/)[0].split('/').pop() || 'document.pdf')
    pw.askAI({ input: `I'm reading the PDF "${name}" (${pages} page${pages === 1 ? '' : 's'}). Summarize what it says in plain language and point out anything I should act on (dates, amounts, coverage, deadlines). Then I'll ask follow-up questions about it.\n\n<pdf>\n${text}\n</pdf>`, includePage: false })
  } catch (err) {
    pw.toast(err.message)
  }
}

// ---------- 2FA codes ----------

async function scanQrOnPage(pw) {
  const tab = pw.activeTab()
  if (!tab) return null
  try {
    const img = await tab.view.webContents.capturePage()
    const text = await helperCall('readQr', img.toPNG().toString('base64'))
    if (!/^otpauth:/i.test(text)) {
      pw.toast(text ? "That QR code isn't a two-factor code." : 'No QR code found on this page.')
      return null
    }
    const entry = tools.parseOtpauth(text)
    entry.origin = vault.originOf(ctx.realUrl(tab))
    const id = vault.saveTotp(entry)
    pw.toast(`2FA code added for ${entry.issuer}${entry.account ? ` (${entry.account})` : ''}`)
    ctx.broadcastSettingsSoon()
    return id
  } catch (err) {
    pw.toast(err.message)
    return null
  }
}

function totpList() {
  return vault.totpIndex().map((x) => {
    const e = vault.getTotp(x.id)
    let code = ''
    try {
      code = e ? tools.totp(e) : ''
    } catch {}
    return { id: x.id, issuer: x.issuer, account: x.account, origin: x.origin, code, left: tools.totpRemaining(e?.period || 30), period: e?.period || 30 }
  })
}

/** A page asked for a one-time code (console '__bitOtp'): offer the matching code. */
async function offerOtp(pw, tab) {
  const wc = tab.view.webContents
  if (pw.isPrivate || tab.otpOffered === wc.getURL()) return
  const url = wc.getURL()
  const list = vault.totpFor(url)
  if (!list.length) return
  tab.otpOffered = url
  const e = list[0]
  const answer = await pw.prompt({
    tabId: tab.id,
    kind: 'password',
    label: '2FA',
    text: `Fill your ${e.issuer} code${e.account ? ` for ${e.account}` : ''}?`,
    buttons: [{ id: 'fill', label: 'FILL CODE', hot: true }, { id: 'no', label: 'NOT NOW' }],
    key: `otp:${tab.id}`,
  })
  if (answer !== 'fill' || wc.isDestroyed()) return
  const ok = await wc.executeJavaScript(vault.otpFillJS(tools.totp(e))).catch(() => false)
  if (!ok) {
    clipboard.writeText(tools.totp(e))
    pw.toast('Code copied. Paste it into the page.')
  }
}

/** Page script: tell the app when a page shows a one-time-code field. */
const OTP_DETECT_JS = `(function(){
  try {
    var f = document.querySelector('input[autocomplete="one-time-code"],input[name*=otp i],input[id*=otp i],input[name*=totp i],input[name*=2fa i],input[aria-label*="verification code" i],input[placeholder*="6-digit" i],input[name*=mfa i]');
    if (f) console.log('__bitOtp');
  } catch (e) {}
})()`

// ---------- password security check ----------

async function runBreachCheck() {
  const logins = vault.loginIndex().map((x) => vault.getLogin(x.id)).filter(Boolean)
  const results = {}
  for (const l of logins) {
    let pwned = null
    try {
      pwned = await tools.pwnedCount(l.password, (u, init) => session.defaultSession.fetch(u, init))
    } catch {
      pwned = null
    }
    results[l.id] = { pwned, checkedAt: Date.now() }
  }
  s().breachCheck.results = results
  s().breachCheck.lastRun = Date.now()
  store.settings.save()
  return securityReport()
}

/** Weak, reused and breached logins (no passwords leave this function). */
function securityReport() {
  const logins = vault.loginIndex().map((x) => vault.getLogin(x.id)).filter(Boolean)
  const reusedIds = new Set(tools.findReused(logins).flatMap((g) => g.items.map((l) => l.id)))
  const res = s().breachCheck.results || {}
  const items = logins.map((l) => {
    const st = tools.passwordStrength(l.password)
    return { id: l.id, origin: l.origin, username: l.username, strength: st.score, label: st.label, tips: st.tips || [], reused: reusedIds.has(l.id), pwned: res[l.id]?.pwned ?? null }
  })
  return {
    enabled: s().breachCheck.enabled,
    lastRun: s().breachCheck.lastRun,
    items: items.filter((i) => i.strength < 2 || i.reused || i.pwned),
    counts: { total: items.length, weak: items.filter((i) => i.strength < 2).length, reused: items.filter((i) => i.reused).length, breached: items.filter((i) => i.pwned > 0).length },
  }
}

// ---------- imports ----------

/** Chrome, Brave and Edge profiles on this computer: [{ id, browser, profile, dir }]. */
function detectProfiles() {
  const home = os.homedir()
  const bases = {
    win32: { Chrome: 'AppData/Local/Google/Chrome/User Data', Brave: 'AppData/Local/BraveSoftware/Brave-Browser/User Data', Edge: 'AppData/Local/Microsoft/Edge/User Data' },
    darwin: { Chrome: 'Library/Application Support/Google/Chrome', Brave: 'Library/Application Support/BraveSoftware/Brave-Browser', Edge: 'Library/Application Support/Microsoft Edge' },
    linux: { Chrome: '.config/google-chrome', Chromium: '.config/chromium', Brave: '.config/BraveSoftware/Brave-Browser', Edge: '.config/microsoft-edge' },
  }[process.platform] || {}
  const extra = process.env.PIXEL_TEST_PROFILES ? { Test: process.env.PIXEL_TEST_PROFILES } : {}
  const out = []
  for (const [browser, rel] of Object.entries({ ...bases, ...extra })) {
    const base = path.isAbsolute(rel) ? rel : path.join(home, rel)
    let dirs = []
    try {
      dirs = fs.readdirSync(base).filter((d) => d === 'Default' || /^Profile \d+$/.test(d))
    } catch {}
    for (const d of dirs) {
      const dir = path.join(base, d)
      if (fs.existsSync(path.join(dir, 'Bookmarks')) || fs.existsSync(path.join(dir, 'History'))) out.push({ id: `${browser}|${d}`, browser, profile: d === 'Default' ? 'Main profile' : d, dir })
    }
  }
  return out
}

function addBookmarks(list) {
  const known = new Set(bookmarks.list().map((b) => b.url))
  let n = 0
  for (const b of list) {
    if (known.has(b.url)) continue
    bookmarks.add({ url: b.url, title: b.title, folder: b.folder && b.folder !== 'Bookmarks' ? `Imported / ${b.folder}`.slice(0, 60) : 'Imported' })
    known.add(b.url)
    n++
  }
  return n
}

/** History from a Chromium profile's SQLite file (copied first; the browser may have it open). */
function readChromiumHistory(dir, limit = 3000) {
  let DatabaseSync
  try {
    ;({ DatabaseSync } = require('node:sqlite'))
  } catch {
    return null
  }
  const tmp = path.join(app.getPath('temp'), `bit-history-${Date.now()}.sqlite`)
  try {
    fs.copyFileSync(path.join(dir, 'History'), tmp)
    const db = new DatabaseSync(tmp, { readOnly: true })
    const rows = db.prepare('SELECT url, title, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?').all(limit)
    db.close()
    // Chromium time: microseconds since 1601-01-01.
    return rows.filter((r) => /^https?:/.test(r.url)).map((r) => ({ url: r.url, title: r.title || r.url, visitedAt: Math.round(Number(r.last_visit_time) / 1000 - 11644473600000) }))
  } catch {
    return null
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

function importProfile(id, { history = true } = {}) {
  const p = detectProfiles().find((x) => x.id === id)
  if (!p) throw new Error("That browser profile wasn't found.")
  let bm = 0
  let hist = 0
  try {
    bm = addBookmarks(tools.parseChromeBookmarksJson(fs.readFileSync(path.join(p.dir, 'Bookmarks'), 'utf8')))
  } catch {}
  if (history) {
    const rows = readChromiumHistory(p.dir)
    for (const r of rows || []) {
      const hid = crypto.createHash('sha256').update(r.url).digest('hex').slice(0, 24)
      if (store.records.data.history[hid]) continue
      store.putRecord('history', hid, { url: r.url, title: r.title, visitedAt: r.visitedAt })
      hist++
    }
  }
  ctx.notifyLibrary()
  return { bookmarks: bm, history: hist, browser: p.browser, note: "Saved passwords can't be read from other browsers directly. Export them as a CSV from that browser's password settings, then import the CSV here." }
}

async function importFile(kind, parent) {
  const filters = kind === 'passwords' ? [{ name: 'Passwords CSV', extensions: ['csv'] }] : [{ name: 'Bookmarks', extensions: ['html', 'htm', 'json'] }]
  const pick = await dialog.showOpenDialog(parent, { properties: ['openFile'], filters })
  if (pick.canceled || !pick.filePaths[0]) return null
  return importPath(kind, pick.filePaths[0])
}

function importPath(kind, file) {
  const text = fs.readFileSync(file, 'utf8')
  if (kind === 'passwords') {
    const rows = tools.parsePasswordsCsv(text)
    let n = 0
    for (const r of rows) if (vault.saveLogin({ url: r.url, username: r.username, password: r.password })) n++
    ctx.broadcastSettingsSoon()
    return { passwords: n, note: n ? 'Delete the CSV file now: it has your passwords in plain text.' : 'No passwords found in that file.' }
  }
  const list = /^\s*\{/.test(text) ? tools.parseChromeBookmarksJson(text) : tools.parseBookmarksHtml(text)
  const n = addBookmarks(list)
  ctx.notifyLibrary()
  return { bookmarks: n }
}

// ---------- encrypted backup ----------

function backupData() {
  const data = store.settings.data
  const live = (c) => store.liveRecords(c).map((r) => ({ id: r.id, data: r.data }))
  return {
    app: 'bit-browser',
    device: 'desktop',
    version: app.getVersion(),
    createdAt: new Date().toISOString(),
    settings: {
      searchEngine: data.searchEngine,
      customSearchUrl: data.customSearchUrl,
      theme: data.theme,
      spaces: data.spaces,
      shields: { lists: data.shields.lists, regional: data.shields.regional, siteOff: data.shields.siteOff },
      privacy5: data.privacy5,
      ntpShortcuts: data.ntpShortcuts,
      sitePerms: data.sitePerms,
      business: data.business,
      quests: data.quests,
      xp: data.xp,
      groups: data.groups,
    },
    session: data.session,
    records: Object.fromEntries(['bookmarks', 'history', 'memory', 'notes', 'packages', 'readlater', 'watchers'].map((c) => [c, live(c)])),
    vault: {
      logins: vault.loginIndex().map((x) => vault.getLogin(x.id)).filter(Boolean),
      addresses: vault.listAddresses(),
      cards: vault.listCards(),
      totp: vault.totpIndex().map((x) => vault.getTotp(x.id)).filter(Boolean),
    },
  }
}

async function createBackup(passphrase, parent, file) {
  const text = await tools.encryptBackup(backupData(), passphrase)
  let target = file
  if (!target) {
    const pick = await dialog.showSaveDialog(parent, { defaultPath: `Bit Browser backup ${new Date().toISOString().slice(0, 10)}.bitbackup`, filters: [{ name: 'Bit Browser backup', extensions: ['bitbackup'] }] })
    if (pick.canceled || !pick.filePath) return null
    target = pick.filePath
  }
  fs.writeFileSync(target, text)
  return { file: target, size: text.length }
}

async function restoreBackup(passphrase, parent, file) {
  let source = file
  if (!source) {
    const pick = await dialog.showOpenDialog(parent, { properties: ['openFile'], filters: [{ name: 'Bit Browser backup', extensions: ['bitbackup', 'json'] }] })
    if (pick.canceled || !pick.filePaths[0]) return null
    source = pick.filePaths[0]
  }
  const b = await tools.decryptBackup(fs.readFileSync(source, 'utf8'), passphrase)
  const counts = {}
  // Records: merge in, keeping whatever is newer here.
  for (const [c, list] of Object.entries(b.records || {})) {
    if (!store.records.data[c]) continue
    let n = 0
    for (const r of list || []) {
      if (!r?.id || store.records.data[c][r.id]) continue
      store.putRecord(c, r.id, r.data)
      n++
    }
    counts[c] = n
  }
  // Vault (phone backups may use 'logins'/'passwords' naming; both accepted).
  const v = b.vault || b.passwords || {}
  for (const l of v.logins || []) if (l?.password) vault.saveLogin({ origin: l.origin, url: l.url || l.origin, username: l.username, password: l.password })
  for (const a of v.addresses || []) vault.saveAddress({ ...a, id: undefined })
  for (const c of v.cards || []) if (c?.number) vault.saveCard({ ...c, id: undefined })
  for (const t of v.totp || []) if (t?.secret) vault.saveTotp({ ...t, id: undefined })
  counts.logins = (v.logins || []).length
  counts.totp = (v.totp || []).length
  const set = b.settings || {}
  for (const k of ['searchEngine', 'customSearchUrl', 'ntpShortcuts', 'business']) if (set[k] !== undefined && set[k] !== null) store.settings.data[k] = set[k]
  if (set.theme?.id) store.settings.data.theme = { ...store.settings.data.theme, ...set.theme }
  if (set.spaces?.list?.length) store.settings.data.spaces = set.spaces
  if (set.groups) store.settings.data.groups = { ...set.groups, ...store.settings.data.groups }
  store.settings.save()
  ctx.notifyLibrary()
  ctx.broadcastSettingsSoon()
  return { counts, from: b.device || 'backup', createdAt: b.createdAt }
}

// ---------- packages ----------

const PAGE_TEXT_JS = `(function(){ try { return (document.body && document.body.innerText || '').slice(0, 300000) } catch (e) { return '' } })()`

async function scanTracking(pw, tab) {
  const wc = tab.view.webContents
  const url = wc.getURL()
  if (!/^https?:/.test(url) || pw.isPrivate) return
  const text = await wc.executeJavaScript(PAGE_TEXT_JS).catch(() => '')
  if (wc.isDestroyed() || wc.getURL() !== url) return
  const found = tools.detectTracking(text)
  tab.tracking = found
  if (tab.id === pw.activeId) pw.pushState()
}

function trackMenu(pw) {
  const tab = pw.activeTab()
  const found = tab?.tracking || []
  const title = tab ? tab.view.webContents.getTitle() : ''
  Menu.buildFromTemplate([
    ...(found.length ? found.map((f) => ({
      label: `${packages.has(f.number) ? '✓ ' : ''}${f.carrierName} ${f.number}`,
      submenu: [
        { label: packages.has(f.number) ? 'In your packages' : 'Add to packages', enabled: !packages.has(f.number), click: () => (packages.add({ ...f, label: title, source: ctx.realUrl(tab) }), pw.toast(`Tracking ${f.carrierName} ${f.number}`), pw.pushState()) },
        { label: `Track on ${f.carrierName}`, click: () => pw.createTab(f.url) },
        { label: 'Copy number', click: () => clipboard.writeText(f.number) },
      ],
    })) : [{ label: 'No tracking numbers on this page', enabled: false }]),
    { type: 'separator' },
    { label: 'Add all to packages', enabled: found.some((f) => !packages.has(f.number)), click: () => (found.forEach((f) => packages.add({ ...f, label: title, source: ctx.realUrl(tab) })), pw.pushState()) },
    { label: 'All packages…', click: () => ctx.openLibrary('packages') },
  ]).popup({ window: pw.win })
}

// ---------- notes and read later ----------

function saveNote(pw, { text = '', withPage = true } = {}) {
  const tab = pw.activeTab()
  const url = withPage ? ctx.realUrl(tab) : ''
  const id = notes.add({ text, url: /^https?:/.test(url) ? url : '', title: withPage && tab ? tab.view.webContents.getTitle() : '', space: pw.space })
  if (id) pw.toast(text ? 'Saved to notes' : 'Page saved to notes')
  return id
}

async function saveForLater(pw) {
  const tab = pw.activeTab()
  const wc = tab?.view.webContents
  const url = ctx.realUrl(tab)
  if (!wc || !/^https?:/.test(url)) return null
  const article = tab.reader ? null : await wc.executeJavaScript(ctx.EXTRACT_ARTICLE_JS).catch(() => null)
  const id = readLater.add({ url, title: tab.reader?.title || wc.getTitle(), article: article && (article.words || 0) >= 80 ? article : null })
  pw.toast(article?.words >= 80 ? 'Saved to read later (works offline)' : 'Saved to read later')
  return id
}

/** Open a saved article (offline copy if there is one) in a tab. */
function openReadLater(pw, id) {
  const item = readLater.list().find((x) => x.id === id)
  if (!item) return
  const article = readLater.article(id)
  if (readLater.markRead(id, true)) quests.progress('articleRead')
  if (!article) return pw.createTab(item.url)
  const html = ctx.readerPage(article, { url: item.url, theme: ctx.paletteFor(s().theme) })
  const tab = pw.createTab(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`)
  tab.reader = { url: item.url, title: article.title || item.title }
  pw.pushState()
}

// ---------- watchers: scheduled Bitter tasks and price tracking ----------

let watchTimer = null
let watching = false

async function fetchPage(url) {
  const res = await session.fromPartition('persist:pixel').fetch(url, { headers: { Accept: 'text/html,*/*' } })
  if (!res.ok) throw new Error(`The page answered ${res.status}`)
  return res.text()
}

function notify(title, body, onClick) {
  try {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, silent: false })
    if (onClick) n.on('click', onClick)
    n.show()
  } catch {}
}

/** Check one watcher now. Returns { changed, summary }. */
async function runWatcher(w, { quiet = false } = {}) {
  const html = await fetchPage(w.url)
  const now = Date.now()
  if (w.kind === 'price') {
    const p = web.extractPrice(html)
    if (!p?.price) {
      watchers.patch(w.id, { lastRun: now, lastError: "Couldn't find a price on the page." })
      return { changed: false, summary: "Couldn't find a price on the page." }
    }
    const was = w.lastPrice
    const history = [...(w.history || []), { at: now, price: p.price }].slice(-60)
    const dropped = was && p.price < was
    watchers.patch(w.id, { lastRun: now, lastPrice: p.price, currency: p.currency || w.currency || '', history, lastError: '', ...(dropped ? { lastChange: now } : {}) })
    const summary = dropped ? `Price dropped from ${was} to ${p.price}${p.currency ? ' ' + p.currency : ''}` : `Price is ${p.price}${p.currency ? ' ' + p.currency : ''}`
    if (dropped && !quiet) notify(`Price drop: ${w.title}`, summary, () => ctx.focusedWindow()?.createTab(w.url))
    return { changed: !!dropped, summary }
  }
  const text = web.pageText(html).slice(0, 60000)
  const hash = web.textHash(text)
  const before = w.lastText || ''
  const changed = !!w.lastHash && w.lastHash !== hash
  const diff = changed ? web.diffText(before, text, 12) : null
  watchers.patch(w.id, { lastRun: now, lastHash: hash, lastText: text.slice(0, 20000), lastError: '', ...(changed ? { lastChange: now, lastDiff: diff } : {}) })
  const summary = changed ? `Changed: ${diff.added.slice(0, 3).join(' · ').slice(0, 200) || 'some text was removed'}` : w.lastHash ? 'No change' : 'Started watching'
  if (changed && !quiet) {
    notify(`${w.title} changed`, summary, () => {
      const pw = ctx.focusedWindow()
      if (!pw) return
      pw.createTab(w.url)
      if (w.prompt && s().aiEnabled && !pw.isPrivate) pw.askAI({ input: `${w.prompt}\n\nWhat changed on ${w.url} since I last checked:\nAdded:\n${diff.added.join('\n')}\nRemoved:\n${diff.removed.join('\n')}`, includePage: true })
    })
  }
  return { changed, summary }
}

async function checkWatchers({ force = false } = {}) {
  if (watching) return
  watching = true
  try {
    for (const w of watchers.list()) {
      if (!force && Date.now() - (w.lastRun || 0) < (w.everyHours || 24) * 3600000) continue
      try {
        await runWatcher(w)
      } catch (err) {
        watchers.patch(w.id, { lastRun: Date.now(), lastError: err.message })
      }
    }
  } finally {
    watching = false
  }
}

// ---------- command palette ----------

const SETTINGS_SECTIONS = [
  ['shields', 'Shields & privacy'], ['passwords', 'Passwords & autofill'], ['twofa', '2FA codes & security check'], ['sites', 'Site settings'], ['security', 'Security'],
  ['importbackup', 'Import & backup'], ['newtab', 'New tab & bookmarks bar'], ['downloads', 'Downloads'], ['business', 'Business details'], ['appearance', 'Appearance'],
  ['media', 'Media'], ['spaces', 'Spaces'], ['tabs5', 'Tabs: vertical tabs & groups'], ['kids', 'Kids mode'], ['family', '128bit family'], ['sharing', 'Family sharing'],
  ['aliases', 'Email aliases'], ['tor', 'Tor'], ['localai', 'AI on this computer'], ['data', 'Your data'], ['search', 'Search engine'], ['sync', 'Sync'], ['crash', 'Crash reports'],
]

function actions(pw) {
  const tab = pw.activeTab()
  const url = ctx.realUrl(tab)
  const webPage = /^https?:/.test(url)
  return [
    ['new-tab', 'New tab', 'Ctrl+T', () => pw.createTab()],
    ['private', 'New private window', 'Ctrl+Shift+N', () => ctx.openWindow({ isPrivate: true })],
    ['tor', 'New private window over Tor', '', () => openTorWindow(pw)],
    ['reopen', 'Reopen closed tab', 'Ctrl+Shift+T', () => pw.reopenClosed()],
    ['find', 'Find in page', 'Ctrl+F', () => pw.openFind()],
    webPage && ['reader', 'Reader mode', 'Ctrl+Alt+R', () => pw.toggleReader()],
    webPage && ['pin', tab?.pinned ? 'Unpin tab' : 'Pin tab', '', () => pw.pinTab(tab.id, !tab.pinned)],
    webPage && ['bookmark', 'Bookmark this page', 'Ctrl+D', () => ctx.toggleBookmark(pw)],
    webPage && ['note', 'Save page to notes', '', () => saveNote(pw)],
    webPage && ['later', 'Save to read later', '', () => saveForLater(pw)],
    webPage && ['translate', 'Translate this page', '', () => pw.translateItems()[0]?.click()],
    webPage && ['print', 'Print', 'Ctrl+P', () => tab.view.webContents.print({})],
    webPage && ['pdf', 'Save page as PDF', 'Ctrl+Shift+S', () => pw.savePdf()],
    webPage && ['split', pw.split ? 'Close split view' : 'Split view with another tab', '', () => (pw.split ? pw.exitSplit() : pw.splitWithNext())],
    webPage && ['watch', 'Watch this page for changes', '', () => addWatcher(pw, 'changes')],
    webPage && ['price', 'Track the price on this page', '', () => addWatcher(pw, 'price')],
    webPage && ['qr', 'Scan a 2FA QR code on this page', '', () => scanQrOnPage(pw)],
    looksLikePdf(url) && ['askpdf', 'Ask Bitter about this PDF', '', () => askAboutPdf(pw)],
    ['speed', 'Video speed…', '', () => speedMenu(pw)],
    ['sleep', 'Sleep timer…', '', () => sleepMenu(pw)],
    ['packages', 'Packages', '', () => ctx.openLibrary('packages')],
    ['notes', 'Notes', '', () => ctx.openLibrary('notes')],
    ['reading', 'Reading list', '', () => ctx.openLibrary('reading')],
    ['watchers', 'Watched pages & prices', '', () => ctx.openLibrary('watchers')],
    ['history', 'History', 'Ctrl+H', () => ctx.openLibrary('history')],
    ['bookmarks', 'Bookmarks manager', 'Ctrl+Shift+O', () => ctx.openLibrary('bookmarks')],
    ['vertical', s().verticalTabs ? 'Horizontal tabs' : 'Vertical tabs', '', () => setVerticalTabs(!s().verticalTabs)],
    !kidsOn() && ['panic', 'Panic: wipe private windows', 'Ctrl+Shift+X', () => ctx.panic(pw.win)],
  ].filter(Boolean)
}

/** Palette results for what's typed: actions, tabs, bookmarks, history, settings. */
function paletteQuery(pw, query) {
  const q = String(query || '').trim().toLowerCase()
  const has = (t) => !q || String(t || '').toLowerCase().includes(q)
  const out = []
  for (const [id, title, keys] of actions(pw)) if (has(title)) out.push({ kind: 'action', id, title, sub: keys })
  for (const [w, t] of [...ctx.windows.values()].flatMap((win) => win.tabs.map((t) => [win, t]))) {
    if (w.isPrivate !== pw.isPrivate) continue
    const title = t.pendingUrl ? t.pendingTitle : t.view.webContents.getTitle()
    const url = ctx.realUrl(t)
    if (has(title) || has(url)) out.push({ kind: 'tab', id: `${w.win.id}:${t.id}`, title: title || url, sub: url })
  }
  if (q) {
    for (const b of bookmarks.list()) if (has(b.title) || has(b.url)) out.push({ kind: 'bookmark', id: b.url, title: b.title, sub: b.url })
    const hist = pw.isPrivate ? [] : web.scoreItems(store.history.search('', 3000).map((h) => ({ kind: 'history', title: h.title, url: h.url, at: h.visitedAt })), query, { limit: 8 })
    for (const h of hist) out.push({ kind: 'history', id: h.url, title: h.title, sub: h.url })
    for (const [id, title] of SETTINGS_SECTIONS) if (has(title)) out.push({ kind: 'settings', id, title: `Settings: ${title}`, sub: '' })
  }
  const seen = new Set()
  return out.filter((x) => (seen.has(`${x.kind}|${x.id}`) ? false : seen.add(`${x.kind}|${x.id}`))).slice(0, 40)
}

function paletteRun(pw, item) {
  if (!item) return
  if (item.kind === 'action') return actions(pw).find((a) => a[0] === item.id)?.[3]()
  if (item.kind === 'tab') {
    const [winId, tabId] = String(item.id).split(':').map(Number)
    const w = ctx.windows.get(winId)
    if (!w) return
    w.selectTab(tabId)
    return w.win.focus()
  }
  if (item.kind === 'bookmark' || item.kind === 'history') return pw.load(pw.activeTab()?.view.webContents, item.id)
  if (item.kind === 'settings') return ctx.openSettings(item.id)
  if (item.kind === 'go') return pw.load(pw.activeTab()?.view.webContents, item.id)
}

// ---------- split view, vertical tabs, tab groups ----------

function setVerticalTabs(on) {
  s().verticalTabs = !!on
  store.settings.save()
  for (const pw of ctx.windows.values()) pw.pushStateNow()
  ctx.broadcastSettingsSoon()
}

const GROUP_COLORS = ['#2dd4bf', '#ff9f1c', '#ff5d8f', '#c084fc', '#60a5fa', '#a3e635', '#f4f1ff']

function newGroup(pw, tabIds, name) {
  const id = crypto.randomUUID().slice(0, 8)
  const used = Object.values(s().groups).map((g) => g.color)
  s().groups[id] = { name: name || `Group ${Object.keys(s().groups).length + 1}`, color: GROUP_COLORS.find((c) => !used.includes(c)) || GROUP_COLORS[0], collapsed: false }
  store.settings.save()
  for (const t of pw.tabs) if (tabIds.includes(t.id)) t.group = id
  pw.pushStateNow()
  return id
}

function groupMenu(pw, gid) {
  const g = s().groups[gid]
  if (!g) return
  const save = () => (store.settings.save(), [...ctx.windows.values()].forEach((w) => w.pushStateNow()))
  Menu.buildFromTemplate([
    { label: g.collapsed ? 'Expand group' : 'Collapse group', click: () => ((g.collapsed = !g.collapsed), save()) },
    { label: 'Color', submenu: GROUP_COLORS.map((c, i) => ({ label: ['Teal', 'Orange', 'Pink', 'Purple', 'Blue', 'Lime', 'White'][i], type: 'radio', checked: g.color === c, click: () => ((g.color = c), save()) })) },
    { label: 'Rename… (double-click the group name)', enabled: false },
    { label: 'New tab in group', click: () => ((pw.createTab('', { group: gid }).group = gid), pw.pushStateNow()) },
    { type: 'separator' },
    { label: 'Ungroup', click: () => (pw.tabs.forEach((t) => t.group === gid && (t.group = null)), delete s().groups[gid], save()) },
    { label: 'Close group', click: () => pw.tabs.filter((t) => t.group === gid && !t.pinned).forEach((t) => pw.closeTab(t.id)) },
  ]).popup({ window: pw.win })
}

function renameGroup(gid, name) {
  const g = s().groups[gid]
  const clean = String(name || '').trim().slice(0, 30)
  if (!g || !clean) return
  g.name = clean
  store.settings.save()
  for (const w of ctx.windows.values()) w.pushStateNow()
}

/** Tab right-click menu items for split view and groups. */
function tabMenuItems(pw, tab) {
  const groups = Object.entries(s().groups)
  return [
    { type: 'separator' },
    tab.id !== pw.activeId
      ? { label: 'Open in split view', click: () => pw.openSplit(pw.activeId, tab.id) }
      : { label: pw.split ? 'Close split view' : 'Split view with next tab', click: () => (pw.split ? pw.exitSplit() : pw.splitWithNext()) },
    { label: 'Add to new group', click: () => newGroup(pw, [tab.id]) },
    ...(groups.length ? [{ label: 'Add to group', submenu: groups.map(([gid, g]) => ({ label: g.name, type: 'radio', checked: tab.group === gid, click: () => ((tab.group = gid), pw.pushStateNow()) })) }] : []),
    ...(tab.group ? [{ label: 'Remove from group', click: () => ((tab.group = null), pw.pushStateNow()) }] : []),
  ]
}

// ---------- media ----------

const speedJS = (rate) => `(function(){
  var r = ${Number(rate) || 1}; window.__bitRate = r;
  function apply(root){ (root || document).querySelectorAll('video,audio').forEach(function(m){ try { m.playbackRate = r; m.defaultPlaybackRate = r } catch (e) {} }) }
  apply();
  if (!window.__bitRateObs) { window.__bitRateObs = new MutationObserver(function(){ apply() }); window.__bitRateObs.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('ratechange', function(e){ var m = e.target; if (window.__bitRate && m.playbackRate !== window.__bitRate && !m.__bitUser) { try { m.playbackRate = window.__bitRate } catch (x) {} } }, true); }
  var m = document.querySelector('video,audio'); return m ? m.playbackRate : 0;
})()`
const PAUSE_ALL_JS = `(function(){ var n = 0; document.querySelectorAll('video,audio').forEach(function(m){ if (!m.paused) { m.pause(); n++ } }); return n })()`
const MEDIA_LIST_JS = `(function(){
  var out = [], seen = {};
  function add(src, kind, label){ try { var u = new URL(src, location.href).href; if (!/^https?:/.test(u) || seen[u]) return; seen[u] = 1; out.push({ url: u, kind: kind, label: (label || u.split('/').pop().split('?')[0] || kind).slice(0, 80) }) } catch (e) {} }
  document.querySelectorAll('video,audio').forEach(function(m){ if (m.currentSrc && !/^blob:/.test(m.currentSrc)) add(m.currentSrc, m.tagName.toLowerCase()); m.querySelectorAll('source').forEach(function(s){ add(s.src, m.tagName.toLowerCase()) }) });
  document.querySelectorAll('img').forEach(function(i){ if (i.naturalWidth >= 200 && i.naturalHeight >= 200) add(i.currentSrc || i.src, 'image', i.alt) });
  return out.slice(0, 60);
})()`

const STREAMING = /(^|\.)(youtube\.com|youtu\.be|googlevideo\.com|netflix\.com|nflxvideo\.net|disneyplus\.com|primevideo\.com|hulu\.com|twitch\.tv|ttvnw\.net|spotify\.com|vimeo\.com|tiktok\.com)$/i

const sleepTimers = new Map() // window id -> { timer, at }

function setSpeed(pw, rate) {
  const wc = pw.activeTab()?.view.webContents
  if (!wc) return
  pw.activeTab().speed = rate
  wc.executeJavaScript(speedJS(rate)).then((r) => pw.toast(r ? `Video speed ${rate}×` : 'No video on this page'), () => {})
}

function speedMenu(pw) {
  const cur = pw.activeTab()?.speed || 1
  Menu.buildFromTemplate([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((r) => ({ label: `${r}×${r === 1 ? ' (normal)' : ''}`, type: 'radio', checked: r === cur, click: () => setSpeed(pw, r) }))).popup({ window: pw.win })
}

function setSleep(pw, minutes) {
  const old = sleepTimers.get(pw.win.id)
  if (old) clearTimeout(old.timer)
  sleepTimers.delete(pw.win.id)
  if (!minutes) return pw.toast('Sleep timer off')
  const timer = setTimeout(() => {
    sleepTimers.delete(pw.win.id)
    for (const t of pw.tabs) if (!t.view.webContents.isDestroyed()) t.view.webContents.executeJavaScript(PAUSE_ALL_JS).catch(() => {})
    pw.toast('Sleep timer: media paused')
  }, minutes * 60000)
  sleepTimers.set(pw.win.id, { timer, at: Date.now() + minutes * 60000 })
  pw.toast(`Media will pause in ${minutes} minutes`)
}

function sleepMenu(pw) {
  const cur = sleepTimers.get(pw.win.id)
  Menu.buildFromTemplate([
    ...(cur ? [{ label: `Pauses in ${Math.max(1, Math.round((cur.at - Date.now()) / 60000))} min`, enabled: false }, { label: 'Turn off', click: () => setSleep(pw, 0) }, { type: 'separator' }] : []),
    ...[5, 15, 30, 45, 60, 90].map((m) => ({ label: `${m} minutes`, click: () => setSleep(pw, m) })),
  ]).popup({ window: pw.win })
}

async function saveMediaMenu(pw) {
  const tab = pw.activeTab()
  const wc = tab?.view.webContents
  if (!wc) return
  if (STREAMING.test(web.hostOfUrl(wc.getURL()))) return pw.toast("Videos from streaming sites like YouTube can't be saved (their terms don't allow it).")
  const list = (await wc.executeJavaScript(MEDIA_LIST_JS).catch(() => [])).filter((m) => !STREAMING.test(web.hostOfUrl(m.url)))
  Menu.buildFromTemplate(list.length ? list.map((m) => ({ label: `${m.kind.toUpperCase()}: ${m.label}`, click: () => wc.downloadURL(m.url) })) : [{ label: 'No saveable video, audio or images on this page', enabled: false }]).popup({ window: pw.win })
}

function contextItems(pw, tab, params) {
  const items = []
  const wc = tab.view.webContents
  if (params.mediaType === 'video' || params.mediaType === 'audio') {
    items.push({ label: 'Speed', submenu: [0.5, 1, 1.25, 1.5, 2, 3].map((r) => ({ label: `${r}×`, click: () => setSpeed(pw, r) })) })
    if (params.srcURL && /^https?:/.test(params.srcURL) && !STREAMING.test(web.hostOfUrl(params.srcURL)) && !STREAMING.test(web.hostOfUrl(wc.getURL()))) items.push({ label: `Save ${params.mediaType}`, click: () => wc.downloadURL(params.srcURL) })
  }
  if (params.mediaType === 'image' && params.srcURL && /^https?:|^data:image/.test(params.srcURL)) items.push({ label: 'Save image', click: () => wc.downloadURL(params.srcURL) })
  if (params.selectionText && !pw.isPrivate) {
    items.push({ label: 'Save to notes', click: () => saveNote(pw, { text: params.selectionText.trim() }) })
    const found = tools.detectTracking(params.selectionText)
    if (found.length) items.push({ label: `Track ${found[0].carrierName} package`, click: () => packages.add({ ...found[0], label: wc.getTitle(), source: wc.getURL() }) })
  }
  if (params.isEditable && (params.inputFieldType === 'email' || /mail/i.test(params.formControlType || '')) || (params.isEditable && s().aliases.provider)) {
    if (s().aliases.provider) items.push({ label: 'Hide my email: fill a new alias', click: () => fillAlias(pw, tab) })
  }
  if (params.isEditable && vault.totpFor(wc.getURL()).length) items.push({ label: 'Fill 2FA code', click: () => offerOtp(pw, Object.assign(tab, { otpOffered: null })) })
  if (!params.linkURL && !params.isEditable && /^https?:/.test(ctx.realUrl(tab)) && !pw.isPrivate) {
    items.push({ label: 'Save page to notes', click: () => saveNote(pw) }, { label: 'Save to read later', click: () => saveForLater(pw) })
    if (looksLikePdf(ctx.realUrl(tab)) && s().aiEnabled) items.push({ label: 'Ask Bitter about this PDF', click: () => askAboutPdf(pw) })
  }
  return items.length ? [{ type: 'separator' }, ...items] : []
}

// ---------- Tor ----------

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port, timeout: 800 }, () => (sock.destroy(), resolve(true)))
    sock.on('error', () => resolve(false))
    sock.on('timeout', () => (sock.destroy(), resolve(false)))
  })
}

async function torStatus() {
  if (process.env.PIXEL_TEST_TOR_PORT) return { running: await portOpen(Number(process.env.PIXEL_TEST_TOR_PORT)), port: Number(process.env.PIXEL_TEST_TOR_PORT) }
  for (const port of [9050, 9150]) if (await portOpen(port)) return { running: true, port }
  return { running: false, port: 0 }
}

async function openTorWindow(pw) {
  if (kidsOn()) return pw?.toast('Private windows are off in kids mode.')
  const st = await torStatus()
  if (!st.running) {
    const r = await dialog.showMessageBox(pw?.win, { type: 'info', buttons: ['How to get Tor', 'OK'], defaultId: 1, message: "Tor isn't running on this computer", detail: 'Private windows over Tor send your traffic through the Tor network, so sites can\'t see where you are. Install and open Tor Browser (or the "tor" service), then try again. Bit Browser uses it at 127.0.0.1:9150 or :9050.' })
    if (r.response === 0) shell.openExternal('https://www.torproject.org/download/')
    return null
  }
  return ctx.openWindow({ isPrivate: true, tor: st.port })
}

/** Point a private window's session at the local Tor proxy (DNS goes through Tor too). */
async function useTor(ses, port) {
  await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' })
}

// ---------- email aliases ----------

async function createAlias(note = '') {
  const provider = s().aliases.provider
  const key = store.secrets.get('aliasKey')
  if (!provider || !key) throw new Error('Set up email aliases in Settings first.')
  let email
  if (provider === 'simplelogin') {
    const res = await session.defaultSession.fetch(`https://app.simplelogin.io/api/alias/random/new${note ? '' : ''}`, { method: 'POST', headers: { Authentication: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note.slice(0, 200) }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error || `SimpleLogin answered ${res.status}`)
    email = j.alias || j.email
  } else {
    const res = await session.defaultSession.fetch('https://app.addy.io/api/v1/aliases', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ domain: 'anonaddy.me', description: note.slice(0, 200) }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.message || `addy.io answered ${res.status}`)
    email = j.data?.email
  }
  if (!email) throw new Error("The alias service didn't return an address.")
  s().aliases.lastAlias = email
  store.settings.save()
  return email
}

const emailFillJS = (email) => `(function(){
  var E = ${JSON.stringify(email)};
  var el = document.activeElement && document.activeElement.tagName === 'INPUT' ? document.activeElement : document.querySelector('input[type=email],input[autocomplete=email],input[name*=email i]');
  if (!el) return false;
  var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); if (d && d.set) d.set.call(el, E); else el.value = E;
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true;
})()`

async function fillAlias(pw, tab) {
  try {
    const email = await createAlias(`Bit Browser: ${hostOf(tab.view.webContents.getURL())}`)
    const ok = await tab.view.webContents.executeJavaScript(emailFillJS(email)).catch(() => false)
    clipboard.writeText(email)
    pw.toast(ok ? `Filled ${email} (also copied)` : `Alias ${email} copied`)
  } catch (err) {
    pw.toast(err.message)
  }
}

// ---------- AI on this computer ----------

async function findLocalAI() {
  const out = []
  for (const [id, label, url, pick] of [
    ['ollama', 'Ollama', 'http://127.0.0.1:11434/api/tags', (j) => (j.models || []).map((m) => m.name)],
    ['lmstudio', 'LM Studio', 'http://127.0.0.1:1234/v1/models', (j) => (j.data || []).map((m) => m.id)],
  ]) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 1500)
      const res = await fetch(url, { signal: ctrl.signal })
      clearTimeout(t)
      if (res.ok) out.push({ id, label, models: pick(await res.json()).slice(0, 20) })
    } catch {}
  }
  return out
}

// ---------- family sharing (a separate sync chain per share) ----------

let syncCore = null
const sc = () => (syncCore = syncCore || require('@pixelbrowser/sync-core'))

function shareList() {
  return (s().sharing || []).map((x) => ({ id: x.id, name: x.name, collections: x.collections, server: x.server, lastSyncAt: x.lastSyncAt || 0, error: x.error || '' }))
}

async function syncShare(share) {
  const code = store.secrets.get(`share:${share.id}`)
  if (!code || !share.server) return
  const data = Object.fromEntries(share.collections.map((c) => [c, store.records.data[c] || {}]))
  try {
    const result = await sc().syncOnce({
      client: new (sc().SyncClient)({ server: share.server, code, deviceId: store.settings.data.deviceId }),
      data,
      deviceId: store.settings.data.deviceId,
      cursor: share.cursor || 0,
      lastPushedAt: share.lastPushedAt || 0,
      skip: (collection) => !share.collections.includes(collection),
    })
    for (const c of share.collections) if (data[c]) store.records.data[c] = data[c]
    Object.assign(share, { cursor: result.cursor, lastPushedAt: result.lastPushedAt, lastSyncAt: Date.now(), error: '' })
    store.records.save()
    if (result.changed.length) ctx.notifyLibrary()
  } catch (err) {
    share.error = err.message
  }
  store.settings.save()
}

async function createShare({ name, collections, server, code }) {
  const allowed = ['bookmarks', 'notes', 'packages', 'readlater']
  const cols = (collections || []).filter((c) => allowed.includes(c))
  if (!cols.length) throw new Error('Pick something to share.')
  if (!/^https?:\/\//.test(server || '')) throw new Error('Enter the sync server address (the same kind you use for Sync).')
  const theCode = code ? sc().normalizeSyncCode(code) : sc().createSyncCode()
  if (!sc().isValidSyncCode(theCode)) throw new Error("That share code isn't valid. Check the 24 words.")
  const share = { id: crypto.randomUUID().slice(0, 8), name: String(name || 'Family').slice(0, 40), collections: cols, server: server.trim(), cursor: 0, lastPushedAt: 0 }
  store.secrets.set(`share:${share.id}`, theCode)
  s().sharing = [...(s().sharing || []), share]
  store.settings.save()
  await syncShare(share)
  return { ...shareList().find((x) => x.id === share.id), code: theCode }
}

function removeShare(id) {
  store.secrets.set(`share:${id}`, '')
  s().sharing = (s().sharing || []).filter((x) => x.id !== id)
  store.settings.save()
}

// ---------- watcher creation ----------

function addWatcher(pw, kind) {
  const tab = pw.activeTab()
  const url = ctx.realUrl(tab)
  if (!/^https?:/.test(url)) return null
  const id = watchers.add({ kind, url, title: tab.view.webContents.getTitle(), everyHours: kind === 'price' ? 6 : 24 })
  runWatcher(watchers.get(id), { quiet: true }).then((r) => pw.toast(kind === 'price' ? `Tracking the price. ${r.summary}` : 'Watching this page. You\'ll get a notification when it changes.'), (err) => pw.toast(err.message))
  return id
}

// ---------- IPC from local UI pages (shell, settings, library) ----------

const LOCAL_UI = path.join(__dirname, 'ui')
const fromLocalUi = (e) => {
  try {
    return e.senderFrame?.url?.startsWith('file:') && decodeURIComponent(new URL(e.senderFrame.url).pathname).includes(LOCAL_UI.replace(/\\/g, '/').split('/').slice(-2).join('/'))
  } catch {
    return false
  }
}

function windowFor(e) {
  const win = BrowserWindow.fromWebContents(e.sender)
  return (win && ctx.windows.get(win.id)) || ctx.focusedWindow()
}

const COMMANDS = {
  // shell
  palette: (e, q) => paletteQuery(windowFor(e), q),
  'palette-run': (e, item) => paletteRun(windowFor(e), item),
  'track-menu': (e) => trackMenu(windowFor(e)),
  'group-menu': (e, gid) => groupMenu(windowFor(e), gid),
  'group-rename': (_e, gid, name) => renameGroup(gid, name),
  'split-ratio': (e, r) => windowFor(e)?.setSplitRatio(Number(r)),
  'split-close': (e) => windowFor(e)?.exitSplit(),
  // library
  packages: () => packages.list(),
  'package-add': (_e, text, label) => {
    const found = tools.detectTracking(text)
    const f = found[0] || (String(text || '').trim() ? { carrier: 'other', carrierName: 'Carrier', number: String(text).trim(), url: `https://www.google.com/search?q=${encodeURIComponent(String(text).trim())}+tracking` } : null)
    return f ? packages.add({ ...f, label }) : null
  },
  'package-update': (_e, id, patch) => packages.update(id, patch),
  'package-remove': (_e, id) => packages.remove(id),
  notes: (_e, space) => notes.list(space),
  'note-add': (_e, text) => notes.add({ text, space: ctx.focusedWindow()?.space || 'personal' }),
  'note-update': (_e, id, patch) => notes.update(id, patch),
  'note-remove': (_e, id) => notes.remove(id),
  reading: () => readLater.list(),
  'reading-open': (_e, id) => openReadLater(ctx.focusedWindow(), id),
  'reading-mark': (_e, id, read) => readLater.markRead(id, read),
  'reading-remove': (_e, id) => readLater.remove(id),
  watchers: () => watchers.list().map(({ lastText, ...w }) => w),
  'watcher-add': (_e, w) => watchers.add(w),
  'watcher-run': async (_e, id) => runWatcher(watchers.get(id), { quiet: true }),
  'watcher-update': (_e, id, patch) => watchers.patch(id, { ...(patch.everyHours ? { everyHours: Math.max(0.5, Number(patch.everyHours)) } : {}), ...(typeof patch.prompt === 'string' ? { prompt: patch.prompt.slice(0, 1000) } : {}) }),
  'watcher-remove': (_e, id) => watchers.remove(id),
  'history-words': (_e, q) => web.scoreItems([...store.history.search('', 3000).map((h) => ({ kind: 'history', id: h.id, title: h.title, url: h.url, at: h.visitedAt })), ...bookmarks.list().map((b) => ({ kind: 'bookmark', title: b.title, url: b.url, at: b.createdAt })), ...notes.list().map((n) => ({ kind: 'note', title: n.title || n.text.slice(0, 80), url: n.url, text: n.text, at: n.updatedAt }))], q, { limit: 60 }),
  'open-url': (_e, url) => /^https?:/.test(url || '') && ctx.focusedWindow()?.createTab(url),
  // settings
  profiles: () => detectProfiles().map(({ dir, ...p }) => p),
  'import-profile': (_e, id, opts) => importProfile(id, opts),
  'import-file': (e, kind) => importFile(kind, BrowserWindow.fromWebContents(e.sender)),
  'backup-create': (e, pass) => createBackup(pass, BrowserWindow.fromWebContents(e.sender)),
  'backup-restore': (e, pass) => restoreBackup(pass, BrowserWindow.fromWebContents(e.sender)),
  totp: () => totpList(),
  'totp-add': (_e, text, label) => {
    const entry = tools.parseOtpauth(text, label)
    return vault.saveTotp(entry)
  },
  'totp-remove': (_e, id) => vault.deleteTotp(id),
  'totp-copy': (_e, id) => {
    const t = vault.getTotp(id)
    if (t) clipboard.writeText(tools.totp(t))
    return !!t
  },
  'security-report': () => securityReport(),
  'security-run': () => runBreachCheck(),
  'security-enable': (_e, on) => ((s().breachCheck.enabled = !!on), store.settings.save(), securityReport()),
  privacy: () => ({ ...s().privacy5, httpOnly: Object.keys(s().httpOnly || {}) }),
  'privacy-set': (_e, patch) => {
    for (const k of ['httpsUpgrade', 'cookieBanners', 'fingerprint']) if (typeof patch[k] === 'boolean') s().privacy5[k] = patch[k]
    if (patch.resetSite) delete s().privacy5.siteOff[patch.resetSite]
    if (patch.resetHttpOnly) s().httpOnly = {}
    store.settings.save()
    return { ...s().privacy5, httpOnly: Object.keys(s().httpOnly || {}) }
  },
  'vertical-tabs': (_e, on) => setVerticalTabs(on),
  tor: () => torStatus(),
  'tor-window': () => openTorWindow(ctx.focusedWindow()),
  aliases: () => ({ provider: s().aliases.provider, hasKey: store.secrets.has('aliasKey'), lastAlias: s().aliases.lastAlias }),
  'aliases-set': (_e, { provider, key }) => {
    s().aliases.provider = ['simplelogin', 'addy'].includes(provider) ? provider : ''
    if (typeof key === 'string' && key) store.secrets.set('aliasKey', key.trim())
    if (!s().aliases.provider) store.secrets.set('aliasKey', '')
    store.settings.save()
    return COMMANDS.aliases()
  },
  'alias-new': () => createAlias('Made in Bit Browser settings'),
  'local-ai': () => findLocalAI(),
  kids: () => {
    const k = s().kids
    return { enabled: k.enabled, hasPin: !!k.pin, safeSearch: k.safeSearch, mode: k.mode, allow: k.allow, block: k.block, minutesPerDay: k.minutesPerDay, usedToday: k.day === kidsDay() ? k.usedToday : 0 }
  },
  'kids-set': (_e, patch, pin) => {
    const k = s().kids
    // Turning kids mode off, or changing it while on, needs the PIN.
    if (k.enabled && k.pin && !checkKidsPin(pin)) throw new Error('Wrong PIN.')
    if (patch.newPin) {
      if (!/^\d{4,12}$/.test(patch.newPin)) throw new Error('Use a PIN of 4 to 12 digits.')
      k.pin = hashPin(patch.newPin)
    }
    if (patch.enabled === true && !k.pin) throw new Error('Set a PIN first, so kids can\'t turn it off.')
    if (typeof patch.enabled === 'boolean') k.enabled = patch.enabled
    if (typeof patch.safeSearch === 'boolean') k.safeSearch = patch.safeSearch
    if (['allow', 'block'].includes(patch.mode)) k.mode = patch.mode
    if (Array.isArray(patch.allow)) k.allow = patch.allow.map((x) => String(x).trim()).filter(Boolean).slice(0, 300)
    if (Array.isArray(patch.block)) k.block = patch.block.map((x) => String(x).trim()).filter(Boolean).slice(0, 300)
    if (patch.minutesPerDay !== undefined) k.minutesPerDay = Math.max(0, Math.min(1440, Number(patch.minutesPerDay) || 0))
    store.settings.save()
    for (const pw of ctx.windows.values()) {
      if (k.enabled && pw.isPrivate) pw.win.close()
      pw.pushStateNow()
    }
    return COMMANDS.kids()
  },
  sharing: () => shareList(),
  'share-create': (_e, opts) => createShare(opts),
  'share-remove': (_e, id) => removeShare(id),
  'share-sync': async () => {
    for (const x of s().sharing || []) await syncShare(x)
    return shareList()
  },
  family: () => ({ server: s().family.server, account: s().family.account }),
  'family-set': (_e, server) => {
    s().family.server = /^https:\/\//.test(server || '') ? server.trim() : ''
    store.settings.save()
    return { server: s().family.server, account: s().family.account }
  },
  'family-connect': async () => {
    const server = s().family.server
    if (!server) throw new Error('128bit accounts are coming soon. There is no 128bit server to connect to yet.')
    const res = await fetch(`${server.replace(/\/$/, '')}/v1/health`).catch(() => null)
    if (!res?.ok) throw new Error("Couldn't reach that 128bit server.")
    return { reachable: true }
  },
}

function registerIpc() {
  ipcMain.handle('v05', async (e, cmd, ...args) => {
    if (!fromLocalUi(e)) throw new Error('Not allowed')
    const fn = COMMANDS[cmd]
    if (!fn) throw new Error(`Unknown command ${cmd}`)
    return fn(e, ...args)
  })
  ipcMain.on('bit:page-config', (e, url) => {
    try {
      e.returnValue = pageConfig(String(url || ''))
    } catch {
      e.returnValue = {}
    }
  })
}

/** Register the page preload on a session (fingerprinting, cookie banners). */
function attachSession(ses) {
  ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'tab-preload.js') })
}

/** Console messages from page scripts ('__bitConsent:…', '__bitOtp'). */
function handleConsole(pw, tab, text) {
  if (text === '__bitOtp') {
    offerOtp(pw, tab)
    return true
  }
  if (text.startsWith('__bitConsent:')) {
    tab.consent = (() => {
      try {
        return JSON.parse(text.slice(13))
      } catch {
        return {}
      }
    })()
    return true
  }
  return false
}

/** After each page load in a tab. */
function onPageLoaded(pw, tab) {
  const wc = tab.view.webContents
  if (wc.isDestroyed() || !/^https?:/.test(wc.getURL())) return
  tab.tracking = null
  if (!pw.isPrivate) {
    setTimeout(() => !wc.isDestroyed() && scanTracking(pw, tab), 800)
    if (vault.totpIndex().length) wc.executeJavaScript(OTP_DETECT_JS).catch(() => {})
  }
  if (tab.speed && tab.speed !== 1) wc.executeJavaScript(speedJS(tab.speed)).catch(() => {})
}

function init(c) {
  Object.assign(ctx, c)
  registerIpc()
  onListChange(() => ctx.notifyLibrary())
  app.whenReady().then(() => {
    setTimeout(() => checkWatchers().catch(() => {}), 15000)
    watchTimer = setInterval(() => checkWatchers().catch(() => {}), (s().watcherMinutes || 30) * 60000)
    setInterval(kidsTick, 60000)
    setInterval(() => (s().sharing || []).forEach((x) => syncShare(x)), 5 * 60000)
    // Weekly password check, if turned on.
    setInterval(() => {
      const b = s().breachCheck
      if (b.enabled && Date.now() - (b.lastRun || 0) > 7 * 864e5) runBreachCheck().catch(() => {})
    }, 3600000)
  })
}

module.exports = {
  init,
  attachSession,
  pageConfig,
  setSitePrivacy,
  rewrite,
  navigationRewrite,
  onFailLoad,
  kidsBlocked,
  kidsBlockPage,
  kidsOn,
  checkKidsPin,
  onPageLoaded,
  handleConsole,
  contextItems,
  tabMenuItems,
  trackMenu,
  paletteQuery,
  paletteRun,
  actions,
  speedMenu,
  sleepMenu,
  saveMediaMenu,
  setSpeed,
  askAboutPdf,
  looksLikePdf,
  scanQrOnPage,
  saveNote,
  saveForLater,
  addWatcher,
  runWatcher,
  checkWatchers,
  openTorWindow,
  useTor,
  torStatus,
  createBackup,
  restoreBackup,
  importPath,
  importProfile,
  detectProfiles,
  totpList,
  securityReport,
  newGroup,
  renameGroup,
  setVerticalTabs,
  GROUP_COLORS,
  COMMANDS,
  collections: { notes, packages, readLater, watchers },
}
