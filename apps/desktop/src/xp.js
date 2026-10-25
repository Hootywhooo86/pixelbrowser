// 128bit XP on this device: points, levels, streaks and badges for browsing
// (Shields blocks, cleaned-up tabs, daily streaks). Synced between your
// devices as the 'xp' settings record; counters merge by taking the highest.

const store = require('./store')

const BADGES = [
  { id: 'squash-100', label: '100 trackers squashed', counter: 'blocked', at: 100 },
  { id: 'squash-1000', label: '1,000 trackers squashed', counter: 'blocked', at: 1000 },
  { id: 'squash-10000', label: '10,000 trackers squashed', counter: 'blocked', at: 10000 },
  { id: 'tidy-10', label: 'Tidied 10 stale tabs', counter: 'tabsCleaned', at: 10 },
  { id: 'streak-7', label: '7-day streak', counter: 'streak', at: 7 },
  { id: 'streak-30', label: '30-day streak', counter: 'streak', at: 30 },
]

const listeners = new Set()
let saveTimer = null

const data = () => store.settings.data.xp

/** +1 per 10 blocked, +5 per stale tab cleaned, +10 per streak day. */
function pointsFor(c) {
  return Math.floor((c.blocked || 0) / 10) + 5 * (c.tabsCleaned || 0) + 10 * (c.streakDays || 0)
}

const levelFor = (xp) => Math.floor(Math.sqrt(xp / 50)) + 1

function summary() {
  const x = data()
  const xp = pointsFor(x.counters)
  const level = levelFor(xp)
  const values = { ...x.counters, streak: x.streak }
  const nextAt = 50 * level * level
  return {
    xp,
    level,
    nextAt,
    streak: x.streak,
    counters: x.counters,
    badges: BADGES.map((b) => ({ ...b, earned: (values[b.counter] || 0) >= b.at })),
  }
}

function changed(before) {
  const after = summary()
  persist()
  for (const fn of listeners) fn(after, after.level > before.level)
}

function persist() {
  store.settings.data.xp.updatedAt = Date.now()
  store.settings.save()
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => store.putRecord('settings', 'xp', { counters: data().counters, streak: data().streak, lastDay: data().lastDay }), 5000)
}

function add(counter, n = 1) {
  const before = summary()
  data().counters[counter] = (data().counters[counter] || 0) + n
  changed(before)
}

const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10)

/** Count today toward the daily streak (call when the user browses). */
function touchDay() {
  const x = data()
  const today = dayKey()
  if (x.lastDay === today) return
  const before = summary()
  x.streak = x.lastDay === dayKey(Date.now() - 86400000) ? (x.streak || 0) + 1 : 1
  x.lastDay = today
  x.counters.streakDays = (x.counters.streakDays || 0) + 1
  changed(before)
}

/** XP that arrived from another device: keep the highest of each counter. */
function applyRemote() {
  const rec = store.records.data.settings.xp
  if (!rec || rec.deleted || rec.deviceId === store.settings.data.deviceId) return
  const x = data()
  const before = summary()
  let any = false
  for (const [k, v] of Object.entries(rec.data?.counters || {})) {
    if (typeof v === 'number' && v > (x.counters[k] || 0)) {
      x.counters[k] = v
      any = true
    }
  }
  if ((rec.data?.lastDay || '') >= (x.lastDay || '') && (rec.data?.streak || 0) > (x.streak || 0)) {
    x.streak = rec.data.streak
    x.lastDay = rec.data.lastDay
    any = true
  }
  if (any) {
    store.settings.save()
    for (const fn of listeners) fn(summary(), summary().level > before.level)
  }
}

function reset() {
  store.settings.data.xp = { counters: { blocked: 0, tabsCleaned: 0, streakDays: 0 }, lastDay: '', streak: 0, updatedAt: Date.now() }
  store.settings.save()
  store.putRecord('settings', 'xp', { counters: data().counters, streak: 0, lastDay: '' })
  for (const fn of listeners) fn(summary(), false)
}

const onChange = (fn) => listeners.add(fn)

module.exports = { add, touchDay, summary, applyRemote, reset, onChange, levelFor, pointsFor, BADGES }
