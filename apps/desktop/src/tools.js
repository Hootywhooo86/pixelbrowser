// Desktop adapters over the shared 0.5 packages (tools-core, tracking-core,
// sync-core's backup format). No Electron here, so the end-to-end test can
// use it directly. History search, price and change watching are in
// web-tools.js (ported from the phone app).

const crypto = require('node:crypto')
const path = require('node:path')
// Shared with the phone app (ESM packages, loaded with require()).
const toolsCore = require('@pixelbrowser/tools-core')
const trackingCore = require('@pixelbrowser/tracking-core')
// The backup format lives in sync-core (same file works on phone and computer).
const backupCore = require(path.join(path.dirname(require.resolve('@pixelbrowser/sync-core')), 'backup.js'))

// ---------- TOTP ----------

/** The current code for a 2FA entry { secret, digits=6, period=30, algorithm='SHA1' }. */
const totp = ({ secret, digits = 6, period = 30, algorithm = 'SHA1' }, time = Date.now()) => toolsCore.totp(secret, { time, period, digits, algorithm })

/** Seconds left before the code changes. */
const totpRemaining = (period = 30, time = Date.now()) => toolsCore.secondsLeft(period, time)

/** otpauth://totp/… or a bare base32 secret → { issuer, account, secret, digits, period, algorithm }. */
function parseOtpauth(text, fallbackLabel = '') {
  const raw = String(text || '').trim()
  if (/^otpauth:/i.test(raw)) {
    const e = toolsCore.parseOtpauth(raw)
    return { ...e, issuer: e.issuer || fallbackLabel || 'Account' }
  }
  const secret = raw.toUpperCase().replace(/[\s=-]/g, '')
  toolsCore.base32Decode(secret)
  return { issuer: fallbackLabel || 'Account', account: '', secret, digits: 6, period: 30, algorithm: 'SHA1' }
}

// ---------- package tracking numbers ----------

const detectTracking = (text) => trackingCore.detectTracking(String(text || '').slice(0, 400000)).slice(0, 30)
const carrierUrl = (carrier, number) => trackingCore.trackingUrl(carrier, number)
const CARRIERS = Object.entries(trackingCore.CARRIERS).map(([id, c]) => ({ id, name: c.name }))

// ---------- imports ----------

const parseBookmarksHtml = (html) => toolsCore.parseBookmarksHtml(html)
const parseChromeBookmarksJson = (json) => toolsCore.parseChromeBookmarksJson(typeof json === 'string' ? json : JSON.stringify(json))
/** → [{ url, username, password, name }] */
const parsePasswordsCsv = (text) => toolsCore.parsePasswordsCsv(text).logins

// ---------- password health ----------

const passwordStrength = (pw) => toolsCore.passwordStrength(pw)
const findReused = (logins) => toolsCore.findReused(logins)

/**
 * How many times a password appears in known breaches (Have I Been Pwned
 * k-anonymity range API: only 5 characters of its SHA-1 hash leave the computer).
 */
async function pwnedCount(password, fetchFn = fetch) {
  const hash = crypto.createHash('sha1').update(String(password)).digest('hex')
  return toolsCore.hibpRangeCheck(hash, fetchFn)
}

const { encryptBackup, decryptBackup, isBackup } = backupCore

module.exports = {
  totp,
  totpRemaining,
  parseOtpauth,
  detectTracking,
  carrierUrl,
  CARRIERS,
  parseBookmarksHtml,
  parseChromeBookmarksJson,
  parsePasswordsCsv,
  passwordStrength,
  findReused,
  pwnedCount,
  encryptBackup,
  decryptBackup,
  isBackup,
}
