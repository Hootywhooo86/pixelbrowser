// End-to-end encrypted sync, shared by desktop and mobile.
//
// - A sync chain is created on one device as a 24-word sync code.
// - Other devices join by typing or scanning that code.
// - Every record is encrypted on the device with XChaCha20-Poly1305. The
//   server only stores { collection, id, blob } and can't read any of it.
// - The server address and chain id are derived from the code, so the server
//   never learns the key itself.

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { randomBytes, bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { base64 } from '@scure/base'
import { generateMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

// Older apps only ask for the collections they know, so adding one is safe.
// passwords/addresses/cards only ever hold records when the user turns on
// their sync (see apps/mobile/src/passwords.js).
export const COLLECTIONS = ['memory', 'history', 'tabs', 'settings', 'bookmarks', 'passwords', 'addresses', 'cards']

// ---------- sync codes ----------

export function createSyncCode() {
  return generateMnemonic(wordlist, 256)
}

export function normalizeSyncCode(code) {
  return String(code || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function isValidSyncCode(code) {
  return validateMnemonic(normalizeSyncCode(code), wordlist)
}

/** Derive the encryption key, server auth token and chain id from a code. */
export function deriveKeys(code) {
  const words = normalizeSyncCode(code)
  if (!validateMnemonic(words, wordlist)) throw new Error('That sync code is not valid. Check the 24 words.')
  const seed = mnemonicToEntropy(words, wordlist)
  const salt = utf8ToBytes('pixelbrowser-sync-v1')
  const derive = (info, len) => hkdf(sha256, seed, salt, utf8ToBytes(info), len)
  return {
    encKey: derive('enc', 32),
    authToken: bytesToHex(derive('auth', 32)),
    chainId: bytesToHex(derive('chain', 16)),
  }
}

// ---------- records ----------

function aad(collection, id) {
  return utf8ToBytes(`${collection}/${id}`)
}

/** Encrypt a record. The collection and id are bound in, so blobs can't be swapped. */
export function encryptRecord(encKey, collection, id, record) {
  const nonce = randomBytes(24)
  const plain = utf8ToBytes(JSON.stringify(record))
  const sealed = xchacha20poly1305(encKey, nonce, aad(collection, id)).encrypt(plain)
  const out = new Uint8Array(nonce.length + sealed.length)
  out.set(nonce)
  out.set(sealed, nonce.length)
  return base64.encode(out)
}

export function decryptRecord(encKey, collection, id, blob) {
  const bytes = base64.decode(blob)
  const nonce = bytes.subarray(0, 24)
  const plain = xchacha20poly1305(encKey, nonce, aad(collection, id)).decrypt(bytes.subarray(24))
  return JSON.parse(new TextDecoder().decode(plain))
}

// ---------- merge ----------

/**
 * Last-writer-wins merge of one collection.
 * Records look like { id, updatedAt, deviceId, deleted?, data }.
 * Returns { merged, changed } where changed lists ids that came from remote.
 */
export function mergeRecords(local = {}, remote = []) {
  const merged = { ...local }
  const changed = []
  for (const r of remote) {
    const mine = merged[r.id]
    if (!mine || newer(r, mine)) {
      merged[r.id] = r
      changed.push(r.id)
    }
  }
  return { merged, changed }
}

function newer(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt
  return String(a.deviceId) > String(b.deviceId)
}

export function liveRecords(map = {}) {
  return Object.values(map).filter((r) => !r.deleted)
}

// ---------- client ----------

export class SyncClient {
  /**
   * @param {object} opts
   * @param {string} opts.server  e.g. https://sync.example.com
   * @param {string} opts.code    24-word sync code
   * @param {string} opts.deviceId
   * @param {typeof fetch} [opts.fetch]
   */
  constructor({ server, code, deviceId, fetch: fetchImpl }) {
    if (!server) throw new Error('Set a sync server address first.')
    this.server = server.replace(/\/+$/, '')
    this.deviceId = deviceId
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis)
    Object.assign(this, deriveKeys(code))
  }

  url(path) {
    return `${this.server}/v1/chains/${this.chainId}${path}`
  }

  headers() {
    return { Authorization: `Bearer ${this.authToken}`, 'Content-Type': 'application/json' }
  }

  /** Upload records: [{ collection, id, updatedAt, deleted?, data }] */
  async push(records) {
    if (!records.length) return { seq: null }
    const body = {
      records: records.map((r) => ({
        collection: r.collection,
        id: r.id,
        blob: encryptRecord(this.encKey, r.collection, r.id, {
          id: r.id,
          updatedAt: r.updatedAt,
          deviceId: r.deviceId || this.deviceId,
          deleted: !!r.deleted,
          data: r.deleted ? null : r.data,
        }),
      })),
    }
    const res = await this.fetch(this.url('/records'), { method: 'POST', headers: this.headers(), body: JSON.stringify(body) })
    if (!res.ok) throw new Error(`Sync upload failed (${res.status}): ${await res.text()}`)
    return res.json()
  }

  /** Download everything newer than `since`. Returns { seq, records: [{ collection, ...record }] } */
  async pull(since = 0) {
    let cursor = since
    const out = []
    for (;;) {
      const res = await this.fetch(this.url(`/records?since=${encodeURIComponent(cursor)}`), { headers: this.headers() })
      if (!res.ok) throw new Error(`Sync download failed (${res.status}): ${await res.text()}`)
      const page = await res.json()
      for (const r of page.records) {
        try {
          out.push({ collection: r.collection, ...decryptRecord(this.encKey, r.collection, r.id, r.blob) })
        } catch {
          // A record we can't decrypt was not written with this code; skip it.
        }
      }
      cursor = page.seq
      if (!page.more) break
    }
    return { seq: cursor, records: out }
  }

  /** Remove every record of this chain from the server. */
  async wipe() {
    const res = await this.fetch(this.url(''), { method: 'DELETE', headers: this.headers() })
    if (!res.ok) throw new Error(`Could not delete sync data (${res.status}).`)
  }
}

/** Text to put in a QR code so a phone can join by scanning. */
export function syncQrPayload(code, server) {
  return `pixelsync:${encodeURIComponent(server || '')}#${normalizeSyncCode(code).replace(/ /g, '-')}`
}

export function parseSyncQr(text) {
  const m = String(text).match(/^pixelsync:([^#]*)#(.+)$/)
  if (!m) return null
  return { server: decodeURIComponent(m[1]), code: m[2].replace(/-/g, ' ') }
}

// ---------- one full sync round (shared by desktop and mobile) ----------

/**
 * Upload this device's changes, then download and merge everyone else's.
 *
 * @param {object} opts
 * @param {SyncClient} opts.client
 * @param {object} opts.data         { [collection]: { [id]: record } } — merged in place
 * @param {string} opts.deviceId
 * @param {number} opts.cursor       server seq we have seen
 * @param {number} opts.lastPushedAt local time of the last upload
 * @param {(collection: string, record: object) => boolean} [opts.skip] records never to upload
 * @returns {Promise<{ cursor: number, lastPushedAt: number, changed: string[] }>}
 */
export async function syncOnce({ client, data, deviceId, cursor = 0, lastPushedAt = 0, skip = () => false }) {
  const startedAt = Date.now()
  const outgoing = []
  for (const collection of COLLECTIONS) {
    for (const r of Object.values(data[collection] || {})) {
      if (r.deviceId === deviceId && r.updatedAt > lastPushedAt && !skip(collection, r)) outgoing.push({ collection, ...r })
    }
  }
  for (let i = 0; i < outgoing.length; i += 500) await client.push(outgoing.slice(i, i + 500))

  const { seq, records } = await client.pull(cursor)
  const changed = []
  for (const collection of COLLECTIONS) {
    const incoming = records
      .filter((r) => r.collection === collection && r.deviceId !== deviceId)
      .map(({ collection: _c, ...r }) => r)
    if (!incoming.length) continue
    const { merged, changed: ids } = mergeRecords(data[collection], incoming)
    data[collection] = merged
    if (ids.length) changed.push(collection)
  }
  return { cursor: seq, lastPushedAt: startedAt, changed }
}
