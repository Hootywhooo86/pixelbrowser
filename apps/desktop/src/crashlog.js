// Crash reports, opt-in and off by default. Problems (uncaught errors in the
// app, crashed or frozen pages) are written to crash-log.json in the profile
// folder. Nothing is sent anywhere: Settings shows the log and can copy it so
// you can share it yourself.

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const store = require('./store')

const LIMIT = 100
const file = () => path.join(app.getPath('userData'), 'crash-log.json')

function read() {
  try {
    const list = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** Add an entry (only when the user turned crash reports on). */
function record(kind, detail = {}) {
  if (!store.settings.data.crashReports) return
  try {
    const entry = {
      at: new Date().toISOString(),
      kind,
      message: String(detail.message || detail.reason || '').slice(0, 500),
      stack: String(detail.stack || '').slice(0, 2000),
      version: app.getVersion(),
      platform: `${process.platform} ${process.arch}`,
      electron: process.versions.electron,
    }
    if (detail.exitCode !== undefined) entry.exitCode = detail.exitCode
    fs.writeFileSync(file(), JSON.stringify([...read(), entry].slice(-LIMIT), null, 1))
  } catch {}
}

function clear() {
  try {
    fs.rmSync(file(), { force: true })
  } catch {}
}

/** A plain-text report to paste into an email or issue. Page addresses are never included. */
function report() {
  const list = read()
  if (!list.length) return ''
  return [`Bit Browser crash report (${list.length} entries)`, ...list.map((e) => `\n[${e.at}] ${e.kind} v${e.version} ${e.platform} electron ${e.electron}${e.exitCode !== undefined ? ` exit ${e.exitCode}` : ''}\n${e.message}${e.stack ? `\n${e.stack}` : ''}`)].join('\n')
}

let installed = false
function install() {
  if (installed) return
  installed = true
  process.on('uncaughtException', (err) => {
    record('app error', err)
    console.error(err)
  })
  process.on('unhandledRejection', (reason) => record('app error (promise)', reason instanceof Error ? reason : { message: String(reason) }))
  app.on('render-process-gone', (_e, _wc, details) => record('page crashed', { message: details.reason, exitCode: details.exitCode }))
  app.on('child-process-gone', (_e, details) => record(`${details.type} process gone`, { message: details.reason, exitCode: details.exitCode }))
}

module.exports = { install, record, read, clear, report }
