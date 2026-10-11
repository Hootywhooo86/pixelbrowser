// Zero-knowledge sync server. It stores encrypted blobs per chain and hands
// them back in order. It never sees sync codes, keys, or any plaintext.
//
// API (all JSON, Authorization: Bearer <token derived from the sync code>):
//   POST   /v1/chains/:chain/records        { records: [{ collection, id, blob }] } -> { seq }
//   GET    /v1/chains/:chain/records?since=N -> { seq, records: [{ collection, id, blob, seq }] }
//   DELETE /v1/chains/:chain                 -> wipes the chain
// The first write to a chain claims it for that token.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const MAX_BODY = 8 * 1024 * 1024
const MAX_RECORDS_PER_PUSH = 2000
const MAX_RECORDS_PER_CHAIN = 50000
const MAX_BLOB = 256 * 1024
const PAGE = 1000

export function createSyncServer({ dataDir }) {
  fs.mkdirSync(dataDir, { recursive: true })
  const chains = new Map() // chainId -> { tokenHash, seq, records: Map(key -> {collection,id,blob,seq}) }

  const file = (id) => path.join(dataDir, `${id}.json`)

  function load(id) {
    if (chains.has(id)) return chains.get(id)
    let chain = null
    try {
      const raw = JSON.parse(fs.readFileSync(file(id), 'utf8'))
      chain = { tokenHash: raw.tokenHash, seq: raw.seq, records: new Map(raw.records.map((r) => [`${r.collection}/${r.id}`, r])) }
    } catch {
      // No chain yet.
    }
    if (chain) chains.set(id, chain)
    return chain
  }

  function save(id, chain) {
    const tmp = `${file(id)}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ tokenHash: chain.tokenHash, seq: chain.seq, records: [...chain.records.values()] }))
    fs.renameSync(tmp, file(id))
  }

  const hash = (token) => crypto.createHash('sha256').update(token).digest('hex')

  function authorized(chain, token) {
    if (!chain) return true
    const a = Buffer.from(chain.tokenHash, 'hex')
    const b = Buffer.from(hash(token), 'hex')
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  function send(res, status, body) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    })
    res.end(JSON.stringify(body))
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > MAX_BODY) {
          reject(Object.assign(new Error('Body too large'), { status: 413 }))
          req.destroy()
        } else chunks.push(c)
      })
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
        } catch {
          reject(Object.assign(new Error('Invalid JSON'), { status: 400 }))
        }
      })
      req.on('error', reject)
    })
  }

  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {})
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/health') return send(res, 200, { ok: true })

    const m = url.pathname.match(/^\/v1\/chains\/([0-9a-f]{32})(\/records)?$/)
    if (!m) return send(res, 404, { error: 'Not found' })
    const [, chainId, recordsPath] = m
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!/^[0-9a-f]{64}$/.test(token)) return send(res, 401, { error: 'Missing token' })

    const chain = load(chainId)
    if (!authorized(chain, token)) return send(res, 403, { error: 'Wrong token for this chain' })

    try {
      if (req.method === 'GET' && recordsPath) {
        if (!chain) return send(res, 200, { seq: 0, records: [] })
        const since = Number(url.searchParams.get('since')) || 0
        const records = [...chain.records.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq).slice(0, PAGE)
        const seq = records.length === PAGE ? records[records.length - 1].seq : chain.seq
        return send(res, 200, { seq, records, more: records.length === PAGE })
      }

      if (req.method === 'POST' && recordsPath) {
        const body = await readBody(req)
        const incoming = Array.isArray(body.records) ? body.records : []
        if (incoming.length > MAX_RECORDS_PER_PUSH) return send(res, 413, { error: 'Too many records' })
        for (const r of incoming) {
          if (typeof r.collection !== 'string' || typeof r.id !== 'string' || typeof r.blob !== 'string') return send(res, 400, { error: 'Bad record' })
          if (r.collection.length > 64 || r.id.length > 256 || r.blob.length > MAX_BLOB) return send(res, 413, { error: 'Record too large' })
        }
        const target = chain || { tokenHash: hash(token), seq: 0, records: new Map() }
        for (const r of incoming) {
          target.seq += 1
          target.records.set(`${r.collection}/${r.id}`, { collection: r.collection, id: r.id, blob: r.blob, seq: target.seq })
        }
        if (target.records.size > MAX_RECORDS_PER_CHAIN) return send(res, 507, { error: 'Chain is full' })
        chains.set(chainId, target)
        save(chainId, target)
        return send(res, 200, { seq: target.seq })
      }

      if (req.method === 'DELETE' && !recordsPath) {
        chains.delete(chainId)
        fs.rmSync(file(chainId), { force: true })
        return send(res, 200, { ok: true })
      }

      return send(res, 405, { error: 'Method not allowed' })
    } catch (err) {
      return send(res, err.status || 500, { error: err.status ? err.message : 'Server error' })
    }
  })
}
