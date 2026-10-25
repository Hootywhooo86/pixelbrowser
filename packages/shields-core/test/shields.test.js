import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {
  compileListsSync, compileLists, preprocess, parseScriptletArgs, createMatcher, hostOf, siteOf, parseHostsList,
  buildPageScript, buildSiteScript, hostSelectors, prepareScriptlets, selectedLists, LISTS,
} from '../src/index.js'

const LIST = `[Adblock Plus 2.0]
! comment
||ads.example.net^
||tracker.example.org^$third-party
||cdn.example.com^$script,image
||firstparty.example.com^$~third-party
||popup.example.com^$popup
||scoped.example.com^$domain=news.com
/banner/ads/*
@@||ok.ads.example.net^
@@||unblocked.site^$document
@@||plain.site^$generichide
##.ad-banner
##div[id^="google_ads"]
##.x:has-text(Sponsored)
news.com,~sports.news.com##.promo
example.*##.sticky-ad
news.com#@#.ad-banner
sports.news.com#@#.promo
youtube.com##+js(set, ytInitialPlayerResponse.adPlacements, undefined)
www.youtube.com##+js(trusted-rpfr, '"adPlacements"', '"no_ads"', player?)
##+js(set, generic, 1)
!#if env_firefox
||firefox-only.example^
!#endif
!#if env_mobile
||mobile-only.example^
!#endif
`

test('preprocess applies !#if blocks for a mobile WebView', () => {
  const lines = preprocess(LIST)
  assert.ok(lines.includes('||mobile-only.example^'))
  assert.ok(!lines.includes('||firefox-only.example^'))
})

test('compiles network rules into host sets', () => {
  const r = compileListsSync([{ text: LIST }])
  assert.ok(r.network.block.includes('ads.example.net'))
  assert.ok(r.network.block.includes('cdn.example.com'))
  assert.ok(r.network.block3p.includes('tracker.example.org'))
  assert.ok(r.network.allow.includes('ok.ads.example.net'))
  assert.ok(r.network.pageAllow.includes('unblocked.site'))
  for (const h of ['firstparty.example.com', 'popup.example.com', 'scoped.example.com']) assert.ok(!r.network.block.includes(h), h)
  assert.equal(r.cosmetic.off['plain.site'], 'generic')
})

test('compiles cosmetic rules and skips procedural ones', () => {
  const r = compileListsSync([{ text: LIST }])
  assert.deepEqual(r.cosmetic.generic, ['.ad-banner', 'div[id^="google_ads"]'])
  assert.deepEqual(r.cosmetic.hosts['news.com'], ['.promo'])
  assert.deepEqual(hostSelectors(r.cosmetic, 'www.news.com'), ['.promo'])
  assert.deepEqual(hostSelectors(r.cosmetic, 'sports.news.com'), [])
  assert.deepEqual(hostSelectors(r.cosmetic, 'shop.example.co.uk'), ['.sticky-ad'])
  assert.ok(r.cosmetic.hostExceptions['news.com'].includes('.ad-banner'))
})

test('scriptlets: per-site only, trusted ones only from trusted lists', () => {
  const untrusted = compileListsSync([{ text: LIST }])
  assert.equal(untrusted.scriptlets['youtube.com'].length, 1)
  assert.equal(untrusted.scriptlets['www.youtube.com'], undefined)
  assert.equal(untrusted.scriptlets['*'], undefined)
  const trusted = compileListsSync([{ text: LIST, trusted: true }])
  assert.deepEqual(trusted.scriptlets['www.youtube.com'][0].split('\u0000'), ['trusted-rpfr', '"adPlacements"', '"no_ads"', 'player?'])
})

test('scriptlet args: quotes, escaped commas, regexes', () => {
  assert.deepEqual(parseScriptletArgs("set, a.b, true"), ['set', 'a.b', 'true'])
  assert.deepEqual(parseScriptletArgs("trusted-rpfr, '\"x\"', '\"y\"', /a\\,b/"), ['trusted-rpfr', '"x"', '"y"', '/a,b/'])
})

test('matcher: parents, third-party, exceptions, site allow', () => {
  const r = compileListsSync([{ text: LIST }])
  const m = createMatcher(r.network)
  assert.equal(m.isBlocked('https://x.ads.example.net/a.js', 'https://news.com/'), true)
  assert.equal(m.isBlocked('https://ok.ads.example.net/a.js', 'https://news.com/'), false)
  assert.equal(m.isBlocked('https://tracker.example.org/p', 'https://news.com/'), true)
  assert.equal(m.isBlocked('https://tracker.example.org/p', 'https://www.example.org/'), false)
  assert.equal(m.isBlocked('https://ads.example.net/a.js', 'https://unblocked.site/'), false)
  assert.equal(m.isBlocked('https://news.com/a.js', 'https://news.com/'), false)
})

test('hostOf and siteOf', () => {
  assert.equal(hostOf('https://User:pw@WWW.Example.com:8080/a?b#c'), 'www.example.com')
  assert.equal(hostOf('about:blank'), '')
  assert.equal(siteOf('a.b.example.co.uk'), 'example.co.uk')
  assert.equal(siteOf('a.b.example.com'), 'example.com')
})

