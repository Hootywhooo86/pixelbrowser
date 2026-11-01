// Watched pages: "tell me when this page changes" and price tracking.
//
// Each watcher is a synced record in the 'watchers' collection:
//   { type: 'change' | 'price', url, title, every: hours, target?: price,
//     lastHash, lastText, lastPrice, currency, lastCheck, lastChange, error }
// Pages are fetched directly by the phone (no server), compared with the last
// visit, and a notification is shown when something changed or a price drops.
// Checks run when the app opens or comes back, and every few hours in the
// background where the phone allows it (expo-background-task).
// With AI on, Bitter can write a one-line summary of what changed.

import { Platform } from 'react-native'
import * as Crypto from 'expo-crypto'
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import * as BackgroundTask from 'expo-background-task'
import { getState, putRecord, liveRecords, useStore } from './store'
import { extractPrice, pageText, diffText, textHash } from './web-tools-core'
import { askAIText } from './history-search'

export const TASK = 'bit-watchers'
const UA =
  Platform.OS === 'ios'
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const MAX_TEXT = 20000

export const EVERY = [
  { hours: 1, label: 'Every hour' },
  { hours: 6, label: 'Every 6 hours' },
  { hours: 24, label: 'Every day' },
  { hours: 168, label: 'Every week' },
]

