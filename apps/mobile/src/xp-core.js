// XP rules for the 128bit family, as pure functions (no app imports), so they
// can be unit tested with plain node. xp.js applies them to the app state.

export const BADGES = [
  { id: 'trackers100', label: 'Tracker Squasher', note: '100 trackers and ads squashed', counter: 'blocked', at: 100 },
  { id: 'trackers1000', label: '1,000 Trackers Squashed', note: '1,000 trackers and ads squashed', counter: 'blocked', at: 1000 },
  { id: 'trackers10000', label: 'Shield Master', note: '10,000 trackers and ads squashed', counter: 'blocked', at: 10000 },
  { id: 'streak7', label: 'Week Streak', note: 'Browsed 7 days in a row', counter: 'bestStreak', at: 7 },
  { id: 'streak30', label: 'Month Streak', note: 'Browsed 30 days in a row', counter: 'bestStreak', at: 30 },
  { id: 'tabsCleaned10', label: 'Tab Tidier', note: 'Closed 10 stale tabs', counter: 'tabCleaned', at: 10 },
  { id: 'tabsCleaned100', label: 'Tab Janitor', note: 'Closed 100 stale tabs', counter: 'tabCleaned', at: 100 },
  { id: 'articles10', label: 'Bookworm', note: 'Finished reading 10 articles', counter: 'articleFinished', at: 10 },
  { id: 'firstSync', label: 'Connected', note: 'Synced with another device', counter: 'sync', at: 1 },
]

export const KINDS = ['blocked', 'tabCleaned', 'articleFinished', 'dailyVisit', 'sync']

export const emptyXp = () => ({ total: 0, streak: 0, lastDay: '', badges: {}, counters: {} })

/** Level for an XP total: 1 at 0 XP, 2 at 50, 3 at 200, 4 at 450… */
export function levelOf(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp || 0) / 50)) + 1
}

const levelStart = (level) => 50 * (level - 1) ** 2

/** Progress through the current level: { level, into, needed, pct }. */
export function progressOf(xp) {
  const level = levelOf(xp)
  const start = levelStart(level)
  const needed = levelStart(level + 1) - start
  const into = Math.max(0, (xp || 0) - start)
  return { level, into, needed, pct: needed ? into / needed : 0 }
}

/** 'YYYY-MM-DD' in local time. */
export function dayString(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

function dayBefore(day) {
  const [y, m, d] = day.split('-').map(Number)
  return dayString(new Date(y, m - 1, d - 1))
}

/**
 * Apply one award to an XP state and return { xp, gained, levelUp, newBadges }.
 * Doesn't change the input.
 *   blocked n          +1 XP for every 10 trackers/ads blocked
 *   tabCleaned n       +5 XP each
 *   articleFinished n  +10 XP each
 *   dailyVisit         once a day: streak +1 (or back to 1 after a missed day), +10 XP per streak day (max 70)
 *   sync               +5 XP
 */
export function applyAward(stateXp, kind, n = 1, today = dayString()) {
  const xp = { ...emptyXp(), ...(stateXp || {}) }
  xp.counters = { ...(xp.counters || {}) }
  xp.badges = { ...(xp.badges || {}) }
  const before = xp.total || 0
  const count = Math.max(0, Math.floor(n) || 0)
  let gained = 0
  switch (kind) {
    case 'blocked': {
      const old = xp.counters.blocked || 0
      xp.counters.blocked = old + count
      gained = Math.floor(xp.counters.blocked / 10) - Math.floor(old / 10)
      break
    }
    case 'tabCleaned':
      xp.counters.tabCleaned = (xp.counters.tabCleaned || 0) + count
      gained = 5 * count
      break
    case 'articleFinished':
      xp.counters.articleFinished = (xp.counters.articleFinished || 0) + count
      gained = 10 * count
      break
    case 'dailyVisit':
      if (xp.lastDay === today) break
      xp.streak = xp.lastDay && xp.lastDay === dayBefore(today) ? (xp.streak || 0) + 1 : 1
      xp.lastDay = today
      xp.counters.bestStreak = Math.max(xp.counters.bestStreak || 0, xp.streak)
      xp.counters.days = (xp.counters.days || 0) + 1
      gained = 10 * Math.min(xp.streak, 7)
      break
    case 'sync':
      xp.counters.sync = (xp.counters.sync || 0) + 1
      gained = 5
      break
    default:
      return { xp: stateXp, gained: 0, levelUp: false, newBadges: [] }
  }
  xp.total = before + gained
  const newBadges = []
  for (const b of BADGES) {
    if (!xp.badges[b.id] && (xp.counters[b.counter] || 0) >= b.at) {
      xp.badges[b.id] = today
      newBadges.push(b)
    }
  }
  return { xp, gained, levelUp: levelOf(xp.total) > levelOf(before), newBadges }
}

/** Merge XP from another device: highest counters and totals win, badges add up, the newer streak wins. */
export function mergeXp(local, remote) {
  const a = { ...emptyXp(), ...(local || {}) }
  const b = { ...emptyXp(), ...(remote || {}) }
  const counters = { ...a.counters }
  for (const [k, v] of Object.entries(b.counters || {})) counters[k] = Math.max(counters[k] || 0, v || 0)
  const badges = { ...b.badges, ...a.badges }
  const newer = (b.lastDay || '') > (a.lastDay || '') ? b : a
  return { total: Math.max(a.total || 0, b.total || 0), streak: newer.streak || 0, lastDay: newer.lastDay || '', badges, counters }
}
