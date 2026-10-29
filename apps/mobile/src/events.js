// 128bit family events (see README "128bit tie-in"). Bit Browser only emits;
// 128bitlife owns quests and XP. Nothing is recorded unless the user has
// connected a 128bit account AND turned on sharing for that event type.
// Events wait in a local queue (max 200) until a 128bit backend exists to
// send them to.

import { getState, update } from './store'

export const EVENT_TYPES = {
  'tab.opened': { label: 'Opened a tab', note: 'Counts only, never the address' },
  'article.finished': { label: 'Finished reading an article', note: 'Site name and reading time' },
  'readlater.cleared': { label: 'Cleared the read-later list', note: 'How many items' },
  'streak.milestone': { label: 'Hit a browsing streak milestone', note: 'Streak length' },
  'tabs.cleaned': { label: 'Closed stale tabs (tab quests)', note: 'How many tabs' },
  'quest.completed': { label: 'Finished a weekly quest', note: 'Which quest and the XP it gave' },
}

export const FAMILY_APPS = [
  { id: '128bitlife', label: '128bitlife', note: 'Quests, XP and streaks across the family' },
  { id: 'bitbrowser', label: 'Bit Browser', note: 'This app: the family window to the web' },
]

const QUEUE_LIMIT = 200

/** Record a family event if the user opted in; otherwise does nothing. */
export function emit(type, data = {}) {
  const s = getState()
  const f = s?.family
  if (!f?.connected || !f.share?.[type] || !EVENT_TYPES[type]) return false
  const event = { v: 1, type, app: 'bitbrowser', at: new Date().toISOString(), deviceId: s.deviceId, data }
  update((st) => {
    st.family.queue = [...(st.family.queue || []), event].slice(-QUEUE_LIMIT)
  })
  return true
}

export function setShare(type, on) {
  update((s) => (s.family.share = { ...s.family.share, [type]: !!on }))
}

/** Disconnect: stop sharing and drop anything waiting in the queue. */
export function disconnectFamily() {
  update((s) => (s.family = { ...s.family, connected: false, account: null, share: {}, queue: [] }))
}