/** Watchers, newest first: [{ id, ...data }]. */
export function listWatchers() {
  return liveRecords('watchers')
    .map((r) => ({ id: r.id, ...r.data }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

/** React hook: watchers, re-rendering when they change. */
export function useWatchers() {
  useStore((s) => s.records.watchers)
  return listWatchers()
}

/** Start watching a page. type 'change' (any text change) or 'price'. Checks once right away. */
export async function addWatcher({ url, title = '', type = 'change', every = 24, target = null }) {
  if (!/^https?:/i.test(String(url))) throw new Error('Only web pages (http/https) can be watched.')
  const dupe = listWatchers().find((w) => w.url === url && w.type === type)
  if (dupe) return dupe.id
  const id = Crypto.randomUUID()
  putRecord('watchers', id, { type, url, title: title || url, every, target, createdAt: Date.now(), lastCheck: 0 })
  checkWatcher(id, { notify: false }).catch(() => {})
  return id
}

export function updateWatcher(id, patch) {
  const cur = liveRecords('watchers').find((r) => r.id === id)
  if (cur) putRecord('watchers', id, { ...cur.data, ...patch })
}

export function removeWatcher(id) {
  putRecord('watchers', id, null, { deleted: true })
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en' } })
  if (!res.ok) throw new Error(`The site said ${res.status}.`)
  return res.text()
}

async function notify(title, body, url) {
  try {
    const perm = await Notifications.getPermissionsAsync()
    if (!perm.granted) return
    await Notifications.scheduleNotificationAsync({ content: { title, body, data: { url } }, trigger: null })
  } catch {}
}

const money = (n, cur) => {
  try {
    return cur ? new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n) : `$${n.toFixed(2)}`
  } catch {
    return `${n.toFixed(2)} ${cur}`
  }
}

/** Check one watcher now. Returns { changed, message }. */
export async function checkWatcher(id, { notify: shouldNotify = true } = {}) {
  const rec = liveRecords('watchers').find((r) => r.id === id)
  if (!rec) return { changed: false }
  const w = rec.data
  const now = Date.now()
  try {
    const html = await fetchPage(w.url)
    if (w.type === 'price') {
      const found = extractPrice(html)
      if (!found) {
        updateWatcher(id, { lastCheck: now, error: "Couldn't find a price on this page." })
        return { changed: false }
      }
      const was = w.lastPrice
      const dropped = was != null && found.price < was
      const hitTarget = w.target != null && found.price <= w.target && (was == null || was > w.target)
      updateWatcher(id, {
        lastCheck: now,
        error: '',
        lastPrice: found.price,
        currency: found.currency || w.currency || '',
        lowest: Math.min(found.price, w.lowest ?? found.price),
        ...(found.price !== was ? { lastChange: now, previousPrice: was ?? null } : {}),
      })
      if ((dropped || hitTarget) && shouldNotify) {
        const msg = `${money(found.price, found.currency)}${was != null ? ` (was ${money(was, found.currency)})` : ''}`
        await notify(`Price drop: ${w.title}`, msg, w.url)
        return { changed: true, message: msg }
      }
      return { changed: found.price !== was }
    }
    const text = pageText(html).slice(0, MAX_TEXT)
    const hash = textHash(text)
    if (!w.lastHash) {
      updateWatcher(id, { lastCheck: now, lastHash: hash, lastText: text, error: '' })
      return { changed: false }
    }
    if (hash === w.lastHash) {
      updateWatcher(id, { lastCheck: now, error: '' })
      return { changed: false }
    }
    const d = diffText(w.lastText || '', text, 12)
    let summary = d.added.slice(0, 3).join(' · ').slice(0, 200) || 'Something on the page changed.'
    if (getState()?.aiEnabled && w.summarize !== false) {
      summary =
        (await askAIText(
          'In one short sentence, tell the user what changed on a web page they watch. Ignore dates, counters, ads and menus. If nothing meaningful changed, reply exactly: NOTHING.',
          `Page: ${w.title}\nAdded lines:\n${d.added.join('\n')}\n\nRemoved lines:\n${d.removed.join('\n')}`,
          { maxChars: 3000 }
        ).catch(() => summary)) || summary
      if (/^NOTHING\.?$/i.test(summary.trim())) {
        updateWatcher(id, { lastCheck: now, lastHash: hash, lastText: text, error: '' })
        return { changed: false }
      }
    }
    updateWatcher(id, { lastCheck: now, lastHash: hash, lastText: text, lastChange: now, lastSummary: summary, error: '' })
    if (shouldNotify) await notify(`Changed: ${w.title}`, summary, w.url)
    return { changed: true, message: summary }
  } catch (e) {
    updateWatcher(id, { lastCheck: now, error: e.message || 'Could not check the page.' })
    return { changed: false, error: e.message }
  }
}

/** Check every watcher that's due (or all with force). */
export async function checkDue({ force = false } = {}) {
  const now = Date.now()
  const due = listWatchers().filter((w) => force || now - (w.lastCheck || 0) >= (w.every || 24) * 3600000 * 0.9)
  const results = []
  for (const w of due) results.push(await checkWatcher(w.id))
  return results
}

// Background checks (where the phone allows: Android WorkManager, iOS BGTaskScheduler).
// The task must be defined at module load, so App.js imports this file early.
try {
  TaskManager.defineTask(TASK, async () => {
    try {
      // The store is loaded by App before tasks run in the foreground; in a
      // cold background start it may not be, so load it first.
      const { loadStore } = require('./store')
      if (!getState()) await loadStore()
      await checkDue()
      return BackgroundTask.BackgroundTaskResult.Success
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed
    }
  })
} catch {}

/**
 * Call once after the store loads: asks for notification permission the
 * first time there are watchers, registers the background task, and checks
 * anything due now.
 */
export async function startWatchers() {
  if (!listWatchers().length) return
  try {
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) })
    const perm = await Notifications.getPermissionsAsync()
    if (!perm.granted && perm.canAskAgain) await Notifications.requestPermissionsAsync()
  } catch {}
  try {
    const status = await BackgroundTask.getStatusAsync()
    if (status === BackgroundTask.BackgroundTaskStatus.Available && !(await TaskManager.isTaskRegisteredAsync(TASK))) {
      await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 60 }) // minutes; the OS decides the real timing
    }
  } catch {}
  checkDue().catch(() => {})
}

/** Tapping a watcher notification: returns the URL to open (App adds the listener). */
export function onWatcherNotificationTap(fn) {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const url = r?.notification?.request?.content?.data?.url
    if (url) fn(url)
  })
  return () => sub.remove()
}
