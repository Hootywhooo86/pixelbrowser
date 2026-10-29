// 128bit weekly quests on the computer. Same pool and weekly pick as the phone
// (apps/mobile/src/quests-core.js), so both show the same three quests. A
// finished quest adds its XP (the 'questXp' counter in xp.js). Progress lives
// on this device and resets every week.

const store = require('./store')
const xp = require('./xp')

const QUEST_POOL = [
  { id: 'read3', kind: 'articleRead', title: 'Read 3 articles in reader mode', goal: 3, xp: 40 },
  { id: 'block1000', kind: 'blocked', title: 'Block 1,000 ads and trackers', goal: 1000, xp: 50 },
  { id: 'streak5', kind: 'streakDay', title: 'Browse 5 different days this week', goal: 5, xp: 60 },
  { id: 'bookmark5', kind: 'bookmarked', title: 'Bookmark 5 sites', goal: 5, xp: 30 },
  { id: 'clean10', kind: 'tabCleaned', title: 'Clean up 10 tabs', goal: 10, xp: 30 },
  { id: 'summarize3', kind: 'summarized', title: 'Have Bitter summarize 3 pages', goal: 3, xp: 40 },
  { id: 'pin2', kind: 'pinned', title: 'Pin 2 tabs you use all the time', goal: 2, xp: 20 },
]
const QUESTS_PER_WEEK = 3

/** ISO week like '2026-W44' (weeks start Monday). */
function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function hash(text) {
  let h = 2166136261
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return h
}

function questsFor(week) {
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
const listeners = new Set()

function current(week = isoWeek()) {
  const q = store.settings.data.quests
  if (!q || q.week !== week) store.settings.data.quests = { week, progress: {}, done: {} }
  return store.settings.data.quests
}

/** Count something toward this week's quests; finished quests award their XP. */
function progress(kind, n = 1) {
  const week = isoWeek()
  const q = current(week)
  let count = Math.max(0, Math.floor(n) || 0)
  if (kind === 'streakDay') {
    const today = dayOf(new Date())
    if (q.lastDay === today) return []
    q.lastDay = today
    count = 1
  }
  if (!count) return []
  const completed = []
  let moved = false
  for (const quest of questsFor(week)) {
    if (quest.kind !== kind || q.done[quest.id]) continue
    q.progress[quest.id] = Math.min(quest.goal, (q.progress[quest.id] || 0) + count)
    moved = true
    if (q.progress[quest.id] >= quest.goal) {
      q.done[quest.id] = true
      completed.push(quest)
    }
  }
  if (moved) store.settings.save()
  for (const quest of completed) xp.add('questXp', quest.xp)
  if (moved) for (const fn of listeners) fn(completed)
  return completed
}

/** This week's quests with progress. */
function list() {
  const week = isoWeek()
  const q = current(week)
  return questsFor(week).map((x) => ({ id: x.id, title: x.title, goal: x.goal, xp: x.xp, progress: q.progress[x.id] || 0, done: !!q.done[x.id] }))
}

const onChange = (fn) => listeners.add(fn)

module.exports = { progress, list, onChange, isoWeek, questsFor, QUEST_POOL }
