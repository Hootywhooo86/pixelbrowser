// One-time codes for two-factor sign-in (RFC 4226 HOTP, RFC 6238 TOTP).

import { hmac } from '@noble/hashes/hmac.js'
import { sha1 } from '@noble/hashes/legacy.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const HASHES = { SHA1: sha1, SHA256: sha256, SHA512: sha512 }

export function base32Decode(text) {
  const s = String(text || '').toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out = []
  for (const ch of s) {
    const v = ALPHA.indexOf(ch)
    if (v < 0) throw new Error(`Not a valid secret key (unexpected "${ch}").`)
    value = (value << 5) | v
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  if (!out.length) throw new Error('The secret key is empty.')
  return new Uint8Array(out)
}

export function base32Encode(bytes) {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHA[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 31]
  return out
}

/** HOTP code for a counter. key: Uint8Array or base32 string. */
export function hotp(key, counter, { digits = 6, algorithm = 'SHA1' } = {}) {
  const k = typeof key === 'string' ? base32Decode(key) : key
  const hash = HASHES[String(algorithm).toUpperCase().replace('-', '')] || sha1
  const msg = new Uint8Array(8)
  let c = BigInt(Math.floor(counter))
  for (let i = 7; i >= 0; i--) {
    msg[i] = Number(c & 255n)
    c >>= 8n
  }
  const mac = hmac(hash, k, msg)
  const off = mac[mac.length - 1] & 15
  const bin = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

/** TOTP code at a time (ms). */
export function totp(key, { time = Date.now(), period = 30, digits = 6, algorithm = 'SHA1' } = {}) {
  return hotp(key, Math.floor(time / 1000 / period), { digits, algorithm })
}

export const secondsLeft = (period = 30, time = Date.now()) => period - (Math.floor(time / 1000) % period)

/** otpauth://totp/Issuer:account?secret=…&issuer=…&digits=6&period=30&algorithm=SHA1 */
export function parseOtpauth(uri) {
  let u
  try {
    u = new URL(String(uri || '').trim())
  } catch {
    throw new Error("That isn't a two-factor QR code.")
  }
  if (u.protocol !== 'otpauth:') throw new Error("That isn't a two-factor QR code.")
  const type = (u.host || u.pathname.replace(/^\/+/, '').split('/')[0]).toLowerCase()
  if (type !== 'totp') throw new Error('Only time-based (TOTP) codes are supported.')
  const label = decodeURIComponent((u.host ? u.pathname : u.pathname.replace(/^\/+totp/, '')).replace(/^\/+/, ''))
  const [labelIssuer, account] = label.includes(':') ? label.split(/:(.*)/s) : ['', label]
  const p = u.searchParams
  const secret = (p.get('secret') || '').replace(/\s/g, '').toUpperCase()
  base32Decode(secret) // validates
  return {
    secret,
    issuer: (p.get('issuer') || labelIssuer || '').trim(),
    account: (account || '').trim(),
    digits: Math.min(10, Math.max(6, parseInt(p.get('digits') || '6', 10) || 6)),
    period: Math.max(1, parseInt(p.get('period') || '30', 10) || 30),
    algorithm: (p.get('algorithm') || 'SHA1').toUpperCase(),
  }
}
