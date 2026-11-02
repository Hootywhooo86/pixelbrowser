// Family sharing: share one collection (bookmarks, passwords, a Space's tabs…)
// with family members through its own sync chain.
//
// A share has its own 24-word code. Keys come from that code with a
// different salt and the share's kind mixed in, so a share can never decrypt
// your personal sync chain (or a share of another kind), even if the same
// words were somehow reused. Everything is still end-to-end encrypted: the
// server only sees blobs under a random chain id.

import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { mnemonicToEntropy, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { SyncClient, createSyncCode, normalizeSyncCode, mergeRecords } from './index.js'

export const SHARE_KINDS = ['bookmarks', 'passwords', 'space', 'notes', 'readlater']

export const createShareCode = () => createSyncCode()

function checkKind(kind) {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(String(kind))) throw new Error('Unknown share type.')
  return kind
}

/** Keys for a share: { encKey, authToken, chainId }. */
export function deriveShareKeys(code, kind) {
  checkKind(kind)
  const words = normalizeSyncCode(code)
  if (!validateMnemonic(words, wordlist)) throw new Error('That share code is not valid. Check the 24 words.')
  const seed = mnemonicToEntropy(words, wordlist)
  const salt = utf8ToBytes('pixelbrowser-share-v1')
  const derive = (info, len) => hkdf(sha256, seed, salt, utf8ToBytes(`${kind}:${info}`), len)
  return { encKey: derive('enc', 32), authToken: bytesToHex(derive('auth', 32)), chainId: bytesToHex(derive('chain', 16)) }
}

/** Text for a share QR code / link: bitshare:<kind>:<server>#<words-with-dashes> */
export function sharePayload(code, server, kind) {
  return `bitshare:${checkKind(kind)}:${encodeURIComponent(server || '')}#${normalizeSyncCode(code).replace(/ /g, '-')}`
}

export function parseSharePayload(text) {
  const m = String(text || '').trim().match(/^bitshare:([a-z][a-z0-9-]{0,30}):([^#]*)#(.+)$/)
  if (!m) return null
  return { kind: m[1], server: decodeURIComponent(m[2]), code: m[3].replace(/-/g, ' ') }
}

/**
 * A SyncClient talking to a share's chain. (Built at call time rather than
 * with `extends`, because index.js re-exports this file and the two import
 * each other.)
 */
export class ShareClient {
  constructor({ server, code, kind, deviceId, fetch }) {
    checkKind(kind)
    // SyncClient derives personal-sync keys from a valid code; replace them.
    const client = new SyncClient({ server, code, deviceId, fetch })
    Object.assign(client, deriveShareKeys(code, kind), { kind })
    return client
  }
}

export const shareCollection = (kind) => `share.${checkKind(kind)}`

/**
 * One sync round for a share. `records` is { [id]: { id, updatedAt, deviceId, deleted?, data } }.
 * Returns { records, cursor, lastPushedAt, changed } (changed = ids that came from others).
 */
export async function syncShare({ client, records = {}, deviceId, cursor = 0, lastPushedAt = 0 }) {
  const collection = shareCollection(client.kind)
  const startedAt = Date.now()
  const outgoing = Object.values(records)
    .filter((r) => r.deviceId === deviceId && r.updatedAt > lastPushedAt)
    .map((r) => ({ collection, ...r }))
  for (let i = 0; i < outgoing.length; i += 500) await client.push(outgoing.slice(i, i + 500))
  const { seq, records: pulled } = await client.pull(cursor)
  const incoming = pulled.filter((r) => r.collection === collection && r.deviceId !== deviceId).map(({ collection: _c, ...r }) => r)
  const { merged, changed } = mergeRecords(records, incoming)
  return { records: merged, cursor: seq, lastPushedAt: startedAt, changed }
}
