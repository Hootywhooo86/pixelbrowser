// Package tracker: tracking numbers you've saved, synced as records in the
// 'packages' collection. data: { carrier, number, label, url, addedAt, fromUrl }
//
// Numbers are found on pages with DETECT_TRACKING_JS (the page sends nearby
// text) and checked here with tracking-core's check digits.

import * as Crypto from 'expo-crypto'
import { CARRIERS, carrierFor, detectTracking, trackingUrl, DETECT_TRACKING_JS } from '@pixelbrowser/tracking-core'
import { putRecord, liveRecords, useStore } from './store'

export { CARRIERS, carrierFor, detectTracking, trackingUrl, DETECT_TRACKING_JS }

const all = () => liveRecords('packages').filter((r) => r.data?.number)
const asItem = (r) => ({ id: r.id, ...r.data, carrierName: CARRIERS[r.data.carrier]?.name || r.data.carrier })

/** Tracking numbers found in what a page sent ({ __bitTrackingText }), minus ones already saved. */
export function foundOnPage(text) {
  const saved = new Set(all().map((r) => r.data.number))
  return detectTracking(text).filter((t) => !saved.has(t.number))
}

/** Save a tracking number. The carrier is worked out when not given. Returns the id, or null if it isn't a tracking number. */
export function addPackage({ number, carrier, label = '', fromUrl = '' }) {
  const n = String(number || '').replace(/[\s-]/g, '').toUpperCase()
  const c = carrier || carrierFor(n)
  if (!n || !c) return null
  const existing = all().find((r) => r.data.number === n)
  const id = existing?.id || Crypto.randomUUID()
  putRecord('packages', id, {
    carrier: c,
    number: n,
    label: String(label || existing?.data.label || '').slice(0, 120),
    url: trackingUrl(c, n),
    fromUrl: existing?.data.fromUrl || fromUrl,
    addedAt: existing?.data.addedAt || Date.now(),
  })
  return id
}

export function removePackage(id) {
  putRecord('packages', id, null, { deleted: true })
}

export function labelPackage(id, label) {
  const r = all().find((x) => x.id === id)
  if (r) putRecord('packages', id, { ...r.data, label: String(label || '').slice(0, 120) })
}

/** React hook: saved packages, newest first. */
export function usePackages() {
  useStore((s) => s.records.packages)
  return all().map(asItem).sort((a, b) => b.addedAt - a.addedAt)
}
