import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSyncCode, deriveKeys, encryptRecord, decryptRecord } from '../src/index.js'
import { createShareCode, deriveShareKeys, sharePayload, parseSharePayload, ShareClient, syncShare } from '../src/sharing.js'

test('share keys are stable, per kind, and separate from personal sync', () => {
  const code = createShareCode()
  const a = deriveShareKeys(code, 'bookmarks')
  assert.deepEqual(a, deriveShareKeys(` ${code.toUpperCase()} `, 'bookmarks'))
  const b = deriveShareKeys(code, 'passwords')
  assert.notEqual(a.chainId, b.chainId)
  assert.notEqual(Buffer.from(a.encKey).toString('hex'), Buffer.from(b.encKey).toString('hex'))
  const personal = deriveKeys(code)
  assert.notEqual(personal.chainId, a.chainId)
  const blob = encryptRecord(a.encKey, 'share.bookmarks', 'x', { data: 'secret' })
  assert.throws(() => decryptRecord(b.encKey, 'share.bookmarks', 'x', blob))
  assert.throws(() => decryptRecord(personal.encKey, 'share.bookmarks', 'x', blob))
  assert.throws(() => deriveShareKeys('nope', 'bookmarks'))
  assert.throws(() => deriveShareKeys(code, 'Bad Kind!'))
})

test('share payload round-trips', () => {
  const code = createSyncCode()
  const p = sharePayload(code, 'https://sync.example.com', 'space')
  assert.match(p, /^bitshare:space:/)
  assert.deepEqual(parseSharePayload(p), { kind: 'space', server: 'https://sync.example.com', code })
  assert.equal(parseSharePayload('pixelsync:x#y'), null)
})

test('two family members sync a shared collection through a server', async () => {
  // In-memory stand-in for packages/sync-server.
  const store = new Map()
  let seq = 0
  const fakeFetch = async (url, opts = {}) => {
    const chain = /chains\/([0-9a-f]+)/.exec(url)[1]
    if (!store.has(chain)) store.set(chain, [])
    const list = store.get(chain)
    if (opts.method === 'POST') {
      for (const r of JSON.parse(opts.body).records) list.push({ ...r, seq: ++seq })
      return { ok: true, json: async () => ({ seq }) }
    }
    const since = Number(new URL(url).searchParams.get('since') || 0)
    return { ok: true, json: async () => ({ seq, more: false, records: list.filter((r) => r.seq > since) }) }
  }
  const code = createShareCode()
  const mom = new ShareClient({ server: 'https://s', code, kind: 'bookmarks', deviceId: 'mom', fetch: fakeFetch })
  const kid = new ShareClient({ server: 'https://s', code, kind: 'bookmarks', deviceId: 'kid', fetch: fakeFetch })
  const momRecs = { b1: { id: 'b1', updatedAt: 10, deviceId: 'mom', data: { url: 'https://pbskids.org', title: 'PBS Kids' } } }
  const r1 = await syncShare({ client: mom, records: momRecs, deviceId: 'mom' })
  assert.equal(r1.changed.length, 0)
  const r2 = await syncShare({ client: kid, records: {}, deviceId: 'kid' })
  assert.deepEqual(r2.changed, ['b1'])
  assert.equal(r2.records.b1.data.title, 'PBS Kids')
  // The server never sees the plain text.
  assert.ok(![...store.values()].flat().some((r) => r.blob.includes('PBS')))
  // A passwords share with the same words lives on a different chain.
  const other = new ShareClient({ server: 'https://s', code, kind: 'passwords', deviceId: 'kid', fetch: fakeFetch })
  const r3 = await syncShare({ client: other, records: {}, deviceId: 'kid' })
  assert.deepEqual(Object.keys(r3.records), [])
})
