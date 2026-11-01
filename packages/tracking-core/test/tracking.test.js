import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectTracking, carrierFor, validUps, validS10, validFedexGround, validFedex12, validDhl10, validUspsDomestic, validCanadaPost16, trackingUrl, DETECT_TRACKING_JS } from '../src/index.js'

// Build a valid number for a mod-10 (3,1 from the right) check, to test lengths
// where we don't have a published sample.
function withMod10(body) {
  let sum = 0
  body.split('').map(Number).reverse().forEach((v, i) => (sum += i % 2 ? v : v * 3))
  return body + ((10 - (sum % 10)) % 10)
}
function withFedex12(body) {
  const w = [1, 7, 3]
  let sum = 0
  body.split('').map(Number).reverse().forEach((v, i) => (sum += v * w[i % 3]))
  return body + ((sum % 11) % 10)
}

test('published sample numbers pass their check digits', () => {
  assert.ok(validUps('1Z999AA10123456784')) // UPS sample
  assert.ok(validS10('AA473124829GB')) // UPU S10 sample
  assert.ok(validFedexGround('449044304137821')) // FedEx Ground sample
  assert.ok(validDhl10('1234567891'))
})

test('a wrong check digit fails', () => {
  assert.ok(!validUps('1Z999AA10123456785'))
  assert.ok(!validS10('AA473124828GB'))
  assert.ok(!validFedexGround('449044304137822'))
  assert.ok(!validDhl10('1234567892'))
})

test('carrierFor picks the right carrier', () => {
  assert.equal(carrierFor('1Z 999 AA1 0123 4567 84'), 'ups')
  assert.equal(carrierFor('TBA123456789012'), 'amazon')
  assert.equal(carrierFor(withMod10('940011189922339784678')), 'usps')
  assert.ok(validUspsDomestic(withMod10('940011189922339784678')))
  assert.equal(carrierFor('EA473124829CA'.replace('EA', 'AA')), 'canadapost')
  assert.equal(carrierFor('AA473124829US'), 'usps')
  assert.equal(carrierFor('449044304137821'), 'fedex')
  assert.equal(carrierFor(withFedex12('12345678901')), 'fedex')
  assert.ok(validFedex12(withFedex12('12345678901')))
  assert.equal(carrierFor(withMod10('101234567890123')), 'canadapost')
  assert.ok(validCanadaPost16(withMod10('101234567890123')))
  assert.equal(carrierFor('ABC123456789'), 'purolator')
  assert.equal(carrierFor('JD014600006281230219'), 'dhl')
  assert.equal(carrierFor('hello'), null)
})

test('detectTracking finds numbers in shipping text with links', () => {
  const t = detectTracking('Shipped! UPS tracking: 1Z999AA10123456784. FedEx tracking number 449044304137821.')
  assert.deepEqual(t.map((x) => x.carrier), ['ups', 'fedex'])
  assert.equal(t[0].url, 'https://www.ups.com/track?tracknum=1Z999AA10123456784')
  assert.match(t[1].url, /fedex\.com/)
})

test('detectTracking leaves phone numbers, prices and bare order numbers alone', () => {
  assert.deepEqual(detectTracking('Call us at +1 403 555 0123 or 4035550123. Order #123456789012. Total $1234567891.'), [])
  // A 10/12/15/16-digit run with no shipping words nearby isn't reported.
  assert.deepEqual(detectTracking('Invoice 449044304137821 for your account.'), [])
  // ...but is with shipping words.
  assert.equal(detectTracking('Your package 449044304137821 is on its way').length, 1)
})

test('duplicates are reported once; spaced label numbers work', () => {
  const t = detectTracking('Tracking 1Z999AA10123456784 (1Z999AA10123456784) and USPS 9400 1118 9922 3397 8467 8' + withMod10('940011189922339784678').slice(-1))
  assert.equal(t.filter((x) => x.carrier === 'ups').length, 1)
})

test('trackingUrl and page script', () => {
  assert.match(trackingUrl('canadapost', 'AA473124829CA'), /canadapost-postescanada\.ca/)
  assert.equal(trackingUrl('nope', '1'), '')
  assert.ok(DETECT_TRACKING_JS.includes('__bitTrackingText'))
  new Function(DETECT_TRACKING_JS) // parses
})
