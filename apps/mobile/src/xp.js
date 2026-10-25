// XP, levels, streaks and badges for the 128bit family. Rules live in
// xp-core.js. XP is kept on this device, synced (encrypted) to your other
// devices, and queued for 128bit when you connect an account.

import { getState, update, putRecord } from './store'
import { emit } from './events'
import { play } from './sounds'
import { BADGES, applyAward, mergeXp, levelOf, progressOf, dayString } from './xp-core'

export { BADGES, levelOf, progressOf, applyAward }

const listeners = new Set()
let syncTimer = null

/** Hear about level-ups and new badges (for a toast or animation). Returns an unsubscribe function. */
export function onXpEvent(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Give XP for something the user did. kind: 'blocked' | 'tabCleaned' | 'articleFinished' | 'dailyVisit' | 'sync'. */
export function award(kind, n = 1) {
  const s = getState()
  if (!s) return { levelUp: false, newBadges: [] }
  const res = applyAward(s.xp, kind, n, dayString())
  if (!res.gained && !res.newBadges.length && res.xp === s.xp) return { levelUp: false, newBadges: [] }
  update((st) => (st.xp = res.xp))
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => putRecord('settings', 'xp', getState().xp), 5000)
  if (kind === 'dailyVisit' && [7, 30, 100, 365].includes(res.xp.streak)) emit('streak.milestone', { days: res.xp.streak })
  if (kind === 'tabCleaned') emit('tabs.cleaned', { count: n })
  if (res.levelUp) play('levelup')
  if (res.levelUp || res.newBadges.length) {
    const event = { levelUp: res.levelUp, level: levelOf(res.xp.total), newBadges: res.newBadges }
    for (const fn of listeners) fn(event)
  }
  return { levelUp: res.levelUp, newBadges: res.newBadges }
}

/** Merge XP synced from another device (call after sync pulls records). */
export function mergeRemoteXp(remote) {
  const rec = remote || getState()?.records?.settings?.xp
  const data = rec?.data !== undefined ? rec.data : rec
  if (!data || rec?.deleted) return
  const merged = mergeXp(getState().xp, data)
  if (JSON.stringify(merged) !== JSON.stringify(getState().xp)) update((s) => (s.xp = merged))
}
