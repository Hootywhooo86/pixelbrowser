// Auto-updates from GitHub Releases (electron-updater). Updates download in
// the background; the toolbar shows UPDATE when one is ready to install.

const { app } = require('electron')
const { autoUpdater } = require('electron-updater')
const store = require('./store')

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
let status = { state: 'idle', version: null, percent: 0, error: '' }
let timer = null
const listeners = new Set()

function setStatus(next) {
  status = { ...status, ...next }
  for (const fn of listeners) fn(status)
}

/** Updates only work in an installed (packaged) build. */
function supported() {
  return app.isPackaged && !process.env.PIXEL_DISABLE_UPDATES
}

function start() {
  if (!supported()) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking', error: '' }))
  autoUpdater.on('update-not-available', () => setStatus({ state: 'up-to-date' }))
  autoUpdater.on('update-available', (info) => setStatus({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => setStatus({ percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => setStatus({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => setStatus({ state: 'error', error: String(err?.message || err).slice(0, 200) }))
  schedule()
}

function schedule() {
  clearInterval(timer)
  if (!store.settings.data.autoUpdate) return
  check()
  timer = setInterval(check, CHECK_EVERY_MS)
}

function check() {
  if (!supported()) {
    setStatus({ state: 'unsupported' })
    return
  }
  autoUpdater.checkForUpdates().catch(() => {})
}

function installNow() {
  if (status.state === 'ready') autoUpdater.quitAndInstall()
}

function setAuto(on) {
  store.settings.data.autoUpdate = !!on
  store.settings.save()
  if (supported()) schedule()
}

module.exports = {
  start,
  check,
  installNow,
  setAuto,
  status: () => ({ ...status, current: app.getVersion(), auto: store.settings.data.autoUpdate, supported: supported() }),
  onChange: (fn) => listeners.add(fn),
}
