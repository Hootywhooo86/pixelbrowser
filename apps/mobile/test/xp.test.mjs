// Run: node --test apps/mobile/test/xp.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyAward, levelOf, progressOf, mergeXp, emptyXp } from '../src/xp-core.js'

test('levels', () => {
  assert.equal(levelOf(0), 1)
  assert.equal(levelOf(49), 1)
  assert.equal(levelOf(50), 2)
  assert.equal(levelOf(200), 3)
  assert.deepEqual(progressOf(100), { level: 2, into: 50, needed: 150, pct: 50 / 150 })
})

test('blocked gives 1 XP per 10 and badges at 100 and 1000', () => {
  let x = emptyXp()
  let r = applyAward(x, 'blocked', 9, '2026-10-25')
  assert.equal(r.gained, 0)
  r = applyAward(r.xp, 'blocked', 1, '2026-10-25')
  assert.equal(r.gained, 1)
  r = applyAward(r.xp, 'blocked', 990, '2026-10-25')
  assert.equal(r.xp.total, 100)
  assert.deepEqual(r.newBadges.map((b) => b.id).sort(), ['trackers100', 'trackers1000'])
  assert.equal(r.levelUp, true)
})

test('daily streak counts up, resets after a missed day, once per day', () => {
  let r = applyAward(emptyXp(), 'dailyVisit', 1, '2026-10-24')
  assert.equal(r.xp.streak, 1)
  r = applyAward(r.xp, 'dailyVisit', 1, '2026-10-24')
  assert.equal(r.gained, 0)
  r = applyAward(r.xp, 'dailyVisit', 1, '2026-10-25')
  assert.equal(r.xp.streak, 2)
  assert.equal(r.gained, 20)
  r = applyAward(r.xp, 'dailyVisit', 1, '2026-10-27')
  assert.equal(r.xp.streak, 1)
  assert.equal(r.xp.counters.bestStreak, 2)
})

test('streak crosses month boundaries', () => {
  let r = applyAward(emptyXp(), 'dailyVisit', 1, '2026-10-31')
  r = applyAward(r.xp, 'dailyVisit', 1, '2026-11-01')
  assert.equal(r.xp.streak, 2)
})

test('unknown kinds change nothing', () => {
  const x = emptyXp()
  assert.equal(applyAward(x, 'nope').xp, x)
})

test('merge keeps the highest counters and all badges', () => {
  const a = { total: 10, streak: 3, lastDay: '2026-10-20', badges: { a: '1' }, counters: { blocked: 50, sync: 1 } }
  const b = { total: 30, streak: 1, lastDay: '2026-10-25', badges: { b: '2' }, counters: { blocked: 20, tabCleaned: 4 } }
  assert.deepEqual(mergeXp(a, b), { total: 30, streak: 1, lastDay: '2026-10-25', badges: { a: '1', b: '2' }, counters: { blocked: 50, sync: 1, tabCleaned: 4 } })
})
