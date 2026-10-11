import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSyncServer } from '../src/server.js'
import { SyncClient, createSyncCode } from '@pixelbrowser/sync-core'

async function withServer(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelsync-'))
  const server = createSyncServer({ dataDir })
  await new Promise((r) => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(url, dataDir)
  } finally {
    server.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('two devices sync through the server, which only sees ciphertext', () =>
  withServer(async (server, dataDir) => {
    const code = createSyncCode()
    const laptop = new SyncClient({ server, code, deviceId: 'laptop' })
    const phone = new SyncClient({ server, code, deviceId: 'phone' })

    await laptop.push([{ collection: 'memory', id: 'm1', updatedAt: 1, data: 'I prefer metric units' }])
    const { seq, records } = await phone.pull(0)
    assert.equal(records.length, 1)
    assert.equal(records[0].data, 'I prefer metric units')
    assert.equal(records[0].deviceId, 'laptop')

    const stored = fs.readFileSync(path.join(dataDir, `${laptop.chainId}.json`), 'utf8')
    assert.ok(!stored.includes('metric'))

    await phone.push([{ collection: 'tabs', id: 'phone', updatedAt: 2, data: [{ url: 'https://example.com' }] }])
    const next = await laptop.pull(seq)
    assert.equal(next.records.length, 1)
    assert.equal(next.records[0].collection, 'tabs')
  }))

test('a different code cannot read or write the chain', () =>
  withServer(async (server) => {
    const code = createSyncCode()
    const owner = new SyncClient({ server, code, deviceId: 'a' })
    await owner.push([{ collection: 'memory', id: 'x', updatedAt: 1, data: 'secret' }])

    const intruder = new SyncClient({ server, code: createSyncCode(), deviceId: 'b' })
    intruder.chainId = owner.chainId
    await assert.rejects(intruder.pull(0), /403/)
    await assert.rejects(intruder.push([{ collection: 'memory', id: 'x', updatedAt: 2, data: 'evil' }]), /403/)
  }))

test('wipe deletes the chain', () =>
  withServer(async (server) => {
    const code = createSyncCode()
    const c = new SyncClient({ server, code, deviceId: 'a' })
    await c.push([{ collection: 'memory', id: 'x', updatedAt: 1, data: 'hi' }])
    await c.wipe()
    const { records } = await c.pull(0)
    assert.equal(records.length, 0)
  }))

test('syncOnce merges both directions and skips excluded records', () =>
  withServer(async (server) => {
    const { syncOnce } = await import('@pixelbrowser/sync-core')
    const code = createSyncCode()
    const a = { data: { memory: { m1: { id: 'm1', updatedAt: 10, deviceId: 'A', data: 'likes tea' } }, history: {}, tabs: {}, settings: { 'ai-keys': { id: 'ai-keys', updatedAt: 10, deviceId: 'A', data: { openai: 'sk' } } } }, cursor: 0, lastPushedAt: 0 }
    const b = { data: { memory: {}, history: { h1: { id: 'h1', updatedAt: 20, deviceId: 'B', data: { url: 'https://x.test' } } }, tabs: {}, settings: {} }, cursor: 0, lastPushedAt: 0 }
    const skip = (c, r) => c === 'settings' && r.id === 'ai-keys'
    const run = async (dev, id) => Object.assign(dev, await syncOnce({ client: new SyncClient({ server, code, deviceId: id }), data: dev.data, deviceId: id, cursor: dev.cursor, lastPushedAt: dev.lastPushedAt, skip }))
    await run(a, 'A')
    const rb = await run(b, 'B')
    assert.deepEqual(rb.changed, ['memory'])
    assert.equal(b.data.memory.m1.data, 'likes tea')
    assert.equal(b.data.settings['ai-keys'], undefined, 'skipped records never leave the device')
    await run(a, 'A')
    assert.equal(a.data.history.h1.data.url, 'https://x.test')
  }))
