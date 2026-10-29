// Run: node --test apps/mobile/test/quests.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isoWeek, questsFor, progress, questList, emptyQuests, QUESTS_PER_WEEK } from '../src/quests-core.js'

test('ISO weeks', () => {
  assert.equal(isoWeek(new Date(2026, 0, 1)), '2026-W01') // Thursday
  assert.equal(isoWeek(new Date(2027, 0, 1)), '2026-W53') // Friday belongs to the last week of 2026
  assert.equal(isoWeek(new Date(2026, 9, 26)), '2026-W44')
})

test('the same week always picks the same distinct quests', () => {
  const a = questsFor('2026-W44').map((q) => q.id)
  assert.deepEqual(questsFor('2026-W44').map((q) => q.id), a)
  assert.equal(new Set(a).size, QUESTS_PER_WEEK)
  const weeks = new Set(Array.from({ length: 12 }, (_, i) => questsFor(`2026-W${10 + i}`).map((q) => q.id).join()))
  assert.ok(weeks.size > 1, 'quests rotate between weeks')
})

test('progress counts, completes once, and resets next week', () => {
  const week = '2026-W44'
  const quest = questsFor(week)[0]
  let r = progress(emptyQuests(week), quest.kind, quest.goal - 1, week)
  assert.deepEqual(r.completed, [])
  r = progress(r.quests, quest.kind, 5, week)
  assert.deepEqual(r.completed.map((q) => q.id), [quest.id])
  assert.equal(r.quests.progress[quest.id], quest.goal)
  r = progress(r.quests, quest.kind, 1, week)
  assert.deepEqual(r.completed, [], 'a finished quest does not finish again')
  const next = progress(r.quests, quest.kind, 1, '2026-W45')
  assert.equal(next.quests.week, '2026-W45')
  assert.equal(next.quests.done[quest.id], undefined)
})

test('kinds that are not quests this week change nothing', () => {
  const week = '2026-W44'
  const kinds = questsFor(week).map((q) => q.kind)
  const other = ['articleRead', 'blocked', 'streakDay', 'bookmarked', 'tabCleaned', 'summarized', 'pinned'].find((k) => !kinds.includes(k))
  const r = progress(emptyQuests(week), other, 100, week)
  assert.deepEqual(r.completed, [])
  assert.deepEqual(r.quests.progress, {})
})

test('questList reports progress for the screen', () => {
  const week = '2026-W44'
  const q = questsFor(week)[1]
  const { quests } = progress(emptyQuests(week), q.kind, 1, week)
  const row = questList(quests, week).find((x) => x.id === q.id)
  assert.equal(row.progress, 1)
  assert.equal(row.done, q.goal === 1)
  assert.equal(questList(null, week).length, QUESTS_PER_WEEK)
})

test('streakDay counts once per day', () => {
  const week = '2026-W44'
  let r = progress(emptyQuests(week), 'streakDay', 1, week, '2026-10-26')
  r = progress(r.quests, 'streakDay', 1, week, '2026-10-26')
  const id = 'streak5'
  if (questsFor(week).some((q) => q.id === id)) assert.equal(r.quests.progress[id], 1)
  r = progress(r.quests, 'streakDay', 1, week, '2026-10-27')
  if (questsFor(week).some((q) => q.id === id)) assert.equal(r.quests.progress[id], 2)
  assert.equal(r.quests.lastDay, '2026-10-27')
})
