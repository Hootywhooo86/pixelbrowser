import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSyncCode, isValidSyncCode, deriveKeys, encryptRecord, decryptRecord,
  mergeRecords, syncQrPayload, parseSyncQr,
} from '../src/index.js'

test('sync codes are 24 valid words and derive stable keys', () => {
  const code = createSyncCode()
  assert.equal(code.split(' ').length, 24)
  assert.ok(isValidSyncCode(code))
  assert.ok(isValidSyncCode(`  ${code.toUpperCase()}  `))
  const a = deriveKeys(code)
  const b = deriveKeys(code)
  assert.deepEqual(a, b)
  assert.match(a.chainId, /^[0-9a-f]{32}$/)
  assert.match(a.authToken, /^[0-9a-f]{64}$/)
  assert.notEqual(deriveKeys(createSyncCode()).chainId, a.chainId)
})

test('invalid codes are rejected', () => {
  assert.equal(isValidSyncCode('hello world'), false)
  assert.throws(() => deriveKeys('not a real code'))
})

test('records round-trip and are bound to collection/id', () => {
  const { encKey } = deriveKeys(createSyncCode())
  const blob = encryptRecord(encKey, 'memory', 'm1', { data: 'likes pixel art' })
  assert.ok(!blob.includes('pixel'))
  assert.deepEqual(decryptRecord(encKey, 'memory', 'm1', blob), { data: 'likes pixel art' })
  assert.throws(() => decryptRecord(encKey, 'memory', 'm2', blob))
  const other = deriveKeys(createSyncCode()).encKey
  assert.throws(() => decryptRecord(other, 'memory', 'm1', blob))
})

test('merge keeps the newest record and tombstones win when newer', () => {
  const local = { a: { id: 'a', updatedAt: 5, deviceId: 'x', data: 1 } }
  const { merged, changed } = mergeRecords(local, [
    { id: 'a', updatedAt: 3, deviceId: 'y', data: 0 },
    { id: 'b', updatedAt: 1, deviceId: 'y', data: 2 },
  ])
  assert.equal(merged.a.data, 1)
  assert.deepEqual(changed, ['b'])
  const r2 = mergeRecords(merged, [{ id: 'a', updatedAt: 9, deviceId: 'y', deleted: true }])
  assert.equal(r2.merged.a.deleted, true)
})

test('QR payload round-trips', () => {
  const code = createSyncCode()
  const parsed = parseSyncQr(syncQrPayload(code, 'https://sync.example.com'))
  assert.equal(parsed.server, 'https://sync.example.com')
  assert.equal(parsed.code, code)
})