test('parseHostsList handles hosts files and plain lists', () => {
  const hosts = parseHostsList('# c\n0.0.0.0 bad.example\n127.0.0.1\tEVIL.test # x\nphish.example.org\nlocalhost\n0.0.0.0 0.0.0.0\n')
  assert.deepEqual(hosts, ['bad.example', 'evil.test', 'phish.example.org'])
})

test('compileLists (async) gives the same result and yields', async () => {
  let pauses = 0
  const r = await compileLists([{ text: LIST }], { yieldEvery: 5, pause: async () => pauses++ })
  assert.deepEqual(r.network, compileListsSync([{ text: LIST }]).network)
  assert.ok(pauses > 0)
})

test('selectedLists follows the toggles and regional ids', () => {
  const ids = selectedLists({ easylist: true, annoyances: true, easyprivacy: false }, ['de']).map((l) => l.id)
  assert.ok(ids.includes('easylist') && ids.includes('annoyances') && ids.includes('de'))
  assert.ok(!ids.includes('easyprivacy'))
  assert.ok(ids.includes('ublock')) // default on when not set
  assert.equal(LISTS.find((l) => l.id === 'easyprivacy').kind, 'trackers')
})

// A tiny stand-in for uBO's resources.json.
const LIBRARY = [
  { name: 'helper.fn', aliases: [], body: 'function helperFn(){return 1}', dependencies: [] },
  {
    name: 'set-constant.js',
    aliases: ['set'],
    body: 'function setConstant(path, value){ helperFn(); var parts=path.split("."); var o=window; for (var i=0;i<parts.length-1;i++){ o[parts[i]]=o[parts[i]]||{}; o=o[parts[i]] } o[parts[parts.length-1]] = value==="undefined"?undefined:value==="true"?true:value }',
    dependencies: ['helper.fn'],
  },
]

function runInPage(script, hostname) {
  const posted = []
  const ctx = {
    location: { hostname },
    CSS: { supports: () => true },
    JSON: { parse: JSON.parse, stringify: JSON.stringify }, Response: function () {}, setTimeout, setInterval: () => 0, isFinite,
    document: { documentElement: { appendChild() {} }, head: null, createElement: () => ({ setAttribute() {} }), querySelector: () => null, addEventListener() {} },
    ReactNativeWebView: { postMessage: (m) => posted.push(m) },
  }
  ctx.Response.prototype = { json: async () => ({}) }
  ctx.window = ctx
  ctx.window.top = ctx
  vm.createContext(ctx)
  vm.runInContext(script, ctx)
  return { ctx, posted }
}

test('site script runs that site\'s scriptlets and respects Shields down', () => {
  const compiled = compileListsSync([{ text: 'example.com##+js(set, flags.noAds, true)\nother.com##+js(set, flags.other, true)\nexample.com##.promo\nwww.example.com#@#+js(set, flags.noAds, true)' }])
  const script = buildSiteScript({ compiled, library: LIBRARY, host: 'shop.example.com', siteOff: ['down.example.com'] })
  new Function(script) // valid JavaScript
  assert.ok(script.includes('.promo'))
  assert.equal(runInPage(script, 'shop.example.com').ctx.flags.noAds, true)
  assert.equal(runInPage(script, 'shop.example.com').ctx.flags.other, undefined)
  assert.equal(runInPage(buildSiteScript({ compiled, library: LIBRARY, host: 'down.example.com', siteOff: ['down.example.com'] }), 'down.example.com').ctx.flags, undefined)
  // exception on www.example.com
  assert.ok(!buildSiteScript({ compiled, library: LIBRARY, host: 'www.example.com' }).includes('noAds'))
  assert.equal(buildSiteScript({ compiled, library: LIBRARY, host: 'nothing.org' }), '')
})

test('page script carries early-site (YouTube) scriptlets, not others', () => {
  const compiled = compileListsSync([{ text: 'm.youtube.com##+js(set, yt.flag, true)\nexample.com##+js(set, flags.noAds, true)' }])
  const script = buildPageScript({ scriptlets: compiled.scriptlets, library: LIBRARY })
  new Function(script)
  assert.ok(!script.includes('noAds'))
  assert.equal(runInPage(script, 'm.youtube.com').ctx.yt.flag, true)
  assert.equal(runInPage(script, 'www.youtube.com').ctx.yt, undefined)
})

test('page script strips ads from YouTube player data', () => {
  const script = buildPageScript({})
  const { ctx } = runInPage(script, 'm.youtube.com')
  ctx.ytInitialPlayerResponse = { adPlacements: [1], playerAds: [2], videoDetails: { title: 'x' } }
  assert.equal(ctx.ytInitialPlayerResponse.adPlacements, undefined)
  assert.equal(ctx.ytInitialPlayerResponse.videoDetails.title, 'x')
  const parsed = ctx.JSON.parse('{"playerResponse":{"adSlots":[1],"streamingData":{}}}')
  assert.equal(parsed.playerResponse.adSlots, undefined)
})

test('prepareScriptlets drops calls with no code and pulls dependencies', () => {
  const { map, code } = prepareScriptlets({ 'a.com': ['set\u0000x\u0000true', 'missing-thing\u0000y'] }, LIBRARY)
  assert.deepEqual(map['a.com'], [['set-constant.js', 'x', 'true']])
  assert.equal(code.length, 2)
})

