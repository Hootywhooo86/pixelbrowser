// Password health check: weak, reused and breached passwords.
//
// Breach checks are opt-in. They use Have I Been Pwned's k-anonymity range
// API: only the first 5 characters of each password's SHA-1 hash leave the
// phone, never the password. The report saved in app state holds login ids
// and counts only, no passwords.

import * as Crypto from 'expo-crypto'
import { passwordStrength, findReused, hibpRangeCheck } from '@pixelbrowser/tools-core'
import { getState, update, useStore } from './store'
import { listLogins } from './passwords'

const WEEK = 7 * 24 * 3600 * 1000

const sha1Hex = (s) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, s)

/**
 * Check every saved login. breaches=false skips the network check.
 * → { at, total, weak: [{id, origin, username, score, label}], reused: [[{id, origin, username}]], breached: [{id, origin, username, count}], error }
 */
export async function runSecurityCheck({ breaches = getState().breachCheck === true, onProgress } = {}) {
  const logins = await listLogins()
  const slim = (l) => ({ id: l.id, origin: l.origin, username: l.username })
  const weak = []
  for (const l of logins) {
    const st = passwordStrength(l.password)
    if (st.score <= 1) weak.push({ ...slim(l), score: st.score, label: st.label })
  }
  const reused = findReused(logins).map((g) => g.items.map(slim))
  const breached = []
  let error = ''
  if (breaches) {
    const cache = new Map() // same password → one lookup
    for (let i = 0; i < logins.length; i++) {
      const l = logins[i]
      try {
        if (!cache.has(l.password)) cache.set(l.password, await hibpRangeCheck(await sha1Hex(l.password)))
        const count = cache.get(l.password)
        if (count > 0) breached.push({ ...slim(l), count })
      } catch (e) {
        error = "Couldn't reach the breach check service. Check your connection and try again."
        break
      }
      onProgress?.(i + 1, logins.length)
    }
  }
  const report = { at: Date.now(), total: logins.length, weak, reused, breached, checkedBreaches: breaches && !error, error }
  update((s) => (s.securityReport = report))
  return report
}

export const useSecurityReport = () => useStore((s) => s.securityReport || null)

export function setBreachCheck(on) {
  update((s) => (s.breachCheck = !!on))
}

/** Call when the app opens: re-checks once a week if breach alerts are on. → report or null */
export async function maybeWeeklyCheck() {
  const s = getState()
  if (!s.breachCheck || !(s.passwordIndex || []).length) return null
  if (s.securityReport?.at && Date.now() - s.securityReport.at < WEEK) return null
  const before = new Set((s.securityReport?.breached || []).map((b) => b.id))
  const report = await runSecurityCheck({ breaches: true }).catch(() => null)
  if (!report) return null
  return { ...report, newlyBreached: report.breached.filter((b) => !before.has(b.id)) }
}
