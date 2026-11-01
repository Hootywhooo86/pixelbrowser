// Family sharing: share a bookmarks folder, chosen passwords, or a Space's
// tabs with family members. Each share is its own end-to-end encrypted sync
// chain (packages/sync-core/src/sharing.js) on your sync server, joined by
// its own 24 words or QR code. It is separate from your personal sync, so
// family members only ever see what you put in the share.
//
// state.shares = [{ id, kind, label, server, folder?, space?, items?, cursor, lastPushedAt, lastSync, error }]
// state.shareRecords = { [shareId]: { [recordId]: record } }
// Share codes live in secure storage as share:<id>.

import * as Crypto from 'expo-crypto'
import { ShareClient, createShareCode, sharePayload, parseSharePayload, syncShare } from '@pixelbrowser/sync-core'
import { getState, update, getSecret, setSecret, liveRecords, putRecord } from './store'
import { listLogins, saveLogin } from './passwords'

export const SHARE_TYPES = {
  bookmarks: { label: 'Bookmarks folder', note: 'Everyone in the share sees and can add to one bookmarks folder.' },
  passwords: { label: 'Passwords', note: 'Share chosen logins, like the family streaming account. They stay encrypted end to end.' },
  space: { label: 'A Space\'s tabs', note: 'Share the open tabs of one Space, like a trip you\'re planning together.' },
}

const codeKey = (id) => `share:${id}`
export const listShares = () => getState()?.shares || []
const patchShare = (id, patch) => update((s) => (s.shares = (s.shares || []).map((x) => (x.id === id ? { ...x, ...patch } : x))))

function syncServer() {
  const server = getState()?.sync?.server
  if (!server) throw new Error('Set up sync first (Settings → Sync): shares use the same sync server.')
  return server
}

/** Start a share. Returns { id, code, qr } to show the family member. */
export async function createShare(kind, { label = '', folder = '', space = '', items = [] } = {}) {
  if (!SHARE_TYPES[kind]) throw new Error('Unknown share type.')
  const server = syncServer()
  const code = createShareCode()
  const id = Crypto.randomUUID()
  await setSecret(codeKey(id), code)
  const share = { id, kind, label: label || SHARE_TYPES[kind].label, server, folder: folder || label || 'Family', space, items, cursor: 0, lastPushedAt: 0, owner: true, createdAt: Date.now() }
  update((s) => (s.shares = [...(s.shares || []), share]))
  await syncOneShare(id).catch(() => {})
  return { id, code, qr: sharePayload(code, server, kind) }
}

/** Join a share from its QR text, or from its 24 words plus the type. */
export async function joinShare(input, { kind, label = '' } = {}) {
  const parsed = parseSharePayload(input)
  const k = parsed?.kind || kind
  if (!SHARE_TYPES[k]) throw new Error('Scan the share\'s QR code, or pick what kind of share it is.')
  const code = parsed?.code || String(input || '').trim()
  const server = parsed?.server || syncServer()
  new ShareClient({ server, code, kind: k, deviceId: getState().deviceId }) // validates the words
  const id = Crypto.randomUUID()
  await setSecret(codeKey(id), code)
  const share = { id, kind: k, label: label || SHARE_TYPES[k].label, server, folder: label || 'Family', space: '', items: [], cursor: 0, lastPushedAt: 0, owner: false, createdAt: Date.now() }
  update((s) => (s.shares = [...(s.shares || []), share]))
  await syncOneShare(id)
  return id
}

/** Show the code/QR again to add another family member. */
export async function shareInvite(id) {
  const share = listShares().find((x) => x.id === id)
  const code = await getSecret(codeKey(id))
  if (!share || !code) throw new Error('That share is gone.')
  return { code, qr: sharePayload(code, share.server, share.kind) }
}

/** Leave a share: stops syncing it here; what was shared stays on the other devices. */
export async function leaveShare(id) {
  await setSecret(codeKey(id), '')
  update((s) => {
    s.shares = (s.shares || []).filter((x) => x.id !== id)
    const recs = { ...(s.shareRecords || {}) }
    delete recs[id]
    s.shareRecords = recs
  })
}

