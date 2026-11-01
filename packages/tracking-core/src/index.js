// Parcel tracking numbers: find them in page text, check them, and link them
// to the carrier's own tracking page. Used by the phone and desktop apps.
//
// Carriers' formats overlap (a 12-digit number could be FedEx or Purolator),
// so numbers are checked with each carrier's check digit where one exists and
// only reported once. Long runs of digits that fail every check are ignored,
// which keeps phone numbers, order numbers and prices out.

export const CARRIERS = {
  ups: { name: 'UPS', url: (n) => `https://www.ups.com/track?tracknum=${n}` },
  usps: { name: 'USPS', url: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}` },
  fedex: { name: 'FedEx', url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}` },
  canadapost: { name: 'Canada Post', url: (n) => `https://www.canadapost-postescanada.ca/track-reperage/en#/details/${n}` },
  dhl: { name: 'DHL', url: (n) => `https://www.dhl.com/en/express/tracking.html?AWB=${n}` },
  purolator: { name: 'Purolator', url: (n) => `https://www.purolator.com/en/shipping/tracker?pin=${n}` },
  amazon: { name: 'Amazon', url: (n) => `https://track.amazon.com/tracking/${n}` },
}

const digits = (s) => s.split('').map(Number)

/** UPS 1Z: mod-10 over the 15 characters after "1Z" (letters mapped to numbers). */
export function validUps(n) {
  const m = /^1Z([0-9A-Z]{15})([0-9])$/.exec(n)
  if (!m) return false
  const vals = m[1].split('').map((c) => (/\d/.test(c) ? Number(c) : (c.charCodeAt(0) - 63) % 10))
  let sum = 0
  vals.forEach((v, i) => (sum += i % 2 ? v * 2 : v))
  return (10 - (sum % 10)) % 10 === Number(m[2])
}

/** USPS 20–22 digit (IMpb) numbers: mod-10 with weights 3,1 from the right. */
export function validUspsDomestic(n) {
  if (!/^\d{20,22}$/.test(n)) return false
  const d = digits(n)
  const check = d.pop()
  let sum = 0
  d.reverse().forEach((v, i) => (sum += i % 2 ? v : v * 3))
  return (10 - (sum % 10)) % 10 === check
}

/** UPU S10 international numbers (AA123456789CC): USPS, Canada Post and other posts. */
export function validS10(n) {
  const m = /^[A-Z]{2}(\d{8})(\d)[A-Z]{2}$/.exec(n)
  if (!m) return false
  const w = [8, 6, 4, 2, 3, 5, 9, 7]
  const sum = digits(m[1]).reduce((a, v, i) => a + v * w[i], 0)
  let c = 11 - (sum % 11)
  if (c === 10) c = 0
  if (c === 11) c = 5
  return c === Number(m[2])
}

/** FedEx Express 12-digit: weights 1,7,3 from the right on the first 11, mod 11 (10 → 0). */
export function validFedex12(n) {
  if (!/^\d{12}$/.test(n)) return false
  const d = digits(n)
  const check = d.pop()
  const w = [1, 7, 3]
  let sum = 0
  d.reverse().forEach((v, i) => (sum += v * w[i % 3]))
  return (sum % 11) % 10 === check
}

/** FedEx Ground 15-digit (and 96-prefixed 22-digit SSCC style): mod-10, weights 3,1 from the right. */
export function validFedexGround(n) {
  let body = n
  if (/^96\d{20}$/.test(n)) body = n.slice(7)
  if (!/^\d{15}$/.test(body)) return false
  const d = digits(body)
  const check = d.pop()
  let sum = 0
  d.reverse().forEach((v, i) => (sum += i % 2 ? v : v * 3))
  return (10 - (sum % 10)) % 10 === check
}

/** Canada Post 16-digit domestic PIN: mod-10 (Luhn-like, weights 3,1 from the right). */
export function validCanadaPost16(n) {
  if (!/^\d{16}$/.test(n)) return false
  const d = digits(n)
  const check = d.pop()
  let sum = 0
  d.reverse().forEach((v, i) => (sum += i % 2 ? v : v * 3))
  return (10 - (sum % 10)) % 10 === check
}

/** DHL Express 10-digit air waybill: mod 7 of the first 9 digits. */
export function validDhl10(n) {
  if (!/^\d{10}$/.test(n)) return false
  return Number(n.slice(0, 9)) % 7 === Number(n[9])
}

