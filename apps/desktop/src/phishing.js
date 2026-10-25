// Phishing and malware warnings. Free blocklists are downloaded to this
// device and every check happens here, so no browsing data leaves it.

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const store = require('./store')

const FEEDS = [
  'https://phishing.army/download/phishing_army_blocklist.txt',
  'https://urlhaus.abuse.ch/downloads/hostfile/',
]
const REFRESH_MS = 12 * 60 * 60 * 1000
const cacheFile = () => path.join(app.getPath('userData'), 'phishing-hosts.txt')

let hosts = new Set()
let timer = null

/** Hosts from a feed: plain domain lists and hosts files both work. */
function parseFeed(text) {
  const out = []
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    const host = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase()
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && host !== 'localhost') out.push(host)
  }
  return out
}

function setHosts(list) {
  hosts = new Set(list)
}

async function refresh() {
  const all = []
  for (const url of FEEDS) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Bit Browser' } })
      if (res.ok) all.push(...parseFeed(await res.text()))
    } catch {}
  }
  if (!all.length) return false
  setHosts(all)
  fs.writeFileSync(cacheFile(), [...hosts].join('\n'))
  store.settings.data.phishing.lastUpdate = Date.now()
  store.settings.save()
  return true
}

function start() {
  // Tests pass their own list and never touch the network.
  if (process.env.PIXEL_TEST_PHISH) return setHosts(process.env.PIXEL_TEST_PHISH.split(',').map((h) => h.trim().toLowerCase()))
  try {
    setHosts(fs.readFileSync(cacheFile(), 'utf8').split('\n').filter(Boolean))
  } catch {}
  const due = Date.now() - (store.settings.data.phishing.lastUpdate || 0) > REFRESH_MS || !hosts.size
  if (due) refresh().catch(() => {})
  clearInterval(timer)
  timer = setInterval(() => refresh().catch(() => {}), REFRESH_MS)
}

/** True when the URL's host (or a parent domain) is on a blocklist. */
function isDangerous(url) {
  if (!store.settings.data.phishing.enabled || !hosts.size) return false
  let host
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  const labels = host.split('.')
  for (let i = 0; i < labels.length - 1; i++) if (hosts.has(labels.slice(i).join('.'))) return true
  return false
}

module.exports = { start, refresh, isDangerous, parseFeed, count: () => hosts.size }