// ---------- what goes in and comes out of each kind of share ----------

/** Current local items for a share: { [stableId]: data }. */
async function outgoing(share) {
  if (share.kind === 'bookmarks') {
    const out = {}
    for (const r of liveRecords('bookmarks')) if (r.data?.folder === share.folder) out[r.data.url] = { url: r.data.url, title: r.data.title || r.data.url }
    return out
  }
  if (share.kind === 'passwords') {
    const chosen = new Set(share.items || [])
    const out = {}
    for (const l of await listLogins()) if (chosen.has(l.id)) out[`${l.origin}|${l.username}`] = { origin: l.origin, username: l.username, password: l.password }
    return out
  }
  if (share.kind === 'space') {
    const out = {}
    for (const t of getState()?.savedTabs || []) if ((t.space || 'personal') === share.space && /^https?:/i.test(t.url)) out[t.url] = { url: t.url, title: t.title || t.url }
    return out
  }
  return {}
}

/** Put items that came from family members into this phone's data. */
async function applyIncoming(share, records) {
  for (const r of records) {
    const d = r.data
    if (share.kind === 'bookmarks') {
      const id = `share-${share.id.slice(0, 8)}-${(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, r.id)).slice(0, 16)}`
      if (r.deleted || !d) putRecord('bookmarks', id, null, { deleted: true })
      else putRecord('bookmarks', id, { url: d.url, title: d.title, folder: share.folder, createdAt: r.updatedAt })
    } else if (share.kind === 'passwords' && !r.deleted && d?.password) {
      await saveLogin({ origin: d.origin, username: d.username, password: d.password })
    }
    // 'space' items are shown in the Sharing screen to open, not forced into your tabs.
  }
}

/** Items from a Space share, for the Sharing screen: [{ url, title }]. */
export function sharedTabs(id) {
  return Object.values(getState()?.shareRecords?.[id] || {}).filter((r) => !r.deleted && r.data?.url).map((r) => r.data)
}

/** Sync one share now. */
export async function syncOneShare(id) {
  const share = listShares().find((x) => x.id === id)
  const code = await getSecret(codeKey(id))
  if (!share || !code) return
  const deviceId = getState().deviceId
  const records = { ...(getState()?.shareRecords?.[id] || {}) }
  // Record local changes (new, edited, removed) as this device's writes.
  const mine = await outgoing(share)
  const now = Date.now()
  for (const [rid, data] of Object.entries(mine)) {
    const cur = records[rid]
    if (!cur || cur.deleted || JSON.stringify(cur.data) !== JSON.stringify(data)) records[rid] = { id: rid, updatedAt: now, deviceId, deleted: false, data }
  }
  if (share.kind !== 'passwords') {
    for (const [rid, cur] of Object.entries(records)) if (!cur.deleted && cur.deviceId === deviceId && !mine[rid]) records[rid] = { id: rid, updatedAt: now, deviceId, deleted: true, data: null }
  }
  try {
    const client = new ShareClient({ server: share.server, code, kind: share.kind, deviceId })
    const res = await syncShare({ client, records, deviceId, cursor: share.cursor, lastPushedAt: share.lastPushedAt })
    update((s) => (s.shareRecords = { ...(s.shareRecords || {}), [id]: res.records }))
    patchShare(id, { cursor: res.cursor, lastPushedAt: res.lastPushedAt, lastSync: Date.now(), error: '' })
    if (res.changed.length) await applyIncoming(share, res.changed.map((rid) => res.records[rid]))
    return res.changed.length
  } catch (e) {
    patchShare(id, { error: e.message })
    throw e
  }
}

/** Sync every share (call after personal sync, e.g. from startSync's timer). */
export async function syncShares() {
  for (const s of listShares()) await syncOneShare(s.id).catch(() => {})
}

/** Change what a share includes (passwords: chosen login ids; space: which Space). */
export function setShareItems(id, patch) {
  patchShare(id, patch)
}
