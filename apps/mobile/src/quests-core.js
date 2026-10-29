// Weekly quests for the 128bit family, as pure functions (no app imports) so
// they can be unit tested with plain node. quests.js applies them to the app.
//
// Each ISO week picks QUESTS_PER_WEEK quests from the pool, the same ones on
// every device. Progress resets when a new week starts.

export const QUEST_POOL = [
  { id: 'read3', kind: 'articleRead', title: 'Read 3 articles in reader mode', goal: 3, xp: 40 },
  { id: 'block1000', kind: 'blocked', title: 'Block 1,000 ads and trackers', goal: 1000, xp: 50 },
  { id: 'streak5', kind: 'streakDay', title: 'Browse 5 different days this week', goal: 5, xp: 60 },
  { id: 'bookmark5', kind: 'bookmarked', title: 'Bookmark 5 sites', goal: 5, xp: 30 },
  { id: 'clean10', kind: 'tabCleaned', title: 'Clean up 10 tabs', goal: 10, xp: 30 },
  { id: 'summarize3', kind: 'summarized', title: 'Have Bitter summarize 3 pages', goal: 3, xp: 40 },
  { id: 'pin2', kind: 'pinned', title: 'Pin 2 tabs you use all the time', goal: 2, xp: 20 },
]

export const QUEST_KINDS = [...new Set(QUEST_POOL.map((q) => q.kind))]
export const QUESTS_PER_WEEK = 3

/** ISO week like '2026-W44' (weeks start Monday). */
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day) // the Thursday of this week decides the year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function hash(text) {
  let h = 2166136261
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return h
}

/** This week's quests: the same on every device for a given week. */
export function questsFor(week) {
  const pool = [...QUEST_POOL]
  const picked = []
  let h = hash(week)
  while (picked.length < QUESTS_PER_WEEK && pool.length) {
    picked.push(pool.splice(h % pool.length, 1)[0])
    h = hash(`${week}:${h}`)
  }
  return picked
}

const dayOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const emptyQuests = (week = '') => ({ week, progress: {}, done: {} })

/** Start a fresh slate when the week changed. */
export function forWeek(state, week) {
  return state && state.week === week ? state : emptyQuests(week)
}

/**
 * Count something toward this week's quests. Returns { quests, completed }
 * where completed lists the quests that just finished (each with its xp).
 * Doesn't change the input.
 */
export function progress(state, kind, n = 1, week = isoWeek(), today = dayOf(new Date())) {
  const base = forWeek(state, week)
  const quests = { week, progress: { ...base.progress }, done: { ...base.done }, ...(base.lastDay ? { lastDay: base.lastDay } : {}) }
  let count = Math.max(0, Math.floor(n) || 0)
  const completed = []
  // 'streakDay' counts each day once, however often the app is opened.
  if (kind === 'streakDay') {
    if (quests.lastDay === today) return { quests, completed }
    quests.lastDay = today
    count = 1
  }
  if (!count) return { quests, completed }
  for (const q of questsFor(week)) {
    if (q.kind !== kind || quests.done[q.id]) continue
    quests.progress[q.id] = Math.min(q.goal, (quests.progress[q.id] || 0) + count)
    if (quests.progress[q.id] >= q.goal) {
      quests.done[q.id] = true
      completed.push(q)
    }
  }
  return { quests, completed }
}

/** This week's quests with progress, for the 128bit family screen. */
export function questList(state, week = isoWeek()) {
  const s = forWeek(state, week)
  return questsFor(week).map((q) => ({ id: q.id, kind: q.kind, title: q.title, goal: q.goal, xp: q.xp, progress: s.progress[q.id] || 0, done: !!s.done[q.id] }))
}
