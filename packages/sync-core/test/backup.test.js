import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encryptBackup, decryptBackup, isBackup } from '../src/backup.js'

const FAST = { N: 2 ** 10, r: 8, p: 1 } // quick for tests; the app uses 2^15

test('backup round trip', async () => {
  const data = { tabs: [{ url: 'https://goshippo.com', pinned: true }], logins: [{ origin: 'https://x.org', password: 'hunter2 ✓' }] }
  const file = await encryptBackup(data, 'correct horse battery', FAST)
  assert.ok(isBackup(file))
  assert.ok(!file.includes('hunter2') && !file.includes('goshippo'))
  assert.deepEqual(await decryptBackup(file, 'correct horse battery'), data)
})

test('wrong passphrase and tampering are rejected', async () => {
  const file = await encryptBackup({ a: 1 }, 'correct horse battery', FAST)
  await assert.rejects(() => decryptBackup(file, 'wrong passphrase!'), /Wrong passphrase/)
  const env = JSON.parse(file)
  await assert.rejects(() => decryptBackup(JSON.stringify({ ...env, N: 2 ** 11 }), 'correct horse battery'), /Wrong passphrase/)
  const ct = Buffer.from(env.ct, 'base64')
  ct[0] ^= 1
  await assert.rejects(() => decryptBackup(JSON.stringify({ ...env, ct: ct.toString('base64') }), 'correct horse battery'), /Wrong passphrase/)
})

test('bad input', async () => {
  await assert.rejects(() => encryptBackup({}, 'short', FAST), /at least 8/)
  await assert.rejects(() => decryptBackup('not json', 'whatever123'), /isn't a Bit Browser backup/)
  await assert.rejects(() => decryptBackup(JSON.stringify({ format: 'bit-browser-backup', kdf: 'scrypt', v: 2 }), 'whatever123'), /newer/)
  assert.equal(isBackup('{"x":1}'), false)
})
