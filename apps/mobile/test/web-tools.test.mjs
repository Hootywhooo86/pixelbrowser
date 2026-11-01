import test from 'node:test'
import assert from 'node:assert/strict'
import { upgradeUrl, isUpgradeFailure, parsePriceNumber, extractPrice, pageText, diffText, textHash, dateWindow, queryTerms, scoreItems, safeSearchUrl, kidsAllows, hostInList } from '../src/web-tools-core.js'

test('upgradeUrl upgrades public http sites only', () => {
  assert.equal(upgradeUrl('http://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.equal(upgradeUrl('http://example.com'), 'https://example.com/')
  assert.equal(upgradeUrl('http://example.com:80/x'), 'https://example.com/x')
  assert.equal(upgradeUrl('https://example.com/'), null)
  assert.equal(upgradeUrl('http://localhost:3000/'), null)
  assert.equal(upgradeUrl('http://192.168.1.4/'), null)
  assert.equal(upgradeUrl('http://printer.local/'), null)
  assert.equal(upgradeUrl('http://example.com:8080/'), null)
  assert.equal(upgradeUrl('http://www.mynettutor.com/', new Set(['mynettutor.com'])), null)
  assert.equal(upgradeUrl('http://old.site/', new Set(['old.site'])), null)
})

test('isUpgradeFailure spots TLS and connection errors', () => {
  assert.ok(isUpgradeFailure('net::ERR_SSL_PROTOCOL_ERROR'))
  assert.ok(isUpgradeFailure('net::ERR_CERT_COMMON_NAME_INVALID'))
  assert.ok(isUpgradeFailure('net::ERR_CONNECTION_REFUSED'))
  assert.ok(!isUpgradeFailure('net::ERR_INTERNET_DISCONNECTED'))
})

test('parsePriceNumber handles formats', () => {
  assert.equal(parsePriceNumber('$1,299.99'), 1299.99)
  assert.equal(parsePriceNumber('1.299,99 €'), 1299.99)
  assert.equal(parsePriceNumber('12,50'), 12.5)
  assert.equal(parsePriceNumber('CA$ 45'), 45)
  assert.equal(parsePriceNumber('free'), null)
})

test('extractPrice reads JSON-LD, meta, itemprop and elements', () => {
  const ld = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Lamp","offers":{"@type":"Offer","price":"49.99","priceCurrency":"CAD"}}</script>'
  assert.deepEqual(extractPrice(ld), { price: 49.99, currency: 'CAD', source: 'json-ld' })
  const graph = '<script type="application/ld+json">{"@graph":[{"@type":"Product","offers":[{"@type":"Offer","price":30},{"@type":"Offer","price":25}]}]}</script>'
  assert.equal(extractPrice(graph).price, 25)
  assert.equal(extractPrice('<meta property="product:price:amount" content="19.00"><meta property="product:price:currency" content="USD">').price, 19)
  assert.equal(extractPrice('<span itemprop="price" content="7.5">$7.50</span>').price, 7.5)
  assert.equal(extractPrice('<div class="product-price"><span>$1,049.00</span></div>').price, 1049)
  assert.equal(extractPrice('<p>No price here</p>'), null)
})

test('pageText and diffText', () => {
  const a = pageText('<html><script>x()</script><h1>News</h1><p>Old story</p><p>Same &amp; stays</p></html>')
  assert.equal(a, 'News\nOld story\nSame & stays')
  const b = pageText('<h1>News</h1><p>New story</p><p>Same &amp; stays</p>')
  const d = diffText(a, b)
  assert.deepEqual(d.added, ['New story'])
  assert.deepEqual(d.removed, ['Old story'])
  assert.ok(d.changed)
  assert.ok(!diffText(a, a).changed)
  assert.equal(textHash('abc'), textHash('abc'))
  assert.notEqual(textHash('abc'), textHash('abd'))
})

test('dateWindow and queryTerms', () => {
  const now = new Date('2026-11-01T15:00:00Z').getTime()
  const [from, to] = dateWindow('that shipping site last week', now)
  assert.ok(to - from > 7 * 86400000 - 1)
  assert.ok(dateWindow('yesterday recipes', now))
  assert.equal(dateWindow('lamps', now), null)
  assert.deepEqual(queryTerms('that shipping supplies site I saw last week'), ['shipping', 'supplies'])
})

test('scoreItems ranks hosts, titles and dates', () => {
  const now = Date.now()
  const items = [
    { kind: 'history', title: 'Uline – Shipping Supplies', url: 'https://www.uline.ca/', at: now - 3 * 86400000 },
    { kind: 'history', title: 'Shippo dashboard', url: 'https://apps.goshippo.com/', at: now - 1 * 86400000 },
    { kind: 'history', title: 'Pancake recipe', url: 'https://food.example/pancakes', at: now - 2 * 86400000 },
    { kind: 'bookmark', title: 'Boxes and supplies', url: 'https://boxes.example/', at: now - 40 * 86400000 },
  ]
  const r = scoreItems(items, 'shipping supplies site last week', { now })
  assert.equal(r[0].url, 'https://www.uline.ca/')
  assert.ok(!r.some((x) => x.url.includes('boxes.example'))) // outside "last week"
  assert.ok(!r.some((x) => x.url.includes('pancakes')))
  assert.equal(scoreItems(items, 'shippo', { now })[0].title, 'Shippo dashboard')
})

test('safeSearchUrl forces strict safe search', () => {
  assert.equal(safeSearchUrl('https://www.google.com/search?q=cats'), 'https://www.google.com/search?q=cats&safe=active')
  assert.equal(safeSearchUrl('https://www.google.com/search?q=cats&safe=active'), null)
  assert.match(safeSearchUrl('https://www.bing.com/search?q=cats'), /adlt=strict/)
  assert.match(safeSearchUrl('https://duckduckgo.com/?q=cats'), /kp=1/)
  assert.equal(safeSearchUrl('https://example.com/search?q=x'), null)
})

test('kidsAllows allow and block lists', () => {
  assert.ok(hostInList('www.kids.example.com', ['example.com']))
  assert.ok(kidsAllows('https://pbskids.org/', { mode: 'allow', allow: [] }))
  assert.ok(!kidsAllows('https://reddit.com/', { mode: 'allow', allow: ['khanacademy.org'] }))
  assert.ok(kidsAllows('https://reddit.com/', { mode: 'block', block: ['tiktok.com'] }))
  assert.ok(!kidsAllows('https://www.tiktok.com/@x', { mode: 'block', block: ['tiktok.com'] }))
  assert.ok(!kidsAllows('https://pornhub.com/', { mode: 'block', block: [] }))
  assert.ok(kidsAllows('bit://newtab', { mode: 'allow' }))
})
