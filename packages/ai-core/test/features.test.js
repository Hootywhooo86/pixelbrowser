import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateCost, priceFor, capStatus, addSpend, capMessage, dayKey,
  parseCitations, isYouTubeWatch, parseJson3, pickTrack, transcriptBlock,
  runAssistant, resolveProvider, systemPrompt,
} from '../src/index.js'

test('estimateCost uses per-million prices; local models are free', () => {
  assert.equal(estimateCost('anthropic', 'claude-opus-5-5', { input: 1_000_000, output: 100_000 }), 4 + 2)
  assert.equal(estimateCost('anthropic', 'claude-haiku-5-5', { input: 2_000_000, output: 0 }), 0.2)
  assert.equal(estimateCost('ollama', 'llama3.2', { input: 5e6, output: 5e6 }), 0)
  assert.deepEqual(priceFor('openai', 'gpt-5-mini-2026'), [0.25, 2]) // prefix match
  assert.deepEqual(priceFor('nope', 'x'), [0, 0])
})

test('capStatus checks the day first, then the month', () => {
  const now = new Date(2026, 9, 25, 12)
  const today = dayKey(now)
  assert.equal(today, '2026-10-25')
  assert.equal(capStatus({ capDay: 0, capMonth: 0, spent: { [today]: 99 } }, now), null)
  assert.deepEqual(capStatus({ capDay: 1, spent: { [today]: 1.5 } }, now), { which: 'day', spent: 1.5, cap: 1 })
  const spent = { '2026-10-01': 6, '2026-10-24': 4, '2026-09-30': 50 }
  assert.deepEqual(capStatus({ capDay: 1, capMonth: 10, spent }, now), { which: 'month', spent: 10, cap: 10 })
  assert.equal(capStatus({ capMonth: 11, spent }, now), null)
  assert.match(capMessage({ which: 'day', spent: 1.5, cap: 1 }), /daily .*\$1\.00/)
})

test('addSpend accumulates and prunes old days', () => {
  const now = new Date(2026, 9, 25)
  const spent = { '2026-01-01': 3 }
  addSpend(spent, 0.25, now)
  addSpend(spent, 0.5, now)
  assert.deepEqual(spent, { '2026-10-25': 0.75 })
})

test('parseCitations finds unique links and tab markers', () => {
  const c = parseCitations('Price is $5 [Shop](https://www.shop.test/a). Also [tab 3] and [Tab #3] and [Shop again](https://www.shop.test/a) [Docs](http://docs.test/x).')
  assert.deepEqual(c, [
    { type: 'link', url: 'https://www.shop.test/a', title: 'Shop', host: 'shop.test' },
    { type: 'link', url: 'http://docs.test/x', title: 'Docs', host: 'docs.test' },
    { type: 'tab', tabId: 3 },
  ])
  assert.deepEqual(parseCitations('no sources here'), [])
})

test('isYouTubeWatch', () => {
  assert.ok(isYouTubeWatch('https://www.youtube.com/watch?v=abc'))
  assert.ok(isYouTubeWatch('https://m.youtube.com/watch?v=abc&t=3'))
  assert.ok(isYouTubeWatch('https://youtu.be/abc'))
  assert.ok(isYouTubeWatch('https://www.youtube.com/shorts/abc'))
  assert.ok(!isYouTubeWatch('https://www.youtube.com/'))
  assert.ok(!isYouTubeWatch('https://example.com/watch?v=1'))
  assert.ok(!isYouTubeWatch('not a url'))
})

test('parseJson3 joins caption segments and caps length', () => {
  const data = { events: [{ tStartMs: 0 }, { segs: [{ utf8: 'Hello' }, { utf8: ' world' }] }, { segs: [{ utf8: '\n' }] }, { segs: [{ utf8: 'Hello world' }] }, { segs: [{ utf8: 'Bye  now' }] }] }
  assert.equal(parseJson3(data), 'Hello world Bye now')
  assert.match(parseJson3({ events: [{ segs: [{ utf8: 'x'.repeat(50) }] }] }, 10), /^x{10} \[transcript truncated\]$/)
})

test('pickTrack prefers user language, then English, human over auto', () => {
  const tracks = [{ languageCode: 'de' }, { languageCode: 'en', kind: 'asr' }, { languageCode: 'en' }, { languageCode: 'fr-CA', kind: 'asr' }]
  assert.equal(pickTrack(tracks, 'fr-FR').languageCode, 'fr-CA')
  assert.deepEqual(pickTrack(tracks, 'ja'), { languageCode: 'en' })
  assert.equal(pickTrack([], 'en'), null)
})

test('transcriptBlock falls back when there are no captions', () => {
  assert.match(transcriptBlock({ ok: false, title: 'T', description: 'About cats' }), /no captions.*About cats/s)
  assert.match(transcriptBlock({ ok: true, title: 'T', json3: { events: [{ segs: [{ utf8: 'hi' }] }] } }), /<video_transcript title="T"[^>]*>\nhi\n/)
})

test('system prompt asks for citations', () => {
  assert.match(systemPrompt({ mode: 'ask' }), /\[tab N\]/)
})

function driver() {
  return {
    activeTabId: async () => 1,
    listTabs: async () => [{ id: 1, title: 'Video', url: 'https://www.youtube.com/watch?v=abc' }],
    run: async (_id, script) => (script.includes('ytInitialPlayerResponse') ? { ok: true, title: 'Cats', channel: 'C', lang: 'en', json3: { events: [{ segs: [{ utf8: 'cats are great' }] }] } } : { title: 'Video', url: 'https://www.youtube.com/watch?v=abc', text: 'page', selection: '' }),
    fetchText: async () => '',
  }
}

test('video: true adds the transcript; spending is recorded and the cap stops the turn', async () => {
  const realFetch = globalThis.fetch
  const bodies = []
  globalThis.fetch = async (_u, init) => {
    bodies.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Summary [tab 1]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }), { headers: { 'content-type': 'application/json' } })
  }
  try {
    const provider = resolveProvider({ provider: 'openai', apiKey: 'k' })
    const added = []
    const events = []
    await runAssistant({ provider, driver: driver(), input: 'Summarize', video: true, spend: { check: () => null, add: (d, u) => added.push([d, u]) }, onEvent: (e) => events.push(e) })
    assert.match(bodies[0].messages.at(-1).content, /<video_transcript title="Cats"[^>]*>\ncats are great/)
    assert.equal(added.length, 1)
    assert.ok(Math.abs(added[0][0] - (1000 * 1.25 + 100 * 10) / 1e6) < 1e-12)

    // Over the cap and the user declines: no model call, a stop note, and a log entry.
    const before = bodies.length
    const ev2 = []
    await runAssistant({ provider, driver: driver(), input: 'Again', includePage: false, spend: { check: () => ({ which: 'day', spent: 2, cap: 1 }), add: () => {} }, confirm: async () => false, onEvent: (e) => ev2.push(e) })
    assert.equal(bodies.length, before)
    assert.ok(ev2.some((e) => e.type === 'text' && /spending cap/.test(e.text)))
    assert.ok(ev2.some((e) => e.type === 'log' && e.kind === 'confirm' && /^Declined/.test(e.text)))
  } finally {
    globalThis.fetch = realFetch
  }
})
