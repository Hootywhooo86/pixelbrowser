// Encrypted backup files (.bitbackup): everything in one file, locked with a
// passphrase only you know. scrypt stretches the passphrase into a key, and
// XChaCha20-Poly1305 encrypts and seals the contents, so a wrong passphrase
// or a changed file is rejected instead of giving garbage.

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { scryptAsync } from '@noble/hashes/scrypt.js'
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { base64 } from '@scure/base'

const MAGIC = 'bit-browser-backup'
// N=2^15 takes about a second on a phone and makes guessing expensive.
const DEFAULT = { N: 2 ** 15, r: 8, p: 1 }

const aad = (env) => utf8ToBytes(`${MAGIC}|v${env.v}|${env.kdf}|${env.N}|${env.r}|${env.p}`)

async function keyFor(passphrase, salt, { N, r, p }) {
  if (!passphrase || String(passphrase).length < 8) throw new Error('Use a passphrase of at least 8 characters.')
  return scryptAsync(utf8ToBytes(String(passphrase).normalize('NFKC')), salt, { N, r, p, dkLen: 32, maxmem: 2 ** 28 })
}

/** Encrypt any JSON-able value (or a JSON string) with a passphrase → backup file text. */
export async function encryptBackup(data, passphrase, params = DEFAULT) {
  const json = typeof data === 'string' ? data : JSON.stringify(data)
  const salt = randomBytes(16)
  const nonce = randomBytes(24)
  const env = { format: MAGIC, v: 1, kdf: 'scrypt', N: params.N, r: params.r, p: params.p, createdAt: new Date().toISOString() }
  const key = await keyFor(passphrase, salt, env)
  const ct = xchacha20poly1305(key, nonce, aad(env)).encrypt(utf8ToBytes(json))
  return JSON.stringify({ ...env, salt: base64.encode(salt), nonce: base64.encode(nonce), ct: base64.encode(ct) })
}

/** True if the text looks like a Bit Browser backup file. */
export function isBackup(text) {
  try {
    return JSON.parse(text)?.format === MAGIC
  } catch {
    return false
  }
}

/** Decrypt backup file text → the original value. Throws on a wrong passphrase or a damaged file. */
export async function decryptBackup(text, passphrase) {
  let env
  try {
    env = JSON.parse(text)
  } catch {
    throw new Error("This isn't a Bit Browser backup file.")
  }
  if (env?.format !== MAGIC || env.kdf !== 'scrypt') throw new Error("This isn't a Bit Browser backup file.")
  if (env.v !== 1) throw new Error('This backup was made by a newer Bit Browser. Update the app first.')
  const key = await keyFor(passphrase, base64.decode(env.salt), env)
  let plain
  try {
    plain = xchacha20poly1305(key, base64.decode(env.nonce), aad(env)).decrypt(base64.decode(env.ct))
  } catch {
    throw new Error('Wrong passphrase, or the backup file is damaged.')
  }
  return JSON.parse(new TextDecoder().decode(plain))
}
