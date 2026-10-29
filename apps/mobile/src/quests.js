// Weekly quests (128bit family). Rules live in quests-core.js. Progress is
// kept on this device; finishing a quest gives XP (src/xp.js) and queues a
// 128bit event if the user connected an account and shares quests.

import { useStore, getState, update } from './store'
import { grantXp } from './xp'
import { emit } from './events'
import { progress, questList, isoWeek, QUEST_KINDS } from './quests-core'

export { QUEST_KINDS }

/**
 * Count something toward this week's quests.
 * kind: 'articleRead' | 'blocked' | 'streakDay' | 'bookmarked' | 'tabCleaned' | 'summarized' | 'pinned'
 * Returns the quests that just finished.
 */
export function track(kind, n = 1) {
  const s = getState()
  if (!s || !QUEST_KINDS.includes(kind)) return []
  const { quests, completed } = progress(s.quests, kind, n, isoWeek())
  if (JSON.stringify(quests) !== JSON.stringify(s.quests)) update((st) => (st.quests = quests))
  for (const q of completed) {
    grantXp(q.xp, `quest:${q.id}`)
    emit('quest.completed', { quest: q.id, xp: q.xp })
  }
  return completed
}

/** React hook: this week's quests as [{ id, title, progress, goal, done, xp }]. */
export function useQuests() {
  const state = useStore((s) => s.quests)
  return questList(state, isoWeek())
}