/** Which carrier a cleaned number belongs to (no spaces, uppercase), or null. */
export function carrierFor(raw) {
  const n = String(raw || '').replace(/[\s-]/g, '').toUpperCase()
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return validUps(n) ? 'ups' : null
  if (/^TBA\d{12}$/.test(n)) return 'amazon'
  if (/^JD\d{16,18}$/.test(n) || /^JJD\d{18,20}$/.test(n)) return 'dhl'
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(n)) {
    if (!validS10(n)) return null
    if (n.endsWith('CA')) return 'canadapost'
    if (n.endsWith('US')) return 'usps'
    return 'usps' // other national posts: USPS shows international items
  }
  if (/^[A-Z]{3}\d{9}$/.test(n)) return 'purolator'
  if (/^9[2-5]\d{18,20}$/.test(n) && validUspsDomestic(n)) return 'usps'
  if (/^96\d{20}$/.test(n) && validFedexGround(n)) return 'fedex'
  if (/^\d{15}$/.test(n) && validFedexGround(n)) return 'fedex'
  if (/^\d{16}$/.test(n) && validCanadaPost16(n)) return 'canadapost'
  if (/^\d{12}$/.test(n)) return validFedex12(n) ? 'fedex' : null
  if (/^\d{10}$/.test(n) && validDhl10(n)) return 'dhl'
  return null
}

export function trackingUrl(carrier, number) {
  const c = CARRIERS[carrier]
  return c ? c.url(encodeURIComponent(number)) : ''
}

// Candidates: 1Z…, letter-led S10/Purolator/Amazon/DHL, and long digit runs
// (digits may be grouped with single spaces, as on printed labels).
const CANDIDATE = /\b(1Z[0-9A-Z]{16}|TBA\d{12}|JJ?D\d{16,20}|[A-Z]{2}\d{9}[A-Z]{2}|[A-Z]{3}\d{9}|\d(?:[ ]?\d){9,21})\b/gi

// Plain digit runs of these lengths are common (phone and order numbers), so
// they only count when shipping words are nearby.
const NEEDS_CONTEXT = new Set([10, 12, 15, 16])
const SHIPPING_WORDS = /track|shipment|shipping|parcel|package|delivery|deliver|fedex|dhl|canada post|postes|purolator|waybill|\bups\b|usps|label/i

/** Find tracking numbers in text → [{ carrier, carrierName, number, url }]. */
export function detectTracking(text) {
  const out = []
  const seen = new Set()
  const src = String(text || '')
  for (const m of src.matchAll(CANDIDATE)) {
    const number = m[1].replace(/\s/g, '').toUpperCase()
    if (seen.has(number)) continue
    // Skip phone-number and price shapes: "+1 403…", "$1234…".
    const before = src.slice(Math.max(0, m.index - 2), m.index)
    if (/[+$€£#]\s?$/.test(before)) continue
    if (/^\d+$/.test(number) && NEEDS_CONTEXT.has(number.length)) {
      const around = src.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80)
      if (!SHIPPING_WORDS.test(around)) continue
    }
    const carrier = carrierFor(number)
    if (!carrier) continue
    seen.add(number)
    out.push({ carrier, carrierName: CARRIERS[carrier].name, number, url: trackingUrl(carrier, number) })
  }
  return out
}

/**
 * Page script for the phone app. It only sends candidate numbers with a bit
 * of text around each (not the whole page); the app checks them with
 * detectTracking(). Posts { __bitTrackingText: "…" } once per page.
 */
export const DETECT_TRACKING_JS = `(function(){
  try {
    if (window.__bitTrackDone) return; window.__bitTrackDone = true;
    var re = new RegExp(${JSON.stringify(CANDIDATE.source)}, 'gi');
    var run = function(){
      var text = (document.body && document.body.innerText || '').slice(0, 300000), parts = [], m, n = 0;
      while ((m = re.exec(text)) && n < 60) { n++; parts.push(text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80).replace(/\\s+/g, ' ')) }
      if (parts.length && window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ __bitTrackingText: parts.join(' | ') }));
    };
    if (document.readyState === 'complete') setTimeout(run, 800); else window.addEventListener('load', function(){ setTimeout(run, 800) });
  } catch (e) {}
})(); true;`
